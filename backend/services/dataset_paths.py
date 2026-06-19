"""Resolve CSV paths for training and prediction from Dataset rows."""
from __future__ import annotations

from pathlib import Path
from backend.config import DATA_DIR


def resolve_dataset_csv_path(dataset) -> Path | None:
    """Return path to on-disk CSV for a Dataset row, or None if unusable."""
    if dataset is None:
        return None
    fp = getattr(dataset, "file_path", None)
    if fp:
        p = Path(fp)
        if p.is_absolute():
            return p if p.exists() else None
        
        # Check relative to DATA_DIR first
        cand = DATA_DIR / p.name
        if cand.exists():
            return cand

        cand = Path.cwd() / p
        return cand if cand.exists() else None
    stored = getattr(dataset, "stored_file_name", None)
    if stored:
        cand = DATA_DIR / stored
        return cand if cand.exists() else None
    return None

