import io
import logging
import uuid
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.config import UPLOAD_MAX_MB, DATA_DIR
from backend.database import SessionLocal
from backend.models import Dataset

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data", tags=["Data"])

_MAX_BYTES = UPLOAD_MAX_MB * 1024 * 1024

DATA_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    # --- Validate filename ---
    safe_filename = Path(file.filename).name
    if not safe_filename or safe_filename in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename")

    if not safe_filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    unique_prefix = str(uuid.uuid4())[:8]
    secure_filename = f"{unique_prefix}_{safe_filename}"
    file_path = DATA_DIR / secure_filename

    # --- Read file bytes ---
    contents = await file.read()

    if len(contents) > _MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large (max {UPLOAD_MAX_MB} MB)",
        )

    # --- Save to disk ---
    try:
        file_path.write_bytes(contents)
    except OSError as e:
        logger.exception("Failed to write uploaded file to disk")
        raise HTTPException(status_code=500, detail=f"File storage error: {e}")

    # --- Parse CSV (auto-detect separator) ---
    try:
        sample = contents[:4096].decode("utf-8", errors="replace")
        sep = ";" if sample.count(";") > sample.count(",") else ","
        df = pd.read_csv(io.BytesIO(contents), sep=sep)
        if df.shape[1] < 2:
            # Retry with the other separator
            sep = "," if sep == ";" else ";"
            df = pd.read_csv(io.BytesIO(contents), sep=sep)
    except Exception as e:
        logger.exception("Failed to parse uploaded CSV")
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"CSV parse error: {e}")

    # --- Build JSON-safe preview ---
    def to_jsonable(value):
        if pd.isna(value):
            return None
        if isinstance(value, (np.integer, np.floating, np.bool_)):
            return value.item()
        if isinstance(value, pd.Timestamp):
            return value.isoformat()
        return value

    preview_df = df.head(5).where(pd.notnull(df.head(5)), None)
    raw_preview_json = [
        {k: to_jsonable(v) for k, v in row.items()}
        for row in preview_df.to_dict(orient="records")
    ]

    rel_path = str(DATA_DIR / secure_filename)

    # --- Persist to DB ---
    try:
        db = SessionLocal()
        try:
            new_dataset = Dataset(
                original_file_name=safe_filename,
                stored_file_name=secure_filename,
                file_path=rel_path,
                row_count=len(df),
                file_size_bytes=len(contents),
                upload_status="completed",
                preview_json=raw_preview_json,
            )
            db.add(new_dataset)
            db.commit()
            db.refresh(new_dataset)
        finally:
            db.close()
    except Exception as e:
        logger.exception("Database error while saving dataset record")
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    # --- Build preview response ---
    preview_rows = []
    for row in raw_preview_json[:5]:
        ts = f"{row.get('Date', '')} {row.get('Time', '')}".strip()
        raw_val = str(row.get("CO(GT)", "0")).replace(",", ".")
        try:
            clean_val = round(float(raw_val), 2)
        except ValueError:
            clean_val = 0.0
        preview_rows.append({"timestamp": ts, "value": clean_val})

    # --- Compute quick metrics ---
    avg_val = None
    volatility = None
    metrics_status = "not_computed"
    if "CO(GT)" in df.columns:
        co_gt_num = pd.to_numeric(
            df["CO(GT)"].astype(str).str.replace(",", ".", regex=False), errors="coerce"
        )
        if not co_gt_num.isna().all():
            avg_val_f = float(co_gt_num.mean())
            std_val_f = float(co_gt_num.std()) if not pd.isna(co_gt_num.std()) else None
            if not pd.isna(avg_val_f) and std_val_f is not None and not pd.isna(std_val_f):
                avg_val = round(avg_val_f, 1)
                ratio = (std_val_f / max(avg_val_f, 1.0))
                volatility = f"{'High' if std_val_f > 2 else 'Normal'} ({ratio:.2f})"
                metrics_status = "computed"

    return {
        "message": "Uploaded",
        "rows": len(df),
        "columns": list(df.columns),
        "dataset_id": str(new_dataset.dataset_id),
        "filename": secure_filename,
        "preview": preview_rows,
        "avg_aqi": avg_val,
        "expected_volatility": volatility,
        "metrics_status": metrics_status,
    }
