"""Resolve which ModelRun backs dashboard-style views (single source of truth)."""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import desc
from sqlalchemy.orm import Session

from backend.models import ModelRun, RegimePrediction


def get_latest_successful_run_with_predictions(
    db: Session,
    dataset_id: Optional[str] = None,
) -> Optional[ModelRun]:
    """
    Latest run with status success and at least one RegimePrediction row.
    Optionally restrict to a dataset UUID string.
    """
    # Use an explicit inner join so selection is stable across SQLAlchemy versions.
    q = (
        db.query(ModelRun)
        .join(RegimePrediction, RegimePrediction.run_id == ModelRun.run_id)
        .filter(ModelRun.status == "success")
        .group_by(ModelRun.run_id)
    )
    if dataset_id is not None:
        try:
            uid = UUID(dataset_id) if isinstance(dataset_id, str) else dataset_id
        except (ValueError, TypeError):
            return None
        q = q.filter(ModelRun.dataset_id == uid)
    return q.order_by(desc(ModelRun.created_at)).first()
