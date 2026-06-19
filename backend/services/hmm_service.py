from pathlib import Path
from typing import Optional
from uuid import UUID

import pandas as pd
import numpy as np
import joblib

from backend.train_hmm import train_hmm, DEFAULT_FEATURES
from backend.database import SessionLocal
from backend.models import ModelRun, RegimePrediction

from backend.services.dataset_paths import DATA_DIR, resolve_dataset_csv_path
from backend.services.run_lookup import get_latest_successful_run_with_predictions
from backend.services.settings_service import load_inference_settings
from backend.services.run_metrics import update_run_metrics

from backend.config import ARTIFACTS_DIR



def train_model_service(n_states: int, dataset_id: str = None):
    csv_path = DATA_DIR / "pollution.csv"

    if not dataset_id:
        return {"error": "dataset_id is required for training. Upload a dataset first."}

    db = SessionLocal()
    try:
        from backend.models import Dataset

        dataset = db.query(Dataset).filter(Dataset.dataset_id == dataset_id).first()
        resolved = resolve_dataset_csv_path(dataset)
        if resolved:
            csv_path = resolved
    finally:
        db.close()

    if not csv_path.exists():
        return {"error": f"Dataset file {csv_path.name} not found"}

    metadata = train_hmm(
        csv_path=csv_path,
        output_dir=ARTIFACTS_DIR,
        n_states=n_states,
    )

    return {
        "message": "Model trained successfully",
        "n_states": n_states,
        "rows": metadata["rows"],
        "log_likelihood": metadata["log_likelihood"],
    }


def calculate_aqi(value):
    pm25 = float(value)

    if pm25 <= 12:
        return (pm25 / 12) * 50
    elif pm25 <= 35.4:
        return ((pm25 - 12) / 23.4) * 50 + 50
    elif pm25 <= 55.4:
        return ((pm25 - 35.4) / 20) * 50 + 100
    elif pm25 <= 150.4:
        return ((pm25 - 55.4) / 95) * 100 + 150
    elif pm25 <= 250.4:
        return ((pm25 - 150.4) / 100) * 100 + 200
    else:
        return ((pm25 - 250.4) / 249.6) * 200 + 300


def load_and_clean_csv(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, sep=";")
    df.columns = [c.strip() for c in df.columns]

    df = df.drop(columns=["Unnamed: 15", "Unnamed: 16"], errors="ignore")
    df = df.loc[:, ~df.columns.str.contains("^Unnamed")]

    df["timestamp"] = pd.to_datetime(
        df["Date"].astype(str) + " " + df["Time"].astype(str),
        format="%d/%m/%Y %H.%M.%S",
        errors="coerce",
    )

    df = df.dropna(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)

    df = df.replace(-200, np.nan)

    for col in DEFAULT_FEATURES:
        df[col] = df[col].astype(str).str.replace(",", ".", regex=False) 
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df[df["CO(GT)"] >= 0]

    df[DEFAULT_FEATURES] = df[DEFAULT_FEATURES].bfill().ffill()

    df["pollution"] = df[["CO(GT)", "NOx(GT)", "NO2(GT)", "C6H6(GT)"]].mean(axis=1)

    df["pollution"] = df["pollution"].replace(0, np.nan)
    df["pollution"] = df["pollution"].rolling(3).mean()

    df["smooth"] = df["pollution"].rolling(5).mean()
    df["trend"] = df["smooth"].diff()
    df["volatility"] = df["smooth"].rolling(5).std()

    df["diff"] = df["pollution"].diff()
    df["rolling_max"] = df["pollution"].rolling(5).max()
    df["rolling_min"] = df["pollution"].rolling(5).min()

    df["range"] = df["rolling_max"] - df["rolling_min"]
    df["momentum"] = df["pollution"] - df["pollution"].shift(3)

    df["hour"] = df["timestamp"].dt.hour / 24.0
    df["is_weekend"] = (df["timestamp"].dt.dayofweek >= 5).astype(int)

    df = df.bfill().ffill()
    df = df.dropna().reset_index(drop=True)

    return df


