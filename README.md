# Pollution Regime Classification (HMM)

Production-ready full-stack analytics application that classifies **hidden pollution regimes** (stable, volatile, high) from air-quality time series using **Hidden Markov Models (HMM)**.

## Project overview
This project provides an end-to-end pipeline for:
- uploading pollution datasets,
- training an HMM-based regime model,
- persisting predictions and run metadata,
- visualizing current and historical behavior in a React dashboard.

It is built to be operationally practical with configuration validation, readiness checks, and consistent run selection across analytics endpoints.

## Problem statement
Air-quality streams are noisy and change over time. Static thresholding alone misses temporal behavior and transitions.  
This system combines sequence modeling (HMM) with domain thresholds and UI analytics so users can detect regime shifts, confidence trends, and run-to-run differences reliably.

## Features
- CSV dataset upload with preview and metadata persistence
- HMM model training with configurable hidden states
- Regime inference with confidence scoring
- Dashboard with current AQI/regime/confidence, trend chart, and transitions
- Advanced analytics (transition matrix, hourly aggregates, confidence trend)
- Run history and run detail views for auditability
- Validated settings API with reset support and metadata (`last_updated_at`, `config_version`)
- Canonical latest successful run logic for consistent dashboard data sources
- Health + readiness endpoints for deployment checks

## Architecture
- **Frontend**: React, Tailwind CSS, Recharts
- **Backend**: FastAPI, SQLAlchemy
- **Database**: PostgreSQL
- **ML/Data**: hmmlearn, scikit-learn, pandas, numpy

### High-level flow
1. Upload dataset (`/data/upload`) -> store file metadata in `datasets`.
2. Train model (`/model/train`) -> create `model_runs` row and artifacts.
3. Predict regimes -> persist `regime_predictions`.
4. Dashboard and analytics endpoints read canonical latest successful run.

## Screenshots
Image-heavy sections were removed as requested.  
Add project screenshots under `docs/screenshots/`:
- `dashboard.png`
- `upload.png`
- `history.png`
- `advanced.png`
- `settings.png`

## API endpoints

### Data
- `POST /data/upload`
  - Upload CSV dataset
  - Returns: `dataset_id`, `columns`, `preview`, `metrics_status`

### Model
- `POST /model/train?n_states=&dataset_id=`
  - Train on dataset and create a new run
  - Persists predictions linked to the same `run_id` + `dataset_id`
- `GET /model/dashboard/latest`
  - Unified payload for dashboard widgets
- `GET /model/history`
  - List runs and aggregate metrics
- `GET /model/history/{run_id}`
  - Run-specific details and paginated predictions
- `GET /model/advanced-analytics?days=`
  - Transition matrix + confidence/hourly analytics
- `GET /model/info`
  - Canonical latest successful run metadata

### Settings
- `GET /settings/`
  - Returns `{ settings, meta }`
- `PUT /settings/`
  - Write settings (write-protected in production)
- `POST /settings/reset`
  - Reset to defaults (write-protected in production)

### Health
- `GET /health` (liveness)
- `GET /health/ready` (DB readiness check)

## Local setup

### Prerequisites
- Node.js 18+
- Python 3.11+
- PostgreSQL 14+

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/pollution_db"
export APP_ENV=development
export CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"

alembic upgrade head
uvicorn backend.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
echo 'VITE_API_URL=http://127.0.0.1:8000' > .env.local
npm run dev
```

Open: `http://localhost:5173`

### Health checks
- `GET http://127.0.0.1:8000/health`
- `GET http://127.0.0.1:8000/health/ready`

## Production deployment (AWS EC2)
Recommended split:
- React static frontend (Nginx or static host)
- FastAPI backend behind reverse proxy
- PostgreSQL (RDS preferred)

### Deployment roots (important)
- **Backend deploy root (preferred)**: use `backend/Dockerfile` for backend-only builds
- **Backend fallback**: repository root `Dockerfile` (kept working)
- **Frontend deploy root**: `frontend/` (for Vercel/Netlify)

Backend image build commands:
```bash
# Preferred
docker build -f backend/Dockerfile -t pollution-regime-api:latest .

# Fallback
docker build -f Dockerfile -t pollution-regime-api:latest .
```

For Vercel/Netlify:
- set **Root Directory** to `frontend`
- set build command to `npm run build`
- set output directory to `dist`
- set env `VITE_API_URL=https://your-api-domain`

### Required backend env (production)
- `APP_ENV=production`
- `DATABASE_URL=postgresql://...`
- `CORS_ORIGINS=https://your-frontend-domain`
- `SETTINGS_API_KEY=...`
- `UPLOAD_MAX_MB=50`
- `SQL_ECHO=false`

### Required frontend env
- `VITE_API_URL=https://api.your-domain`

### Hardening checklist
- TLS termination at proxy/LB
- Restrictive security groups
- Persistent storage (EBS/S3) for `data/` and `artifacts/`
- Lock down `/docs` and `/redoc` if public
- Add rate limiting at proxy/CDN

## Environment variables

### Backend `.env.example`
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/pollution_db
APP_ENV=development
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
UPLOAD_MAX_MB=50
SQL_ECHO=false
# SETTINGS_API_KEY=change_me
```

### Frontend `.env.example`
```env
VITE_API_URL=http://127.0.0.1:8000
```

## How HMM works in this project
- Input CSV is cleaned and transformed into model features
- Features are standardized using a persisted scaler
- HMM is trained with configurable `n_states`
- Hidden behavior is mapped to logical regimes (`stable`, `volatile`, `high`)
- Confidence values and transitions are computed and stored
- Analytics endpoints query stored predictions from canonical runs

## Folder structure
```text
Pollution_Regime_Classification/
  backend/
    backend/
      routes/
      services/
      schemas/
      main.py
      database.py
      models.py
    alembic/
    alembic.ini
    requirements.txt
    .env.example
  frontend/
    src/
      api/
      pages/
      components/
      context/
    .env.example
  docs/
  README.md
```

## Operational notes
- Trained artifacts are written to `artifacts/` at runtime.
- Uploaded datasets are written to `data/`.
- For production, use persistent storage or object storage (S3).
- Training is synchronous; for scale, move training to a background job queue.

## Troubleshooting
- **CORS blocked**: set `CORS_ORIGINS` correctly and restart backend.
- **DB auth failed**: verify `DATABASE_URL` credentials.
- **Training timeout**: long runs are expected; frontend train timeout is extended, but async jobs are recommended for scale.

## Future improvements
- Background training jobs + progress polling
- Auth and role-based access control
- CI/CD with automated tests and deployment checks
- S3 integration for uploads/artifacts

## Resume-ready highlights
- Built a full-stack ML analytics platform (FastAPI + React) for pollution regime classification using HMM.
- Implemented persistent run/prediction storage with PostgreSQL for reproducible analytics.
- Enforced canonical latest successful run selection to eliminate dashboard data-source drift.
- Added production hardening: settings validation, readiness checks, env-driven config, and write protection.

## GitHub project description
Pollution Regime Classification is a full-stack machine learning analytics app that detects latent pollution regimes from air-quality time series using Hidden Markov Models, with upload/train/inference workflows and interactive dashboard analytics.

## Recommended GitHub topics
`fastapi`, `react`, `tailwindcss`, `recharts`, `postgresql`, `sqlalchemy`, `pandas`, `numpy`, `hmmlearn`, `hidden-markov-model`, `time-series`, `analytics-dashboard`, `data-visualization`

## Author
Arvind Kumar