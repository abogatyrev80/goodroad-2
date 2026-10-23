# План улучшений Good Road

Актуальный статус: **шаги 1–3.5 выполнены** (см. git log). Ниже — оставшиеся задачи по порядку.

## ✅ Выполнено
- [x] **Шаг 1.** Исправлен синтаксический дефект в `backend/server.py` (недостижимый `except` после `return`).
- [x] **Шаг 2.** Безопасность:
  - `backend/security.py`: `verify_admin_token` (Bearer / X-Admin-Token / ?token=, `secrets.compare_digest`, fail-fast в prod без `ADMIN_API_TOKEN`);
  - middleware закрывает `/admin*`, `/api/admin*`; роутеры `deploy`/`opencode` защищены;
  - CORS: `allow_credentials=True` только при явном `CORS_ORIGINS`.
- [x] **Шаг 3.** Сервер импортируется (`import server` → OK), убраны двойные обёртки `Depends(Depends(...))`, удалены print-блоки, исправлены дубли маршрутов.
- [x] **Шаг 3.5.** Найден и исправлен критический баг единиц измерения:
  - `services/geo.calculate_distance` теперь документированно возвращает **километры**;
  - согласованы потребители: `clustering.CLUSTER_RADIUS` (0.001 км = 1 м), `ml_processor.warning_distance` (0.2 км), тексты предупреждений (м), публичные эндпоинты `/obstacles/nearby`, `/road-conditions`, `/warnings` принимают `radius` в **метрах** и отдают `distance` в метрах (контракт для мобильного клиента сохранён).
- [x] **Тесты запущены:** 8 passed. Причина падения pytest устранена — конфликтующий плагин `libtmux` отключён в `pytest.ini` (`-p no:libtmux`).

## ⏳ Осталось (по порядку)

### Шаг 4. Тесты и CI (в процессе)
- [ ] API-тесты контрактов через `TestClient` + `mongomock-motor`:
  - `/health` → 200;
  - админ-эндпоинты без токена → 401, с токеном → 200;
  - регрессия единиц: расстояние Мск–СПб ≈ 634 км; `/obstacles/nearby?radius=1000` фильтрует по 1 км.
- [ ] Тесты кластеризации (`clustering.find_nearby_cluster`) и `ml_processor.should_warn_user`.
- [ ] GitHub Actions: backend (pytest + ruff) + frontend (tsc --noEmit + eslint + jest) на PR.
- [ ] В `frontend/package.json` добавить `"test": "jest"` (тесты есть, скрипта нет).

### Шаг 5. Декомпозиция backend
- [ ] Вынести из `server.py` (~2190 строк) роутеры: `admin_analytics.py`, `admin_sensor_data.py`, `admin_clusters.py`, `public_road_data.py` (обслуженные уже: calibration, ingest, deploy, opencode).
- [ ] Объединить дубли: `clear-database` / `clear-database-v2`, две версии `cleanup_old_data`.
- [ ] Глобальные состояния `config.db` / `rate_limit_store` → `app.state` + DI.
- [ ] Конфиг: единый `pydantic.BaseSettings` + `.env.example`.
- [ ] Заменить оставшиеся `print()` на `logging`.

### Шаг 6. Данные и ML
- [ ] Явные миграции индексов MongoDB на startup (без `except: pass`); индексы `timestamp+device_id` для админ-запросов.
- [ ] TTL-индексы для raw-данных и `ml_inference_logs` вместо ручного `cleanup-old-data`.

### Шаг 7. Frontend
- [ ] Свести 7 однотипных `*-settings.tsx` к конфигу-драйвенному экрану.
- [ ] Ревизия зависимостей package.json (удалить неиспользуемые expo-*), выбрать что-то одно: `expo-av` или `expo-audio`.
- [ ] Синхронизация офлайн-батчей: backoff+jitter, дедупликация по client-side UUID.

### Шаг 8. Эксплуатация
- [ ] Redis-backed rate limiter (для нескольких реплик k8s).
- [ ] Чистка репозитория: перенос/удаление ~30 ad-hoc md-отчётов и бинарных артефактов в корне, нормальный README, `.gitignore` для tmp-файлов, pre-commit + detect-secrets.

## Переменные окружения (для продакшена)
| Переменная | Обязательно | Назначение |
|---|---|---|
| `ADMIN_API_TOKEN` | да (prod) | токен для всех admin/deploy эндпоинтов |
| `ENVIRONMENT` | да | `production` включает fail-fast без токена |
| `CORS_ORIGINS` | да (prod) | CSV-список разрешённых origins |