def _min_segment_rows_from_timestamps(
    df: pd.DataFrame, min_dwell_hours: float, cap: int = 48
) -> int:
    """Minimum regime block length in rows from `min_dwell_hours` and median timestep."""
    hours = float(min_dwell_hours)
    if len(df) < 2 or "timestamp" not in df.columns:
        return max(1, int(round(hours)))
    deltas = df["timestamp"].diff().dt.total_seconds().iloc[1:]
    med = float(deltas.median())
    if pd.isna(med) or med <= 0:
        return max(1, int(round(hours)))
    rows = round(hours * 3600.0 / med)
    return max(1, min(int(rows), cap))


def map_logical_regime(row, cfg: dict) -> str:
    mean_val = row["smooth"]
    std_val = row["volatility"]

    if pd.isna(mean_val) or pd.isna(std_val):
        return "volatile"

    aqi = calculate_aqi(mean_val)
    vol_ratio = cfg["volatility_ratio"]
    high_thr = cfg["regime_high_aqi"]
    stable_max = cfg["regime_stable_max_aqi"]
    volatility_ratio = std_val / mean_val if mean_val > 0 else 0

    if aqi > high_thr:
        return "high"
    elif aqi < stable_max:
        if volatility_ratio > vol_ratio:
            return "volatile"
        return "stable"
    else:
        if volatility_ratio > vol_ratio:
            return "volatile"
        return "stable"


def validate_model(model):
    trans = model.transmat_

    if np.any(np.diag(trans) < 0.5):
        print("⚠️ Model unstable: too frequent switching")


