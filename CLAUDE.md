# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Good Road** is a road quality monitoring system. Android phones collect GPS + accelerometer data, the backend classifies road events (potholes, speed bumps, vibrations) using ML, spatially clusters them, and delivers audio warnings back to the mobile app.

## Development Commands

All services run via Docker Compose. The Makefile is the primary interface.

```bash
make dev            # First-time setup + start in dev mode (hot-reload)
make start          # Start all services detached
make stop / down    # Stop / stop+remove containers
make rebuild        # Rebuild images and restart
make logs-backend   # Tail backend logs
make test-backend   # Run pytest inside the backend container
make test-connection # Health-check all services
make shell-backend  # bash into backend container
make shell-mongodb  # mongosh road_monitor
```

**Service ports:** backend `8001`, frontend `3000`, Expo DevTools `19002`, MongoDB `27017`

**Backend directly (without Docker):**
```bash
cd backend && uvicorn server:app --reload --port 8001
```

**Frontend:**
```bash
cd frontend
yarn install
yarn start          # Expo dev server
yarn lint           # expo lint
yarn android        # run on connected device/emulator
```

**ML training** (requires separate ROCm venv, AMD GPU optional):
```bash
make ml-setup       # create backend/.venv-ml with PyTorch ROCm
make ml-train       # smoke test with synthetic data
make ml-train-db    # train from MongoDB
make ml-train-prod  # train from production API (goodroad.su)
```

## Architecture

### Data Flow

```
Mobile (GPS + accel) → POST /api/raw-data
    → EventClassifier (pattern rules + optional LSTM neural net)
    → ObstacleClusterer (spatial DBSCAN-style clustering)
    → MongoDB (raw_sensor_data, processed_events, obstacle_clusters, user_warnings)
    ← GET /api/warnings/{device_id}
    ← Audio alert played on phone
```

### Backend (`backend/`)

- `server.py` — FastAPI app, all REST endpoints, startup/shutdown lifecycle
- `ml_processor.py` — `EventClassifier` (threshold rules) + `WarningGenerator`
- `neural_classifier.py` — LSTM-based deep classifier; `nn_backend.py` abstracts CPU/GPU/ONNX/remote backends
- `clustering.py` — `ObstacleClusterer` for spatial aggregation
- `config.py` — MongoDB connection, shared singletons (classifier, clusterer, etc.)
- `models.py` — Pydantic v2 models for all API schemas
- `admin_api.py` — Admin dashboard + bulk event editor (`/api/admin/`)
- `nn_admin_api.py` — Neural network monitoring dashboard (`/api/nn-admin/`)
- `external_training_api.py` — External GPU training endpoint
- `inference_worker.py` — Async background inference service
- `auto_trainer.py` — Automatic model retraining
- `train_model.py` / `train_neural_model.py` — Standalone training scripts
- `model_registry.py` — Versioned model storage in MongoDB
- `dataset_exporter.py` — Export labeled data for training

### Frontend (`frontend/`)

- `app/` — Expo Router file-based routes
  - `index.tsx` — Main monitoring screen (live sensor display + warnings)
  - `audio-settings.tsx`, `autostart-settings.tsx`, `admin.tsx`
- `services/RawDataCollector.ts` — GPS + accelerometer batching (5s intervals), posts to backend
- `services/DynamicAudioAlertService.ts` — Plays TTS/audio warnings
- `services/ObstacleAlertService.ts` — Coordinates warning delivery
- State management: **Zustand** stores in `store/`
- Persistence: **MMKV** (fast KV) + **expo-sqlite**

### ML Classification Logic

Events are classified by `EventClassifier` in `ml_processor.py` using:
- `deltaZ` (vertical acceleration delta) + speed thresholds
- Pothole: `deltaZ > 0.30`, speed ≥ 45 km/h
- Speed bump: `deltaZ > 0.25`, speed 10–45 km/h
- Severity 1 (critical, `deltaZ > 0.35`) → 5 (minimal)

The neural classifier (`neural_classifier.py`) runs in parallel and can override the rule-based result when confidence is high. Backend selection (CPU/GPU/ONNX/remote) is configured via `nn_backend.py`.

### Database Collections (MongoDB `road_monitor`)

- `raw_sensor_data` — raw GPS + accelerometer readings
- `processed_events` — classified events with type, severity, confidence
- `obstacle_clusters` — spatially aggregated obstacles
- `user_warnings` — time-bounded warnings per device

### Environment Variables

Copy `.env.example` files before first run (`make setup`):
- `backend/.env` — `MONGO_URL`, ML model paths, feature flags
- `frontend/.env` — `EXPO_PUBLIC_BACKEND_URL`

### Key API Endpoints

- `POST /api/raw-data` — ingest sensor batch from phone
- `GET /api/warnings/{device_id}` — fetch pending warnings
- `GET /api/admin/dashboard/v3` — unified admin map + editor (HTML)
- `GET /api/admin/ml-settings` — view/edit classification thresholds
- `GET /health` / `GET /ready` — liveness and readiness probes
- `GET /docs` — Swagger UI

## Deployment

- **Local:** Docker Compose (see above)
- **Production:** Kubernetes via `k8s/base/` + `k8s/overlays/`; apply with `kubectl apply -k k8s/overlays/<env>`
- **Mobile build:** EAS Build — `eas build --platform android` from `frontend/`
