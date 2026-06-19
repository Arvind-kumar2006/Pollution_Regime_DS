import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# ----------------------------
# DATABASE URL
# ----------------------------
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is required. Set it in the environment (see backend/.env.example)."
    )
# ----------------------------
# ENGINE (connection to DB)
# ----------------------------
engine = create_engine(
    DATABASE_URL,
    echo=os.environ.get("SQL_ECHO", "").lower() in ("1", "true", "yes"),
)
# ----------------------------
# SESSION (used to interact with DB)
# ----------------------------
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

# ----------------------------
# BASE CLASS (used for ORM models)
# ----------------------------
Base = declarative_base()
# ----------------------------
# DEPENDENCY (optional, for FastAPI)
# ----------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
