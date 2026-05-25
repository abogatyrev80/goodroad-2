# Good Road — План улучшений

## Фаза 1: Санация кода (мёртвые файлы, стиль)

### 1.1 Удалить мёртвые файлы бэкенда
- `backend/server-original.py`
- `backend/server-optimized.py`
- `backend/server.py.backup_before_cleanup`
- `backend/ml_processor — копия.py`

### 1.2 Удалить мёртвые файлы фронтенда
- `frontend/backups/` — вся папка
- `frontend/dist-deployment-ready/` — вся папка
- `frontend/dist-final/` — вся папка
- `frontend/app/admin.tsx` (если есть `admin-simple.tsx`)

### 1.3 Заменить `print()` на `logger`
Во всех файлах backend: `print(...)` → `logger.info(...)` / `logger.warning(...)` / `logger.error(...)`

### 1.4 Привести Pydantic к v2
Заменить `.dict()` → `.model_dump()`, `.dict(exclude_unset=True)` → `.model_dump(exclude_unset=True)`

### 1.5 Удалить emoji из production-кода
Заменить `✅`, `❌`, `🚀` и т.д. в строках логов на чистый текст. Emoji допустимы только в UI для пользователя.

---

## Фаза 2: Рефакторинг архитектуры бэкенда

### 2.1 Разделить `server.py` (~2000 строк) на модули
```
backend/
  main.py              # FastAPI app, startup/shutdown, подключение роутеров
  config.py            # Конфигурация, подключение к MongoDB
  models.py            # Все Pydantic модели
  routers/
    __init__.py
    health.py          # /health, /ready
    sensor_data.py     # /api/sensor-data (старый — удалить после миграции)
    raw_data.py        # /api/raw-data (новый)
    warnings.py        # /api/warnings
    admin.py           # /api/admin/**
    analytics.py       # /api/ml-statistics, /api/admin/v2/analytics
  services/
    __init__.py
    classifier.py      # EventClassifier (из ml_processor.py)
    neural.py          # NeuralEventClassifier (из ml_processor.py)
    warning_gen.py     # WarningGenerator (из ml_processor.py)
    clustering.py      # ObstacleClusterer (уже есть)
    ml_stats.py        # ML stats tracker (уже есть)
    geo.py             # Haversine, валидация координат
```

### 2.2 Исправить `admin_api.py` — антипаттерн с `asyncio.create_task`
Переписать на передачу db через `request.app.state`, убрать `asyncio.create_task(init_admin_editor_routes(db))`.

### 2.3 Вынести Haversine в единый модуль
Создать `backend/services/geo.py` с функциями `haversine_distance`, `calculate_bearing`, `validate_gps_coords`. Удалить дубликаты из `server.py`, `ml_processor.py`, `clustering.py`.

### 2.4 Добавить базовые тесты (pytest)
- Тест подключения к MongoDB (mock)
- Тест классификации событий
- Тест Haversine
- Тест эндпоинтов (fastapi.TestClient)

---

## Фаза 3: Удаление старого пайплайна данных

### 3.1 Удалить старый эндпоинт
Удалить `POST /api/sensor-data` и связанный код (`upload_sensor_data`, `SensorDataBatch`, `SensorDataPoint`, `RoadCondition`, `RoadWarning` и т.д.)

### 3.2 Удалить старые коллекции MongoDB
После верификации, что новые коллекции (`raw_sensor_data`, `processed_events`, `user_warnings`) содержат все нужные данные — удалить `road_conditions`, `road_warnings`.

### 3.3 Обновить `SyncService.ts`
Убрать вызовы на старый эндпоинт, перевести на `/api/raw-data`.

---

## Фаза 4: Рефакторинг фронтенда

### 4.1 Разделить `app/index.tsx` (~1400 строк)
Вынести логику в хуки:
```
hooks/
  useAutoStart.ts      # Bluetooth, зарядка, приложения
  useTracking.ts       # Старт/стоп GPS + акселерометр
  useSensorCollection.ts  # Сбор и отправка данных
  useBrightnessControl.ts # Keep-awake, яркость
```

### 4.2 Объединить `RawDataCollector` и `SyncService`
Создать единый `services/SyncManager.ts`:
- Единая офлайн-очередь
- Единый механизм отправки
- Единая обработка предупреждений

### 4.3 Создать единый слой Storage
Создать `services/StorageService.ts`:
```typescript
const StorageKeys = {
  SETTINGS: 'app_settings',
  AUDIO_SETTINGS: 'dynamic_audio_settings',
  AUTOSTART_MODE: 'autostart_mode',
  // ... все ключи в одном месте
} as const;
```

