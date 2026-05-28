# Good Road — контекст проекта

## Описание
Мобильное приложение для мониторинга качества дорожного покрытия в реальном времени. Использует GPS и акселерометр смартфона для обнаружения ям, лежачих полицейских и неровностей.

## Стек технологий

### Frontend (mobile)
- React Native 0.81 + Expo ~54
- TypeScript ~5.9
- Zustand (state management)
- Expo Router (file-based routing)
- Expo Location, Sensors, Audio, TaskManager
- react-native-mmkv (local storage)
- react-native-reanimated

### Backend (API)
- FastAPI + Uvicorn
- MongoDB (Motor async driver)
- Pydantic v2
- Jinja2 (admin panel)

### ML
- scikit-learn, numpy, pandas
- PyTorch (ROCm для AMD RX 6800 XT)
- Кастомный ML классификатор + LSTM нейросеть

## Ключевые файлы

```
backend/
  server.py              # FastAPI сервер (основной)
  ml_processor.py        # ML классификация препятствий
  admin_api.py           # API админ-панели
  clustering.py          # Пространственная кластеризация
  neural_classifier.py   # LSTM нейросеть
  train_model.py         # Обучение модели
  config.py              # MongoDB, ML, rate limiting
  models.py              # Pydantic модели
  services/
    geo.py               # Haversine, GPS валидация
    updater.py           # Деплой: git pull, ZIP, webhook
  routers/
    __init__.py
    deploy.py            # Эндпоинты деплоя
  templates/             # Jinja2 шаблоны админки

frontend/
  app/index.tsx              # Главный экран (только UI + композиция хуков)
  app/admin/                 # Экраны админ-панели
  app/settings/              # Настройки
  services/
    RawDataCollector.ts      # Сбор данных с датчиков
    DynamicAudioAlertService.ts  # Аудио-оповещения
    ObstacleAlertService.ts  # Предупреждения о препятствиях
  hooks/
    useAppStore.ts           # Zustand store
    useObstacleAlerts.ts     # Хук оповещений
    useTracking.ts           # GPS, акселерометр, сбор данных, RawDataCollector
    useAutoStart.ts          # Автостарт/автостоп (Bluetooth, зарядка, триггер-приложения)
    useBrightnessControl.ts  # Яркость экрана + keep-awake во время мониторинга
```

## Конвенции

### Backend (Python)
- Асинхронные эндпоинты FastAPI
- MongoDB через Motor (асинхронный драйвер)
- Pydantic модели для валидации
- ML пороги в ml_processor.py (настраиваются через админку)

### Frontend (TypeScript)
- Expo Router (file-based routing, app/)
- Zustand для глобального состояния
- Сервисы (services/) — бизнес-логика
- Хуки (hooks/) — React hooks для UI
- Строгая типизация TypeScript

### База данных (MongoDB)
- raw_sensor_data — сырые данные с датчиков
- processed_events — классифицированные события
- obstacle_clusters — кластеры препятствий

## Команды

### Backend
```bash
cd backend && python3 server.py
supervisorctl restart backend
```

### Frontend
```bash
cd frontend && expo start --tunnel
supervisorctl restart expo
```

### Docker
```bash
make start          # Все сервисы
make start-dev      # Режим разработки
make ml-train       # Обучение ML модели
```

## Важно
- GPU: AMD Radeon RX 6800 XT (16GB VRAM)
- Модель Ollama: qwopus3.5-tools (основана на Qwen3.5 9B Q4_K_M)
- Не добавлять лишние комментарии в код
- Избегать emoji в коде
- Админ-панель: /api/admin/dashboard/v3
- Webhook secret: `GITHUB_WEBHOOK_SECRET` в .env (HMAC-SHA256)

## История изменений

### Phase 4.1 (2026-05-26) — Извлечение хуков из index.tsx
- `index.tsx` сокращён с 1368 до 508 строк (-63%)
- Создан `hooks/useTracking.ts` — управление GPS, акселерометром, сбором данных, RawDataCollector, ручная отметка препятствий, управление яркостью
- Создан `hooks/useAutoStart.ts` — автостарт/автостоп (Bluetooth, зарядка, триггер-приложения, AppState)
- Создан `hooks/useBrightnessControl.ts` — управление яркостью экрана и keep-awake
- Все три хука используют ref-ы вместо зависимостей от состояния, чтобы избежать проблем с замкнутыми интервалами
- `tsc` — 0 новых ошибок (17 предсуществующих)

### Phase 7 (2026-05-26) — Механизм деплоя бэкенда
- Создан `services/updater.py` — класс BackendUpdater: git pull, синтаксис-валидация, restart через supervisorctl, ZIP deploy, webhook verification (HMAC-SHA256), lock-файл, лог обновлений
- Создан `routers/deploy.py` — эндпоинты: GET /api/admin/deploy, GET /api/admin/deploy/log, POST /api/admin/deploy/pull, POST /api/admin/deploy/upload, POST /api/webhook/github
- Создан `templates/admin_deploy.html` — страница админки: статус репозитория, кнопка Pull, drag&drop ZIP upload, история обновлений (Jinja2, legacy light theme)
- Обновлён `admin_index.html` — добавлена карточка «Деплой»
- Обновлён `server.py` — подключены deploy_router и webhook_router

### Phase 3.4 (2026-05-26) — Создан POST /api/raw-data
- Создан эндпоинт `POST /api/raw-data` — приём сырых данных с мобильного приложения (акселерометр + GPS)
- Сохраняет в `raw_sensor_data`, прогоняет через ML классификатор, кластеризатор, генератор предупреждений
- Rate limiting, валидация GPS, graceful handling ошибок на точку

### Phase 8 (2026-05-26) — opencode-интеграция
- Создан `routers/opencode.py` — эндпоинты для доступа opencode к данным и статусу системы
- `GET /api/admin/opencode/health` — статус: MongoDB, ML модель, collections, версия
- `GET /api/admin/opencode/stats` — агрегированная статистика: количество записей, типы событий, активные кластеры