def predict_service(
    limit: int,
    regime: str = None,
    dataset_id: str = None,
    persist_run_id: Optional[str] = None,
):
    cfg = load_inference_settings()
    pm25_thr = float(cfg["pm25_threshold"])

    model_path = ARTIFACTS_DIR / "hmm_model.joblib"
    scaler_path = ARTIFACTS_DIR / "scaler.joblib"

    csv_path = DATA_DIR / "pollution.csv"
    if dataset_id:
        db = SessionLocal()
        try:
            from backend.models import Dataset

            target_dataset = db.query(Dataset).filter(Dataset.dataset_id == dataset_id).first()
            resolved = resolve_dataset_csv_path(target_dataset)
            if resolved:
                csv_path = resolved
        finally:
            db.close()

    if not model_path.exists():
        return {"error": "Train model first"}
    if not scaler_path.exists():
        return {"error": "Scaler missing"}
    if not csv_path.exists():
        return {"error": "CSV missing"}

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path)

    validate_model(model)

    df = load_and_clean_csv(csv_path)

    feature_cols = [
        "CO(GT)",
        "NOx(GT)",
        "NO2(GT)",
        "C6H6(GT)",
        "hour",
        "is_weekend",
        "smooth",
        "trend",
        "volatility",
        "diff",
        "rolling_max",
        "rolling_min",
        "range",
        "momentum",
    ]

    X = df[feature_cols].values
    X_scaled = scaler.transform(X)

    states = model.predict(X_scaled)
    probs = model.predict_proba(X_scaled)

    df["state"] = states

    df["hmm_confidence"] = np.max(probs, axis=1)

    df["value"] = df["pollution"]

    df["regime"] = df.apply(lambda r: map_logical_regime(r, cfg), axis=1)

    regimes = df["regime"].values
    n = len(regimes)
    min_seg = _min_segment_rows_from_timestamps(df, float(cfg.get("min_dwell_hours", 1.0)))
    if cfg.get("smoothing_enabled", True) and n > 0:
        blocks = []
        cur_regime = regimes[0]
        start_idx = 0
        for i in range(1, n):
            if regimes[i] != cur_regime:
                blocks.append(
                    {
                        "regime": cur_regime,
                        "start": start_idx,
                        "end": i - 1,
                        "len": i - start_idx,
                    }
                )
                cur_regime = regimes[i]
                start_idx = i
        blocks.append(
            {
                "regime": cur_regime,
                "start": start_idx,
                "end": n - 1,
                "len": n - start_idx,
            }
        )

        for i, b in enumerate(blocks):
            if b["len"] < min_seg:
                left = blocks[i - 1]["regime"] if i > 0 else None
                right = blocks[i + 1]["regime"] if i < len(blocks) - 1 else None
                override_regime = left if left else (right if right else b["regime"])
                regimes[b["start"] : b["end"] + 1] = override_regime
                b["regime"] = override_regime

        df["regime"] = regimes

    def enforce_physical_bounds(row):
        aqi = calculate_aqi(row["value"]) if not pd.isna(row["value"]) else 0
        if aqi > pm25_thr:
            return "high"
        return row["regime"]

    df["regime"] = df.apply(enforce_physical_bounds, axis=1)

    def calibrated_confidence(row):
        aqi = calculate_aqi(row["smooth"]) if not pd.isna(row["smooth"]) else 0
        dist = abs(aqi - pm25_thr) / max(pm25_thr, 1e-9)
        return min(0.99, 0.5 + (dist * 0.5))

    df["regime_confidence"] = [calibrated_confidence(row) for _, row in df.iterrows()]

    df = df.dropna(subset=["regime"])

    if regime:
        df = df[df["regime"] == regime]

    df = df.tail(limit).reset_index(drop=True)

    if len(df) == 0:
        return {"error": "No data after filtering"}

    latest = df.iloc[-1]
    latest_aqi = calculate_aqi(latest["value"])

    transitions = []
    for i in range(1, len(df)):
        if df.iloc[i]["regime"] != df.iloc[i - 1]["regime"]:
            transitions.append(
                {
                    "from": df.iloc[i - 1]["regime"],
                    "to": df.iloc[i]["regime"],
                    "time": str(df.iloc[i]["timestamp"]),
                }
            )

    summary_counts = df["regime"].value_counts().to_dict()
    summary = {"total": len(df)}
    summary.update({k: int(v) for k, v in summary_counts.items()})

    data_out = []
    for _, row in df.iterrows():
        aqi_out = round(calculate_aqi(float(row["value"])), 1)
        data_out.append(
            {
                "timestamp": str(row["timestamp"]),
                "value": aqi_out,
                "state": int(row["state"]),
                "regime": str(row["regime"]),
                "confidence": round(float(row["regime_confidence"]), 6),
                "hmm_posterior_max": round(float(row["hmm_confidence"]), 6),
                "pollution_index": float(row["value"]) if not pd.isna(row["value"]) else None,
            }
        )

    try:
        db = SessionLocal()
        try:
            target_run = None
            if persist_run_id is not None:
                try:
                    rid = UUID(str(persist_run_id))
                except (ValueError, TypeError):
                    rid = None
                if rid is not None:
                    target_run = db.query(ModelRun).filter(ModelRun.run_id == rid).first()
            else:
                # Without an explicit dataset, do not attach rows to an arbitrary successful run
                # (avoids writing pollution.csv inference onto another dataset's run).
                if dataset_id is None:
                    target_run = None
                else:
                    target_run = get_latest_successful_run_with_predictions(
                        db, dataset_id=dataset_id
                    )

            if target_run:
                db.query(RegimePrediction).filter(
                    RegimePrediction.run_id == target_run.run_id
                ).delete(synchronize_session=False)

                ds_id = target_run.dataset_id
                prediction_rows = []
                for seq_idx, row in enumerate(data_out):
                    ts = pd.to_datetime(row["timestamp"], errors="coerce")
                    if pd.isna(ts):
                        continue
                    prediction_rows.append(
                        RegimePrediction(
                            run_id=target_run.run_id,
                            dataset_id=ds_id,
                            sequence_index=seq_idx,
                            timestamp=ts.to_pydatetime(),
                            pollution_index=row.get("pollution_index"),
                            aqi_value=float(row["value"]),
                            predicted_state=int(row["state"]),
                            regime=str(row["regime"]),
                            hmm_posterior_max=float(row["hmm_posterior_max"]),
                            regime_confidence=float(row["confidence"]),
                        )
                    )

                if prediction_rows:
                    db.add_all(prediction_rows)
                    db.commit()
                    update_run_metrics(target_run.run_id)
        finally:
            db.close()
    except Exception as e:
        print(f"Failed to persist regime_predictions: {e}")

    return {
        "summary": summary,
        "latest": {
            "value": float(latest["value"]),
            "regime": latest["regime"],
            "confidence": float(latest["regime_confidence"]),
            "aqi": float(latest_aqi),
        },
        "transitions": transitions[-10:],
        "data": data_out,
    }
