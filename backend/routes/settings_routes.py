from __future__ import annotations

from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Body, Depends, Header, HTTPException
from sqlalchemy import func

from backend.database import SessionLocal
from backend.models import SystemSettings
from pydantic import ValidationError

from backend.schemas.settings import SettingsFull, coerce_settings_dict
from backend.config import APP_ENV, SETTINGS_API_KEY
from backend.services.settings_service import (
    ALLOWED_SETTING_KEYS,
    CONFIG_VERSION_KEY,
    load_inference_settings,
)

router = APIRouter(prefix="/settings", tags=["Settings"])
logger = logging.getLogger(__name__)


def require_settings_write_key(
    x_api_key: str | None = Header(default=None, alias="X-API-KEY"),
) -> None:
    """
    Lightweight write protection.
    - Dev: if SETTINGS_API_KEY is unset, allow writes (local convenience).
    - Prod: require SETTINGS_API_KEY and matching X-API-KEY.
    """
    if APP_ENV != "production" and not SETTINGS_API_KEY:
        return
    if not SETTINGS_API_KEY:
        raise HTTPException(status_code=500, detail="SETTINGS_API_KEY is not configured")
    if not x_api_key or x_api_key != SETTINGS_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    s = dt.isoformat()
    if s.endswith("Z"):
        return s
    if len(s) >= 6 and s[-3] == ":" and s[-6] in "+-":
        return s
    return s + "Z"


def _read_config_version(db) -> int:
    row = (
        db.query(SystemSettings)
        .filter(SystemSettings.setting_key == CONFIG_VERSION_KEY)
        .first()
    )
    if not row or row.setting_value is None:
        return 0
    try:
        return int(row.setting_value)
    except (TypeError, ValueError):
        return 0


def _bump_config_version(db) -> None:
    current = _read_config_version(db)
    new_v = current + 1
    row = (
        db.query(SystemSettings)
        .filter(SystemSettings.setting_key == CONFIG_VERSION_KEY)
        .first()
    )
    now = datetime.now(timezone.utc)
    if row:
        row.setting_value = new_v
        row.updated_at = now
    else:
        db.add(
            SystemSettings(
                setting_key=CONFIG_VERSION_KEY,
                setting_value=new_v,
                updated_at=now,
            )
        )


def _last_updated_at(db) -> datetime | None:
    return (
        db.query(func.max(SystemSettings.updated_at))
        .filter(SystemSettings.setting_key.in_(tuple(ALLOWED_SETTING_KEYS)))
        .scalar()
    )


def _build_response(db) -> dict:
    settings = load_inference_settings()
    return {
        "settings": settings,
        "meta": {
            "last_updated_at": _iso(_last_updated_at(db)),
            "config_version": _read_config_version(db),
        },
    }


def _upsert_value(db, key: str, value) -> None:
    row = db.query(SystemSettings).filter(SystemSettings.setting_key == key).first()
    now = datetime.now(timezone.utc)
    if row:
        row.setting_value = value
        row.updated_at = now
    else:
        db.add(SystemSettings(setting_key=key, setting_value=value, updated_at=now))


@router.get("/")
def get_settings():
    db = SessionLocal()
    try:
        return _build_response(db)
    except Exception:
        logger.exception("get_settings_failed")
        raise HTTPException(status_code=500, detail="Failed to load settings")
    finally:
        db.close()


def _apply_put(db, payload: dict) -> dict:
    if not payload:
        return _build_response(db)

    patch = dict(payload)
    if "hidden_states" in patch and "n_states" not in patch:
        patch["n_states"] = patch.pop("hidden_states")
    elif "hidden_states" in patch:
        patch.pop("hidden_states", None)

    for key in patch:
        if key not in ALLOWED_SETTING_KEYS:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown setting key: {key!r}. Allowed: {sorted(ALLOWED_SETTING_KEYS)}",
            )

    merged = dict(load_inference_settings())
    for k, v in patch.items():
        merged[k] = v

    try:
        merged = coerce_settings_dict(merged)
        validated = SettingsFull.model_validate(merged)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors()) from e

    dumped = validated.model_dump(mode="python")
    for k in patch:
        if k in dumped:
            _upsert_value(db, k, dumped[k])

    _bump_config_version(db)
    db.commit()
    return _build_response(db)


def _put_settings_handler(payload: dict):
    db = SessionLocal()
    try:
        return _apply_put(db, payload)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception("put_settings_failed")
        raise HTTPException(status_code=500, detail="Failed to update settings")
    finally:
        db.close()


@router.put("/")
def put_settings(payload: dict = Body(...), _auth: None = Depends(require_settings_write_key)):
    return _put_settings_handler(payload)


@router.post("/reset")
def reset_settings(_auth: None = Depends(require_settings_write_key)):
    db = SessionLocal()
    try:
        keys = tuple(ALLOWED_SETTING_KEYS) + (CONFIG_VERSION_KEY,)
        db.query(SystemSettings).filter(SystemSettings.setting_key.in_(keys)).delete(
            synchronize_session=False
        )
        db.commit()
        return _build_response(db)
    except Exception:
        db.rollback()
        logger.exception("reset_settings_failed")
        raise HTTPException(status_code=500, detail="Failed to reset settings")
    finally:
        db.close()
