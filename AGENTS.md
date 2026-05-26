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
  templates/             # Jinja2 шаблоны админки

frontend/
  app/index.tsx          # Главный экран
  app/admin/             # Экраны админ-панели
  app/settings/          # Настройки
  services/
    RawDataCollector.ts  # Сбор данных с датчиков
    DynamicAudioAlertService.ts  # Аудио-оповещения
    ObstacleAlertService.ts     # Предупреждения о препятствиях
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
- production URL: https://road-monitor-4.emergent.host
- Админ-панель: /api/admin/dashboard/v3
