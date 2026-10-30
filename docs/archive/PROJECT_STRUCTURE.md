# Good Road - Структура проекта

## 📁 Общая структура

```
/app/
├── backend/              # FastAPI backend
│   ├── server.py        # Основной сервер
│   ├── ml_processor.py  # ML классификатор
│   ├── admin_api.py     # API для редактирования данных
│   ├── clustering.py    # Кластеризация препятствий
│   └── templates/       # HTML шаблоны админки
└── frontend/            # React Native (Expo) приложение
    ├── app/             # Экраны приложения
    ├── services/        # Сервисы (сбор данных, алерты)
    └── hooks/           # React hooks
```

## 🗺️ Админ-панель (обновлено 09.12.2025)

### Основной Dashboard
**URL:** `/api/admin/dashboard/v3`
**Описание:** Единая страница с картой, фильтрами и инструментами редактирования

**Функции:**
- 🗺️ Интерактивная карта с маркерами событий/кластеров
- 📊 Переключение между событиями и кластерами
- 🔍 Фильтры (тип, серьезность, поиск)
- ✏️ Редактирование событий и кластеров
- 🗑️ Удаление (одиночное и массовое)
- ☑️ Чекбоксы для выбора множества элементов
- 📍 Кнопка "На карте" для навигации

### Дополнительные страницы

**ML настройки:** `/api/admin/ml-settings`
- Пороговые значения для детекции препятствий
- История изменений порогов
- Рекомендации по калибровке

**Создание APK:** `/api/admin/apk-guide`
- Инструкции по сборке APK через Expo
- Конфигурация eas.json
- Команды для облачной и локальной сборки

**QR коды:** `/api/expo-qr`
- QR коды для Expo Go
- Инструкции по подключению

## 🔌 API Endpoints

### События и кластеры
- `GET /api/admin/v2/events` - Получить события
- `GET /api/admin/v2/clusters` - Получить кластеры
- `GET /api/admin/v2/raw-data` - Сырые данные

### Редактирование (admin_api.py)
- `PUT /api/admin/editor/events/{id}` - Редактировать событие
- `PUT /api/admin/editor/clusters/{id}` - Редактировать кластер
- `DELETE /api/admin/editor/events/{id}` - Удалить событие
- `DELETE /api/admin/editor/clusters/{id}` - Удалить кластер
- `POST /api/admin/editor/events/bulk-delete` - Массовое удаление событий
- `POST /api/admin/editor/clusters/bulk-delete` - Массовое удаление кластеров

### Сбор данных
- `POST /api/raw-data` - Отправка сырых данных с мобильного

## 🧠 ML Классификатор (ml_processor.py)

### Пороги детекции (обновлено 08.12.2025)

**Лежачий полицейский:**
- deltaZ: 0.25 (повышено с 0.145)
- magnitude: 1.20
- Скорость: 2.8-12.5 м/с (10-45 км/ч)

**Яма:**
- deltaZ: 0.30 (повышено с 0.145)
- magnitude: 1.25
- Минимальная скорость: 12.5 м/с (45 км/ч)

**Неровность:**
- deltaZ: 0.20
- magnitude: 1.15

**Вибрация:**
- variance: 0.015
- magnitude: 1.12

### Уровни серьезности
- Критический: ΔZ > 0.35
- Высокий: ΔZ > 0.30
- Средний: ΔZ > 0.25
- Низкий: ΔZ > 0.20

## 📱 Мобильное приложение

### Основной экран (app/index.tsx)
- Кнопка запуска/остановки мониторинга
- Отображение статуса GPS
- Настройки автозапуска
- Аудио оповещения

### Сервисы

**RawDataCollector.ts**
- Сбор данных с акселерометра (10 Hz)
- Буферизация данных (40-50 точек)
- Синхронизация GPS и акселерометра
- Отправка батчами по 5 секунд

**DynamicAudioAlertService.ts**
- Динамические аудио оповещения
- Настройка рекомендованной скорости
- Частота оповещений зависит от близости

**ObstacleAlertService.ts**
- Получение предупреждений с backend
- Расчет расстояния до препятствий
- Воспроизведение звуков

## 🗄️ База данных (MongoDB)

### Коллекции

**raw_sensor_data**
```javascript
{
  deviceId: String,
  timestamp: DateTime,
  latitude: Number,
  longitude: Number,
  speed: Number,
  accelerometer_data: [{x, y, z, timestamp}],
  created_at: DateTime
}
```

**processed_events**
```javascript
{
  id: String,
  eventType: String, // pothole, bump, speed_bump, vibration, braking
  severity: Number, // 1-5
  confidence: Number, // 0-1
  latitude: Number,
  longitude: Number,
  timestamp: DateTime,
  deviceId: String,
  detection_method: String, // pattern_analysis, threshold
  notes: String
}
```

**obstacle_clusters**
```javascript
{
  clusterId: String,
  obstacleType: String,
  location: {latitude, longitude},
  reportCount: Number,
  confidence: Number,
  severity: {min, max, average},
  status: String, // active, expired, verified
  devices: [String],
  event_ids: [String],
  created_at: DateTime,
  updated_at: DateTime,
  lastReported: DateTime,
  notes: String
}
```

## 🔧 Конфигурация

### Backend (.env)
```
MONGO_URL=mongodb://localhost:27017
```

### Frontend (.env)
```
EXPO_PUBLIC_BACKEND_URL=https://road-monitor-4.emergent.host
EXPO_PACKAGER_PROXY_URL=...
EXPO_PACKAGER_HOSTNAME=...
```

### EAS Build (eas.json)
```json
{
  "build": {
    "preview": {
      "android": {"buildType": "apk"}
    },
    "production": {
      "android": {"buildType": "apk"}
    }
  }
}
```

## 📝 Удалённые компоненты (09.12.2025)

Для упрощения структуры удалены:
- ❌ `/admin/dashboard` (v1)
- ❌ `/admin/dashboard/v2` (заменён на v3)
- ❌ `/admin/data-editor` (встроен в v3)

Теперь используется единый dashboard v3.

## 🚀 Запуск

### Backend
```bash
cd /app/backend
python3 server.py
# или через supervisor
sudo supervisorctl restart backend
```

### Frontend (development)
```bash
cd /app/frontend
expo start --tunnel
# или через supervisor
sudo supervisorctl restart expo
```

### APK сборка
```bash
cd /app/frontend
eas build --platform android --profile preview
```

## 📊 Мониторинг

- Backend логи: `sudo supervisorctl tail backend`
- Frontend логи: `sudo supervisorctl tail expo`
- Статус: `sudo supervisorctl status`

## 🔗 Полезные ссылки

- **Admin панель:** https://road-monitor-4.emergent.host/api/admin
- **Dashboard:** https://road-monitor-4.emergent.host/api/admin/dashboard/v3
- **ML настройки:** https://road-monitor-4.emergent.host/api/admin/ml-settings
- **APK guide:** https://road-monitor-4.emergent.host/api/admin/apk-guide
