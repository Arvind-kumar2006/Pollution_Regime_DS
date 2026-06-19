from pathlib import Path
import pandas as pd
import numpy as np
import joblib
import json

from hmmlearn.hmm import GaussianHMM
from sklearn.preprocessing import StandardScaler

DEFAULT_FEATURES = [
    "CO(GT)" ,
    "NOx(GT)",
    "NO2(GT)",
    "C6H6(GT)",
    "T",
    "RH"
]
def train_hmm(csv_path: Path, output_dir: Path, n_states: int = 3):
    output_dir.mkdir(parents=True, exist_ok=True)
    # ----------------------------
    # LOAD DATA
    # ----------------------------
    df = pd.read_csv(csv_path, sep=";")
    df.columns = [c.strip() for c in df.columns]
    df = df.drop(columns=["Unnamed: 15", "Unnamed: 16"], errors="ignore")
    df = df.loc[:, ~df.columns.str.contains('^Unnamed')]

    # ----------------------------
    # TIMESTAMP
    # ----------------------------
    df["timestamp"] = pd.to_datetime(
        df["Date"].astype(str) + " " + df["Time"].astype(str),
        format="%d/%m/%Y %H.%M.%S",
        errors="coerce"
    )

    df = df.dropna(subset=["timestamp"]).sort_values("timestamp")

    # ----------------------------
    # CLEAN DATA
    # ----------------------------
    df = df.replace(-200, np.nan)

    for col in DEFAULT_FEATURES:
        df[col] = (
            df[col]
            .astype(str)
            .str.replace(",", ".", regex=False)
        )
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Strict negative removal (Bad sensor logs)
    df = df[df["CO(GT)"] >= 0]

    # Fill basic feature nan but DON'T dropna yet
    df[DEFAULT_FEATURES] = df[DEFAULT_FEATURES].bfill().ffill()

    # ----------------------------
    # TEMPORAL FEATURES
    # ----------------------------
    df["pollution"] = df[
        ["CO(GT)", "NOx(GT)", "NO2(GT)", "C6H6(GT)"]
    ].mean(axis=1)
    
    # Remove fake zero pollution
    df["pollution"] = df["pollution"].replace(0, np.nan)
    
    # Pre-smoothing
    df["pollution"] = df["pollution"].rolling(3).mean()

    df["smooth"] = df["pollution"].rolling(5).mean()
    df["trend"] = df["smooth"].diff()
    df["volatility"] = df["smooth"].rolling(5).std()
    
    df["diff"] = df["pollution"].diff()
    df["rolling_max"] = df["pollution"].rolling(5).max()
    df["rolling_min"] = df["pollution"].rolling(5).min()
    
    # Improve features
    df["range"] = df["rolling_max"] - df["rolling_min"]
    df["momentum"] = df["pollution"] - df["pollution"].shift(3)

    # Time Topologies
    df["hour"] = df["timestamp"].dt.hour / 24.0
    df["is_weekend"] = (df["timestamp"].dt.dayofweek >= 5).astype(int)

    # Handle data loss without excessive dropping
    df = df.bfill().ffill()
    df = df.dropna().reset_index(drop=True)

    # ----------------------------
    # FEATURE MATRIX (CONSISTENT)
    # ----------------------------
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
        "momentum"
    ]

    X = df[feature_cols].values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # ----------------------------
    # TRAIN MODEL
    # ----------------------------
    model = GaussianHMM(
        n_components=n_states,
        covariance_type="diag",
        n_iter=500,
        random_state=42
    )

    model.fit(X_scaled)
    # Validate Model as requested
    print("State means:\n", model.means_)

    states = model.predict(X_scaled)
    probs = model.predict_proba(X_scaled)

    df["state"] = states
    
    # Probabilistic Confidence via Shannon Entropy
    entropy = -np.sum(probs * np.log(probs + 1e-10), axis=1)
    max_entropy = np.log(model.n_components)
    df["confidence"] = 1.0 - (entropy / (max_entropy + 1e-10))

    # ----------------------------
    # REAL POLLUTION VALUE
    # ----------------------------
    df["value"] = df["pollution"]

    # ----------------------------
    # ✅ LOGICAL REGIME MAPPING (Orthogonal)
    # ----------------------------
    def map_logical_regime(row):
        mean_val = row["smooth"]
        std_val = row["volatility"]
        
        def calculate_aqi_local(pm25):
            if pd.isna(pm25): return 0
            pm25 = float(pm25)
            if pm25 <= 12: return (pm25 / 12) * 50
            elif pm25 <= 35.4: return ((pm25 - 12) / 23.4) * 50 + 50
            elif pm25 <= 55.4: return ((pm25 - 35.4) / 20) * 50 + 100
            elif pm25 <= 150.4: return ((pm25 - 55.4) / 95) * 100 + 150
            elif pm25 <= 250.4: return ((pm25 - 150.4) / 100) * 100 + 200
            else: return ((pm25 - 250.4) / 249.6) * 200 + 300
            
        if pd.isna(mean_val) or pd.isna(std_val):
            return "volatile"
            
        aqi = calculate_aqi_local(mean_val)
        volatility_ratio = std_val / mean_val if mean_val > 0 else 0
            
        if aqi > 200:
            if volatility_ratio > 0.2:
                return "high_volatile"
            else:
                return "high"
        elif aqi < 100:
            if volatility_ratio > 0.2:
                return "unstable_low"
            else:
                return "stable"
        else:
            if volatility_ratio > 0.2:
                return "volatile"
            else:
                return "moderate"

    df["regime"] = df.apply(map_logical_regime, axis=1)

    # ----------------------------
    # ✅ VALIDATION (IMPORTANT)
    # ----------------------------
    trans = model.transmat_

    print("Transition Matrix:\n", trans)

    if np.any(np.diag(trans) < 0.5):
        print("⚠️ WARNING: Model unstable (too much switching)")

    # ----------------------------
    # SAVE OUTPUT
    # ----------------------------
    predictions = df[[
        "timestamp",
        "value",
        "state",
        "regime",
        "confidence"
    ]]

    predictions.to_csv(output_dir / "predictions.csv", index=False)

    joblib.dump(model, output_dir / "hmm_model.joblib")
    joblib.dump(scaler, output_dir / "scaler.joblib")

    # ----------------------------
    # METADATA
    # ----------------------------
    metadata = {
        "n_states": n_states,
        "rows": int(len(df)),
        "features": feature_cols,
        "log_likelihood": float(model.score(X_scaled))
    }

    with open(output_dir / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    return metadata