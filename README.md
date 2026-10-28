# Good Road — система обнаружения плохих дорог

Мобильное приложение (React Native / Expo) + backend (FastAPI + MongoDB),
который по данным акселерометра смартфона определяет ямы и плохие участки
дорог, агрегирует события от устройств и визуализирует их на карте.

## Архитектура

```
┌─────────────┐   GPS/accelerometer    ┌──────────────────┐
│  Frontend    │ ───── batch POST ───▶ │  Backend FastAPI  │
│  Expo RN     │                       │  backend/server.py│
└─────────────┘ ◀── events/clusters ── └────────┬─────────┘
                                                │
                                     ┌──────────▼──────────┐
                                     │  MongoDB (raw data,  │
                                     │  events, clusters,   │
                                     │  ML inference logs)  │
                                     └─────────────────────┘
```

- **backend/** — FastAPI-сервер: приём телеметрии, кластеризация точек,
  детекция событий, ML-классификатор, админ-API.
  - `server.py` — сборка приложения и основные роуты;
  - `routers/` — вынесенные домены: `ingest`, `calibration`, `deploy`, `opencode`;
  - `security.py` — аутентификация админ-API (`ADMIN_API_TOKEN`);
  - `services/` — geo-утилиты, кластеризация, классификатор.
- **frontend/** — экспo-приложение (Expo Router): карта, трекинг, настройки.
- **tests/** — pytest-сьют (geo, rate limit, API-контракты).

## Быстрый старт

### Backend (dev)

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env        # заполните MONGODB_URL, ADMIN_API_TOKEN
uvicorn server:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm start                   # Expo dev server
```

### Docker Compose (backend + MongoDB)

```bash
docker compose up -d
```

## Конфигурация окружения

| Переменная | Обязательно | Описание |
|---|---|---|
| `MONGODB_URL` | да | Строка подключения к MongoDB |
| `MONGODB_DB` | нет | Имя БД (по умолчанию `goodroad`) |
| `ENVIRONMENT` | да в проде | `production` включает fail-fast без токена |
| `ADMIN_API_TOKEN` | да в проде | Токен для всех `/admin*` и `/api/admin*` |
| `CORS_ORIGINS` | нет | Список origin через запятую; пусто = `*` без credentials |

## Безопасность

Все админские эндпоинты защищены bearer-токеном
(`Authorization: Bearer <ADMIN_API_TOKEN>` или заголовок `X-Admin-Token`).
В продакшене сервер не стартует без установленного токена.

## Тесты и CI

```bash
pytest tests/ -v            # backend
cd frontend && npm test     # jest (EventDetector и др.)
```

CI (GitHub Actions, `.github/workflows/ci.yml`): компиляция backend,
pytest, eslint и jest на каждый push/PR.

## Структура репозитория

```
backend/      FastAPI сервер, роутеры, сервисы, ML
frontend/     Expo React Native приложение
tests/        pytest тесты
docs/         документация и отчёты
scripts/      вспомогательные скрипты развёртывания
```
