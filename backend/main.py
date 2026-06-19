from fastapi import FastAPI
from fastapi import HTTPException # use to return error 
from fastapi.middleware.cors import CORSMiddleware

from backend.config import cors_origins_list
from backend.database import engine
from backend.routes import data
from backend.routes import model_routes
from backend.routes import settings_routes

_origins = cors_origins_list()
_use_wildcard = _origins == ["*"]

app = FastAPI(title="Pollution API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=not _use_wildcard,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)
app.include_router(model_routes.router)
app.include_router(settings_routes.router)


@app.get("/")
def home():
    return {"message": "API running"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        return {"status": "ok"}
    except Exception:
        # Do not leak internals
        raise HTTPException(status_code=503, detail="Service not ready")