### 4.4 Разделить `DynamicAudioAlertService.ts` (~550 строк)
```
services/audio/
  AudioEngine.ts       # Низкоуровневая работа с Audio API
  VoiceAnnouncer.ts    # Голосовые объявления (Speech API)
  BeepScheduler.ts     # Расчёт интервалов и тона
  SoundCache.ts        # Кэш пользовательских звуков
```

### 4.5 Убрать `any` типы, включить strict mode

### 4.6 Синхронизировать пороги классификации
Удалить `EventDetector.ts` или сделать его минимальной prefork-логикой. Все пороги должны быть только на сервере.

---

## Фаза 5: Инфраструктура и DevOps

### 5.1 Решить судьбу Docker
Варианты:
- Удалить docker-compose, если используется только bare metal
- Либо донастроить и раскомментировать backend/frontend сервисы

### 5.2 Создать `docker-compose.dev.yml`
Файл нужен для `make start-dev`, сейчас отсутствует.

### 5.3 Почистить `.gitignore` (706 строк, много дублей)

### 5.4 Определиться с платформой
Убрать K8S-манифесты ИЛИ docker-compose — дублирование конфигурации.

---

## Фаза 6: ML и безопасность

### 6.1 Заменить TensorFlow на ONNX Runtime
Для инференса на CPU TensorFlow избыточен (~500MB). ONNX Runtime легче и быстрее.

### 6.2 Добавить мониторинг качества ML
Алерты при падении accuracy/confidence ниже порога.

### 6.3 Добавить базовую аутентификацию
Хотя бы API key для deviceId, чтобы нельзя было слать данные от чужого имени.

### 6.4 Вынести магические числа в константы
- Времена, дистанции, лимиты — в `config.py` / `constants.ts`

---

## Фаза 7: Web-обновление бэкенда (Webhook + Admin Upload)

### 7.1 Создать `services/updater.py`
Модуль с классом `BackendUpdater`:
- `check_git_status()` — git fetch + ahead/behind
- `git_pull()` — `git pull --ff-only`, возвращает diff
- `validate_code()` — syntax check всех `.py`
- `restart_service()` — `supervisorctl restart backend`
- `deploy_from_zip(zip_bytes)` — распаковка ZIP, валидация, переключение
- `get_deployment_log()` — история обновлений из JSON-файла

### 7.2 Создать `routers/deploy.py`
Эндпоинты:

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/webhook/github` | GitHub webhook — автоматический pull при push |
| `GET` | `/api/admin/deploy` | Страница админки: статус, лог, форма загрузки |
| `POST` | `/api/admin/deploy/upload` | Загрузка ZIP-архива с кодом |
| `POST` | `/api/admin/deploy/pull` | Ручной git pull из админки |
| `GET` | `/api/admin/deploy/log` | JSON с историей обновлений |

### 7.3 Создать `templates/admin_deploy.html`
Страница админки с:
- Статус: ветка, коммит, ahead/behind
- Кнопка "Pull from Git"
- Форма загрузки ZIP (drag&drop)
- Лог последних 20 обновлений (таблица)

### 7.4 Добавить карточку в `admin_index.html`
Ссылка на новую страницу `/api/admin/deploy` в сетке карточек.

### 7.5 Безопасность
- Webhook: проверка secret из `GITHUB_WEBHOOK_SECRET`
- Lock-файл `/tmp/backend-update.lock` — предотвратить одновременные обновления
- Валидация кода до рестарта; если fail — откат
- Graceful shutdown через SIGINT

---

## Приоритет выполнения

| Приоритет | Фаза | Задача | Время |
|-----------|------|--------|-------|
| P0 | 1.1-1.2 | Удалить мёртвые файлы | ~15 мин |
| P0 | 2.1 | Разделить server.py | ~2-3 часа |
| P1 | 2.3 | Вынести Haversine | ~30 мин |
| P1 | 1.3 | print → logger | ~30 мин |
| P1 | 2.2 | Исправить admin_api.py | ~30 мин |
| P2 | 3 | Удалить старый пайплайн | ~1 час |
| P2 | 4.1 | Разделить index.tsx | ~2 часа |
| P2 | 4.5 | strict типы | ~1 час |
| P3 | 4.2 | Объединить сервисы | ~2 часа |
| P3 | 5 | Инфраструктура | ~1 час |
| P4 | 6 | ML + безопасность | ~3 часа |
| P1 | 7.1 | `services/updater.py` | ~1 час |
| P1 | 7.2 | `routers/deploy.py` | ~1 час |
| P1 | 7.3 | `templates/admin_deploy.html` | ~1 час |
| P1 | 7.4 | Карточка в admin_index.html | ~15 мин |
