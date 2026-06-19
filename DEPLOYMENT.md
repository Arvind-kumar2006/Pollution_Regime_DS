# Deployment Split (Safe Structure)

This project should be deployed as two independent units:

- **Backend (AWS ECS/EC2)**: FastAPI service
- **Frontend (Vercel/Netlify)**: React static app

## Backend deploy root
- **Preferred**: `backend/Dockerfile` (backend-only image)
- **Fallback**: repository root `Dockerfile` (kept for compatibility)
- Container command remains `backend.main:app`

### Build commands
Preferred backend-only build (from repo root):
```bash
docker build -f backend/Dockerfile -t pollution-regime-api:latest .
```

Fallback root build:
```bash
docker build -f Dockerfile -t pollution-regime-api:latest .
```

## Frontend deploy root
- Use `frontend/` as the deploy root
- Build command: `npm run build`
- Publish directory: `dist`
- Required env: `VITE_API_URL=https://your-api-domain`

## Why this is safe
- No source-code moves required
- Existing imports and runtime paths remain intact
- Prevents accidental frontend/backend file mixing in deployments

## Local Docker Compose (dev only)
You can run backend + Postgres locally without changing production deploy flow:

```bash
docker compose up --build
```

Then verify:
- `http://127.0.0.1:8000/health`
- `http://127.0.0.1:8000/health/ready`

Notes:
- This is for local development only.
- Production should continue to use ECS/EC2 + managed Postgres.

