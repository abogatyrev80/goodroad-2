# Периодическая отправка сырых данных для адаптации устройств

## 🎯 Проблема

После анализа production данных (https://goodroad.su) была обнаружена критическая проблема:

**Последние данные от мобильного приложения:** 10 ноября 2025 (2 дня назад)
**Всего записей в базе:** 241
**Проблема:** В записях от мобильного приложения `accelerometer = (0.0, 0.0, 0.0)` - данные акселерометра НЕ передаются!

### Корневая причина

1. `EventDetector.ts` возвращает `null` для нормального движения (когда нет ям, торможений, вибраций):
   ```typescript
   if (eventType === 'normal' && magnitude < 1.0) {
     return null;
   }
   ```

2. Когда EventDetector возвращает `null`, метод `BatchOfflineManager.addEvent()` никогда не вызывается

3. **Без вызова `addEvent()` данные вообще НЕ отправляются на сервер**

4. Это означает, что при езде по хорошей, гладкой дороге **приложение вообще не отправляет данные!**

### Почему это произошло

После модернизации системы на **event-driven подход**, была убрана старая периодическая отправка каждые 10 секунд. Теперь данные отправляются **ТОЛЬКО** когда EventDetector обнаруживает значимое событие (яма, торможение, вибрация).

## ✅ Решение

Добавлена **гибридная система**:
- ✨ **Event-driven** для реальных событий (ямы, торможения, вибрации)
- 🕐 **Периодическая отправка** сырых данных каждые 30 секунд для базового GPS-трека

## 🔧 Реализация

### Изменения в `/app/frontend/app/index.tsx`

#### 1. Добавлен новый Ref для таймера

```typescript
const periodicDataTimerRef = useRef<NodeJS.Timeout | null>(null); // Таймер для периодической отправки сырых данных
```

#### 2. Обновлена функция cleanup

```typescript
const cleanup = async () => {
  // ... существующий код ...
  if (periodicDataTimerRef.current) {
    clearInterval(periodicDataTimerRef.current);
  }
};
```

#### 3. Добавлен новый useEffect для периодической отправки

```typescript
useEffect(() => {
  if (!isTracking || Platform.OS === 'web') {
    if (periodicDataTimerRef.current) {
      clearInterval(periodicDataTimerRef.current);
      periodicDataTimerRef.current = null;
    }
    return;
  }

  console.log('🕐 Запуск периодической отправки сырых данных (каждые 30 секунд)');
  
  periodicDataTimerRef.current = setInterval(() => {
    if (!isTracking || !currentLocation) {
      console.log('⏸️ Пропуск периодической отправки: отслеживание остановлено или нет GPS');
      return;
    }

    // Создаём синтетическое "normal" событие с текущими сырыми данными
    const normalEvent: DetectedEvent = {
      eventType: 'normal',
      severity: 5,
      timestamp: Date.now(),
      accelerometer: {
        x: accelerometerData.x,
        y: accelerometerData.y,
        z: accelerometerData.z,
        magnitude: Math.sqrt(
          accelerometerData.x ** 2 + 
          accelerometerData.y ** 2 + 
          accelerometerData.z ** 2
        ),
        deltaY: 0,
        deltaZ: 0,
        deltaX: 0,
        variance: 0,
      },
      roadType: (eventDetector?.getRoadType() || 'unknown') as RoadType,
      speed: currentSpeed,
      shouldNotifyUser: false,
      shouldSendImmediately: false,
    };

    console.log(`📡 Периодическая отправка сырых данных: GPS (${currentLocation.coords.latitude.toFixed(6)}, ${currentLocation.coords.longitude.toFixed(6)}), Speed: ${currentSpeed.toFixed(1)} km/h, Accel: (${accelerometerData.x.toFixed(2)}, ${accelerometerData.y.toFixed(2)}, ${accelerometerData.z.toFixed(2)})`);
    
    // Отправляем через BatchOfflineManager
    batchOfflineManager.addEvent(
      normalEvent,
      currentLocation,
      currentSpeed,
      gpsAccuracy
    );
    
  }, 30000); // 30 секунд

  return () => {
    if (periodicDataTimerRef.current) {
      clearInterval(periodicDataTimerRef.current);
      periodicDataTimerRef.current = null;
    }
  };
}, [isTracking, currentLocation, currentSpeed, gpsAccuracy, accelerometerData, eventDetector]);
```

## 📊 Преимущества

### 1. Гарантированный GPS-трек
- ✅ Даже на идеальных дорогах без ям и торможений
- ✅ Непрерывный трек поездки для анализа маршрутов

### 2. Сбор сырых данных для ML
- ✅ Реальные значения акселерометра (x, y, z)
- ✅ Скорость, точность GPS
- ✅ Тип дороги от EventDetector

### 3. Адаптация под устройства
- ✅ Возможность анализировать чувствительность разных телефонов
- ✅ Калибровка порогов EventDetector под конкретные устройства
- ✅ Создание профилей устройств (iPhone vs Android, разные модели)

### 4. Оптимизация нагрузки
- ✅ Только раз в 30 секунд (не перегружает сервер)
- ✅ Сохранена event-driven логика для реальных событий
- ✅ Батчинг через BatchOfflineManager

## 🔄 Логика работы

### Event-driven (сохранена)
```
Accelerometer (50Hz) → EventDetector → 
  IF событие обнаружено → BatchOfflineManager.addEvent()
```

### Периодическая (новая)
```
Таймер 30 сек → Создать 'normal' событие → BatchOfflineManager.addEvent()
```

### Результат
```
BatchOfflineManager → Batching (10 событий или 60 сек) → 
  Отправка на сервер → MongoDB
```

## 📝 Данные в событии 'normal'

```typescript
{
  eventType: 'normal',
  severity: 5,
  timestamp: Date.now(),
  accelerometer: {
    x: <реальное значение>,
    y: <реальное значение>,
    z: <реальное значение>,
    magnitude: <вычисленное>,
    deltaY: 0,
    deltaZ: 0,
    deltaX: 0,
    variance: 0,
  },
  roadType: 'asphalt' | 'gravel' | 'dirt' | 'unknown',
  speed: <текущая скорость км/ч>,
  shouldNotifyUser: false,
  shouldSendImmediately: false,
}
```

## 🧪 Тестирование

### Локальное тестирование
1. Запустить приложение
2. Начать отслеживание (Start Tracking)
3. В консоли должны появиться логи:
   - `🕐 Запуск периодической отправки сырых данных (каждые 30 секунд)`
   - Каждые 30 секунд: `📡 Периодическая отправка сырых данных: GPS (...), Speed: ..., Accel: (...)`

### Production тестирование
1. Развернуть обновленное приложение
2. Совершить тестовую поездку на гладкой дороге (без ям)
3. Проверить в админ-панели наличие записей с `event_type: 'normal'`
4. Убедиться что `accelerometer` содержит реальные значения (не 0,0,0)

## 🎓 Будущие улучшения

### 1. Адаптивная калибровка
```typescript
// Анализ сырых данных с разных устройств
const deviceProfile = {
  deviceModel: 'iPhone 14 Pro',
  baselineNoise: 0.15, // Средний noise на гладкой дороге
  sensitivityMultiplier: 0.9,
};

// Автоматическая настройка порогов EventDetector
eventDetector.setCalibration({
  vehicleType: 'sedan',
  baseline: deviceProfile.baselineNoise,
  thresholdMultiplier: deviceProfile.sensitivityMultiplier,
});
```

### 2. Машинное обучение
- Обучение ML модели на сырых данных для лучшей классификации событий
- Определение типа дороги по паттернам акселерометра
- Предсказание ям и дефектов до их обнаружения

### 3. Оптимизация частоты
- Динамическая частота отправки в зависимости от скорости движения
- Быстрее при высокой скорости (каждые 15 сек)
- Реже при низкой скорости или стоянке (каждые 60 сек)

## 📅 Дата реализации

**12 ноября 2025** - Добавлена периодическая отправка сырых данных

## 👤 Автор

AI Engineer (Main Agent)

## 🔗 Связанные файлы

- `/app/frontend/app/index.tsx` - Основная логика приложения
- `/app/frontend/services/EventDetector.ts` - Детекция дорожных событий
- `/app/frontend/services/BatchOfflineManager.ts` - Батчинг и offline хранилище
- `/app/backend/server.py` - Backend API для обработки данных
