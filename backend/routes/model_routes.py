import time
from datetime import datetime, timezone
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

from backend.database import SessionLocal
from backend.models import Dataset, ModelRun

from backend.services.hmm_service import predict_service, train_model_service
from backend.services.run_lookup import get_latest_successful_run_with_predictions
from backend.services.settings_service import load_inference_settings
from backend.services.run_metrics import update_run_metrics

router = APIRouter(prefix="/model", tags=["Model"])
logger = logging.getLogger(__name__)


def _api_iso(dt):
    """RFC 3339 string safe for JavaScript Date — never append Z if offset already present."""
    if dt is None:
        return None
    s = dt.isoformat() if hasattr(dt, "isoformat") else str(dt)
    if s.endswith("Z"):
        return s
    # Already has numeric timezone offset (+hh:mm or -hh:mm)
    if len(s) >= 6 and s[-3] == ":" and s[-6] in "+-":
        return s
    return s + "Z"


@router.post("/train")
def train(n_states: Optional[int] = None, dataset_id: Optional[str] = None):
    effective_n = (
        int(n_states)
        if n_states is not None
        else int(load_inference_settings()["n_states"]) 
    )
    t0 = time.perf_counter() # mesure the training duration 
    db = SessionLocal() # used to talk with postgresql 
    try:
        # Backward-compatible behavior: if dataset_id is omitted, consistently use
        # the latest uploaded dataset (never silently fall back to pollution.csv).
        effective_dataset_id: Optional[str] = dataset_id
        target_dataset = None
        if effective_dataset_id: # use latest uploaded dataset
            target_dataset = (
                db.query(Dataset).filter(Dataset.dataset_id == effective_dataset_id).first()
            )
        else:
            target_dataset = db.query(Dataset).order_by(Dataset.uploaded_at.desc()).first()
            effective_dataset_id = str(target_dataset.dataset_id) if target_dataset else None

        if not effective_dataset_id or not target_dataset:
            raise HTTPException(
                status_code=400,
                detail="No dataset available to train on. Upload a dataset first.",
            )

        logger.info(
            "train_request_resolved dataset_id=%s file=%s n_states=%s",
            effective_dataset_id,
            target_dataset.stored_file_name,
            effective_n,
        )

        try:
            result = train_model_service(effective_n, effective_dataset_id)
        except Exception:
            logger.exception("train_model_service_failed dataset_id=%s", effective_dataset_id)
            raise HTTPException(status_code=500, detail="Training failed")

        if result.get("error"):
            raise HTTPException(status_code=500, detail=result["error"])

        new_run = ModelRun(
            n_states=result["n_states"],
            log_likelihood=result["log_likelihood"],
            dataset_id=target_dataset.dataset_id,
            status="running",
        )
        db.add(new_run)
        db.commit()
        db.refresh(new_run)

        logger.info(
            "run_created run_id=%s dataset_id=%s created_at=%s",
            str(new_run.run_id),
            effective_dataset_id,
            _api_iso(new_run.created_at),
        )

        predictions = predict_service(
            limit=5000,
            dataset_id=effective_dataset_id,
            persist_run_id=str(new_run.run_id),
        )
        duration = time.perf_counter() - t0 #

        if predictions.get("error"):
            nr = db.query(ModelRun).filter(ModelRun.run_id == new_run.run_id).first()
            if nr:
                nr.status = "failed"
                nr.error_message = str(predictions["error"])
                nr.execution_duration_sec = duration
                nr.completed_at = datetime.now(timezone.utc)
                db.commit()
            raise HTTPException(status_code=500, detail=predictions["error"])

        update_run_metrics(new_run.run_id, execution_duration_sec=duration)

        nr = db.query(ModelRun).filter(ModelRun.run_id == new_run.run_id).first()
        if nr:
            nr.status = "success"
            nr.completed_at = datetime.now(timezone.utc)
            db.commit()

    finally:
        db.close()

    return result


