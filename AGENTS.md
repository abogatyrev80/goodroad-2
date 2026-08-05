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
  warning_service.py     # Серверные предупреждения (user_warnings, TTL 1h)
  force_classify.py      # Принудительная классификация с локальной GPU-машины
  inference_worker.py    # Фоновый инференс-воркер (пишет предупреждения)
  templates/             # Jinja2 шаблоны админки

frontend/
  app/index.tsx          # Главный экран
  app/admin/             # Экраны админ-панели
  app/settings/          # Настройки
  services/
    AdaptiveCollector.ts       # Адаптивный сбор (background/trigger/prearm) -> POST /api/raw-events
    RawDataCollector.ts        # Легаси-сбор + получение предупреждений /api/warnings/{deviceId}
    DynamicAudioAlertService.ts  # Аудио-оповещения
  hooks/
    useAppStore.ts       # Zustand store
    useObstacleAlerts.ts # Хук оповещений
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
- user_warnings — серверные предупреждения (TTL 1h, severity<=2, дедуп по местоположению)

## Команды

### Backend
```bash
cd backend && python3 server.py
supervisorctl restart backend
```

### Принудительная классификация с локальной GPU-машины
```bash
cd backend && .venv-ml/bin/python force_classify.py --push --limit 200 --hours 48
# dry-run (без записи): .venv-ml/bin/python force_classify.py --hours 24
```
- Тянет необработанные окна (trigger/prearm) с прода через `/api/admin/v2/raw-data?unprocessed=true&kind=...`
- Классифицирует локально (EventClassifier; LSTM подключается если NEURAL_MIN_CONFIDENCE >= confidence)
- Пушит предупреждения: `POST /api/admin/warnings/ingest`, помечает обработанные: `POST /api/admin/raw-data/mark-processed`
- ML-окружение: `backend/.venv-ml` (PyTorch ROCm 6.4, ставится scripts/setup-ml-env.sh)

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
- Ollama живёт на локальной GPU-машине (порт 11434), прод-бэкенд подключается к ней через cloudflared-туннель (trycloudflare). URL обновляется в настройках LLM на goodroad.su командой: `backend/ollama_tunnel.sh`
- Текущий адрес туннеля хранится в настройках прода: GET /api/llm/settings
- Не добавлять лишние комментарии в код
- Избегать emoji в коде
- production URL: https://goodroad.su
- Админ-панель: /api/admin/dashboard/v3
