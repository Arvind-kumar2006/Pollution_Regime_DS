"""Runtime configuration from environment (no secrets in code)."""
import os

# Environment: development | production
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()

# Comma-separated origins, or "*" for development only (disables credentials with browsers)
CORS_ORIGINS_RAW = os.environ.get("CORS_ORIGINS", "*")

# Max CSV upload size (MB)
UPLOAD_MAX_MB = int(os.environ.get("UPLOAD_MAX_MB", "50"))

# Settings write protection
SETTINGS_API_KEY = os.environ.get("SETTINGS_API_KEY", "").strip()


def cors_origins_list():
    s = CORS_ORIGINS_RAW.strip()
    if APP_ENV == "production" and (not s or s == "*"):
        raise RuntimeError("In production, set CORS_ORIGINS to explicit origins (not '*').")
    if s == "*":
        return ["*"]
    return [o.strip() for o in s.split(",") if o.strip()]


# Storage Directories
from pathlib import Path
DATA_DIR = Path(os.environ.get("DATA_DIR", "data").strip())
ARTIFACTS_DIR = Path(os.environ.get("ARTIFACTS_DIR", "artifacts").strip())