@router.get("/predict")
def predict(limit: int = 1000, regime: str = None, dataset_id: str = None):
    try:
        db = SessionLocal()
        try:
            if not dataset_id:
                lr = get_latest_successful_run_with_predictions(db)
                if lr and lr.dataset_id:
                    dataset_id = str(lr.dataset_id)
        finally:
            db.close()

        result = predict_service(limit, regime, dataset_id, persist_run_id=None)
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@router.get("/history")
def history():
    db = SessionLocal()
    try:
        from backend.models import RegimePrediction
        from sqlalchemy import func

        runs = (
            db.query(ModelRun, Dataset.original_file_name)
            .outerjoin(Dataset, ModelRun.dataset_id == Dataset.dataset_id)
            .order_by(ModelRun.created_at.desc())
            .all()
        )

        data = []
        for run, original_name in runs:
            stats = db.query(
                func.avg(RegimePrediction.aqi_value).label("avg_aqi"),
                func.max(RegimePrediction.aqi_value).label("peak_aqi"),
                func.avg(RegimePrediction.regime_confidence).label("avg_conf"),
            ).filter(RegimePrediction.run_id == run.run_id).first()

            true_avg_aqi = stats.avg_aqi if stats and stats.avg_aqi else 0
            true_peak_aqi = stats.peak_aqi if stats and stats.peak_aqi else 0
            avg_confidence = stats.avg_conf if stats and stats.avg_conf else 0.0

            dominant_regime_row = (
                db.query(RegimePrediction.regime, func.count(RegimePrediction.regime).label("regime_count"))
                .filter(RegimePrediction.run_id == run.run_id)
                .group_by(RegimePrediction.regime)
                .order_by(func.count(RegimePrediction.regime).desc())
                .first()
            )

            dominant_regime = dominant_regime_row.regime if dominant_regime_row else "Unknown"

            last_conf = (
                db.query(RegimePrediction.regime_confidence)
                .filter(RegimePrediction.run_id == run.run_id)
                .order_by(RegimePrediction.timestamp.desc())
                .first()
            )
            last_conf_val = float(last_conf[0]) if last_conf and last_conf[0] is not None else None

            avg_aqi_out = round(run.avg_aqi, 1) if run.avg_aqi is not None else round(true_avg_aqi, 1)
            peak_aqi_out = round(run.peak_aqi, 1) if run.peak_aqi is not None else round(true_peak_aqi, 1)
            conf_pct = None
            if run.last_confidence is not None:
                conf_pct = round(run.last_confidence * 100, 1)
            elif last_conf_val is not None:
                conf_pct = round(last_conf_val * 100, 1)
            elif avg_confidence > 0:
                conf_pct = round(avg_confidence * 100, 1)

            dur = run.execution_duration_sec if run.execution_duration_sec is not None else None

            data.append(
                {
                    "run_id": str(run.run_id),
                    "dataset_id": str(run.dataset_id) if run.dataset_id else None,
                    "dataset_file_name": original_name,
                    "created_at": _api_iso(run.created_at),
                    "n_states": run.n_states,
                    "log_likelihood": run.log_likelihood,
                    "avg_aqi": avg_aqi_out,
                    "peak_aqi": peak_aqi_out,
                    "final_regime": (
                        run.dominant_regime.capitalize()
                        if run.dominant_regime
                        else dominant_regime.capitalize()
                    ),
                    "confidence": conf_pct,
                    "duration_seconds": round(dur, 2) if dur is not None else 0,
                    "status": (run.status or "success").capitalize()
                    if dominant_regime_row
                    else "Failed",
                }
            )

        success_count = sum([1 for d in data if d["status"] == "Success"])
        global_success_rate = round((success_count / len(data)) * 100) if data else 0

        all_preds = (
            db.query(RegimePrediction.run_id, RegimePrediction.regime)
            .order_by(RegimePrediction.run_id, RegimePrediction.timestamp.asc())
            .all()
        )
        global_total_transitions = 0
        for i in range(1, len(all_preds)):
            if (
                all_preds[i - 1].run_id == all_preds[i].run_id
                and all_preds[i - 1].regime != all_preds[i].regime
            ):
                global_total_transitions += 1

        run_avgs = [d["avg_aqi"] for d in data if d.get("avg_aqi") is not None]
        global_avg_aqi = round(sum(run_avgs) / len(run_avgs), 1) if run_avgs else None

        avg_aqi_delta_vs_prior_mean_pct = None
        if len(data) >= 2:
            latest_avg = data[0].get("avg_aqi")
            prior = [d["avg_aqi"] for d in data[1:] if d.get("avg_aqi") is not None]
            if latest_avg is not None and prior:
                prior_mean = sum(prior) / len(prior)
                if prior_mean > 0:
                    avg_aqi_delta_vs_prior_mean_pct = round(
                        (latest_avg - prior_mean) / prior_mean * 100, 1
                    )

        return {
            "message": "History fetched sequentially",
            "total_runs": len(data),
            "global_avg_aqi": global_avg_aqi,
            "avg_aqi_delta_vs_prior_mean_pct": avg_aqi_delta_vs_prior_mean_pct,
            "global_success_rate": global_success_rate,
            "global_total_transitions": global_total_transitions,
            "data": data,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching history: {str(e)}")
    finally:
        db.close()


@router.get("/info")
def model_info():
    db = SessionLocal()
    try:
        run = get_latest_successful_run_with_predictions(db)
        original_name = None
        if run and run.dataset_id:
            ds = db.query(Dataset).filter(Dataset.dataset_id == run.dataset_id).first()
            original_name = ds.original_file_name if ds else None

        if not run:
            raise HTTPException(status_code=400, detail="No successful model run with predictions")

        return {
            "run_id": str(run.run_id),
            "dataset_file_name": original_name,
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "n_states": run.n_states,
            "log_likelihood": run.log_likelihood,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching model info: {str(e)}")
    finally:
        db.close()


@router.get("/history/{run_id}")
def get_run_details(run_id: str, page: int = 1, limit: int = 100):
    db = SessionLocal()
    try:
        from backend.models import RegimePrediction
        from sqlalchemy import func

        run_record = db.query(ModelRun).filter(ModelRun.run_id == run_id).first()
        if not run_record:
            raise HTTPException(status_code=404, detail="Run not found")

        dataset = db.query(Dataset).filter(Dataset.dataset_id == run_record.dataset_id).first()

        total_rows = (
            db.query(func.count(RegimePrediction.prediction_id))
            .filter(RegimePrediction.run_id == run_id)
            .scalar()
        )

        stats = (
            db.query(
                func.avg(RegimePrediction.aqi_value).label("avg_aqi"),
                func.max(RegimePrediction.aqi_value).label("peak_aqi"),
                func.min(RegimePrediction.timestamp).label("start_ts"),
                func.max(RegimePrediction.timestamp).label("end_ts"),
            )
            .filter(RegimePrediction.run_id == run_id)
            .first()
        )

        counts = (
            db.query(RegimePrediction.regime, func.count("*"))
            .filter(RegimePrediction.run_id == run_id)
            .group_by(RegimePrediction.regime)
            .all()
        )
        count_map = {k: v for k, v in counts}
        stable_pct = (count_map.get("stable", 0) / total_rows * 100) if total_rows else 0
        volatile_pct = (count_map.get("volatile", 0) / total_rows * 100) if total_rows else 0
        high_pct = (count_map.get("high", 0) / total_rows * 100) if total_rows else 0

        predictions = (
            db.query(RegimePrediction)
            .filter(RegimePrediction.run_id == run_id)
            .order_by(RegimePrediction.timestamp.asc())
            .offset((page - 1) * limit)
            .limit(limit)
            .all()
        )

        ds_name = dataset.original_file_name if dataset and dataset.original_file_name else "Unknown"

        return {
            "meta": {
                "run_id": str(run_record.run_id),
                "n_states": run_record.n_states,
                "log_likelihood": run_record.log_likelihood,
                "created_at": str(run_record.created_at),
                "dataset_name": ds_name,
                "total_rows": total_rows,
                "avg_aqi": round(stats.avg_aqi, 1) if stats and stats.avg_aqi else 0,
                "peak_aqi": round(stats.peak_aqi, 1) if stats and stats.peak_aqi else 0,
                "start_ts": str(stats.start_ts) if stats else None,
                "end_ts": str(stats.end_ts) if stats else None,
                "stable_pct": round(stable_pct, 1),
                "volatile_pct": round(volatile_pct, 1),
                "high_pct": round(high_pct, 1),
            },
            "data": [
                {
                    "timestamp": _api_iso(p.timestamp),
                    "observed_value": round(p.aqi_value, 2),
                    "predicted_state": p.predicted_state,
                    "regime": p.regime,
                    "confidence": round(p.regime_confidence, 4) if p.regime_confidence is not None else None,
                }
                for p in predictions
            ],
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("get_run_details_failed run_id=%s", run_id)
        raise HTTPException(status_code=500, detail="Failed to load run details")
    finally:
        db.close()


@router.delete("/history/{run_id}")
def delete_run(run_id: str):
    db = SessionLocal()
    try:
        from backend.models import RegimePrediction

        db.query(RegimePrediction).filter(RegimePrediction.run_id == run_id).delete(
            synchronize_session=False
        )

        row = db.query(ModelRun).filter(ModelRun.run_id == run_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Run mapping unfound or already deleted.")

        db.delete(row)
        db.commit()

        return {"message": "Run purged completely."}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database cascade destruction failed: {str(e)}")
    finally:
        db.close()


@router.get("/dashboard/latest")
def dashboard_latest():
    db = SessionLocal()
    try:
        from backend.models import RegimePrediction
        import pandas as pd

        latest_run = get_latest_successful_run_with_predictions(db)
        if not latest_run:
            return None

        target_dataset = db.query(Dataset).filter(Dataset.dataset_id == latest_run.dataset_id).first()

        predictions = (
            db.query(RegimePrediction)
            .filter(RegimePrediction.run_id == latest_run.run_id)
            .order_by(RegimePrediction.timestamp.asc())
            .all()
        )

        if not predictions:
            return None

        df = pd.DataFrame(
            [
                {
                    "timestamp": p.timestamp,
                    "aqi": p.aqi_value,
                    "regime": p.regime,
                    "confidence": p.regime_confidence if p.regime_confidence is not None else 0.0,
                }
                for p in predictions
            ]
        )

        latest = df.iloc[-1]
        first = df.iloc[0]

        avg_aqi = df["aqi"].mean()
        peak_aqi = df["aqi"].max()
        min_aqi = df["aqi"].min()

        transitions = []
        for i in range(1, len(df)):
            if df.iloc[i - 1]["regime"] != df.iloc[i]["regime"]:
                time_val = _api_iso(df.iloc[i]["timestamp"]) if pd.notnull(df.iloc[i]["timestamp"]) else ""
                transitions.append(
                    {
                        "from": str(df.iloc[i - 1]["regime"]),
                        "to": str(df.iloc[i]["regime"]),
                        "timestamp": time_val,
                        "timeStr": pd.to_datetime(df.iloc[i]["timestamp"]).strftime("%b %d, %I:%M %p"),
                        "confidence": float(df.iloc[i]["confidence"]),
                    }
                )

        insights = []
        pct_change = ((latest["aqi"] - first["aqi"]) / first["aqi"]) * 100 if first["aqi"] > 0 else 0
        insights.append(f"AQI changed by {pct_change:.1f}% over the selected window.")
        insights.append(f"Peak AQI reached {peak_aqi:.1f}.")
        if len(transitions) > 0:
            insights.append(f"{len(transitions)} distinct regime transitions detected.")

        regime_counts = df["regime"].value_counts().to_dict()

        chart = []
        for _, row in df.iterrows():
            time_str = (
                pd.to_datetime(row["timestamp"]).strftime("%b %d, %H:%M")
                if not pd.isna(row["timestamp"])
                else ""
            )
            chart.append(
                {
                    "timeStr": time_str,
                    "value": round(float(row["aqi"]), 1),
                    "regime": str(row["regime"]),
                    "confidence": round(float(row["confidence"]), 4),
                }
            )

        ds_name = (
            target_dataset.original_file_name
            if target_dataset and target_dataset.original_file_name
            else "Unknown"
        )

        gen_at = latest_run.completed_at or latest_run.created_at
        return {
            "run_id": str(latest_run.run_id),
            "dataset_name": ds_name,
            "generated_at": _api_iso(gen_at),
            "summary": {
                "current_aqi": round(float(latest["aqi"]), 1),
                "current_regime": str(latest["regime"]),
                "confidence": round(float(latest["confidence"]), 4),
            },
            "chart": chart,
            "stats": {
                "avg_aqi": round(float(avg_aqi), 1),
                "peak_aqi": round(float(peak_aqi), 1),
                "min_aqi": round(float(min_aqi), 1),
                "total_rows": len(df),
                "transition_count": len(transitions),
            },
            "regime_distribution": regime_counts,
            "recent_transitions": transitions[-15:][::-1],
            "insights": insights,
        }

    except Exception:
        logger.exception("dashboard_latest_failed")
        raise HTTPException(status_code=500, detail="Dashboard query failed")
    finally:
        db.close()


@router.get("/advanced-analytics")
def advanced_analytics(days: int = None):
    db = SessionLocal()
    try:
        from backend.models import RegimePrediction
        from sqlalchemy import func
        import pandas as pd

        run_row = get_latest_successful_run_with_predictions(db)
        if not run_row:
            raise HTTPException(
                status_code=400,
                detail="No successful model run with predictions to analyze.",
            )

        query = db.query(RegimePrediction).filter(RegimePrediction.run_id == run_row.run_id)

        if days is not None:
            max_ts = (
                db.query(func.max(RegimePrediction.timestamp))
                .filter(RegimePrediction.run_id == run_row.run_id)
                .scalar()
            )
            if max_ts:
                from datetime import timedelta

                query = query.filter(RegimePrediction.timestamp >= (max_ts - timedelta(days=days)))

        predictions = query.order_by(RegimePrediction.timestamp.asc()).all()

        if not predictions:
            return {"transitions": [], "hourly": [], "confidence": []}

        transition_counts = {}
        for i in range(1, len(predictions)):
            prev_regime = predictions[i - 1].regime
            curr_regime = predictions[i].regime
            if prev_regime != curr_regime:
                hop_key = f"{prev_regime} → {curr_regime}"
                transition_counts[hop_key] = transition_counts.get(hop_key, 0) + 1

        transitions = []
        total_transitions = sum(transition_counts.values()) if transition_counts else 1

        for key, val in transition_counts.items():
            s, t = key.split(" → ")
            pct = (val / total_transitions) * 100
            transitions.append(
                {"source": s, "target": t, "count": val, "label": key, "percentage": round(pct, 1)}
            )

        transitions = sorted(transitions, key=lambda x: x["count"], reverse=True)

        df = pd.DataFrame(
            [
                {
                    "timestamp": p.timestamp,
                    "value": p.aqi_value,
                    "confidence": p.regime_confidence if p.regime_confidence else 0.0,
                }
                for p in predictions
            ]
        )

        df["hour"] = df["timestamp"].dt.hour
        hourly_grouped = df.groupby("hour")["value"].mean().reset_index()

        hourly = []
        for _, row in hourly_grouped.iterrows():
            h = int(row["hour"])
            avg = round(float(row["value"]), 1)
            hourly.append(
                {
                    "hour_int": h,
                    "time_label": f"{h:02d}:00",
                    "avg_aqi": avg,
                }
            )

        hourly = sorted(hourly, key=lambda x: x["hour_int"])

        highest_hour_str = max(hourly, key=lambda x: x["avg_aqi"])["time_label"] if hourly else "N/A"
        lowest_hour_str = min(hourly, key=lambda x: x["avg_aqi"])["time_label"] if hourly else "N/A"

        recent_hourly_conf = df.groupby(df["timestamp"].dt.floor("H"))["confidence"].mean().tail(48).reset_index()

        confidence = []
        for i, row in recent_hourly_conf.iterrows():
            score = float(row["confidence"]) * 100 if not pd.isna(row["confidence"]) else 0.0
            time_label = (
                pd.to_datetime(row["timestamp"]).strftime("%H:%M")
                if not pd.isna(row["timestamp"])
                else f"{i}h"
            )

            confidence.append({"time": time_label, "score": round(score, 1)})

        window_note = (
            "Full run (same window as Dashboard)"
            if days is None
            else f"Last {days} day(s) before latest timestamp (subset of the same run as Dashboard)"
        )

        return {
            "run_id": str(run_row.run_id),
            "dataset_id": str(run_row.dataset_id) if run_row.dataset_id else None,
            "prediction_window": "full_run" if days is None else f"last_{days}_days",
            "window_note": window_note,
            "transitions": transitions,
            "total_transitions": sum(transition_counts.values()),
            "hourly": hourly,
            "insights": {
                "highest_hour": highest_hour_str,
                "lowest_hour": lowest_hour_str,
            },
            "confidence": confidence,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error evaluating advanced analytics: {str(e)}")
    finally:
        db.close()
