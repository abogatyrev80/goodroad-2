# Фаза 2: EventDetector - Интеграция (ПОЧТИ ЗАВЕРШЕНА)

## ✅ ЧТО СДЕЛАНО:

### 1. EventDetector.ts создан
- Умная система детекции событий
- Автоопределение типа дороги
- Адаптивные пороги
- 5 уровней серьёзности

### 2. Интеграция в index.tsx:

**✅ Шаг 1: Инициализация** (ГОТОВО)
```javascript
const initializeEventDetector = () => {
  const detector = new EventDetector({
    vehicleType: 'sedan',
    baseline: { x: 0, y: 0, z: 9.81, timestamp: Date.now() },
    thresholdMultiplier: 1.0,
  });
  setEventDetector(detector);
};
```

**✅ Шаг 2: Обработка акселерометра** (ГОТОВО)
- Частота: 50Hz (было 2Hz)
- EventDetector обрабатывает каждую точку
- Накопление событий в буфер
- Alert для критичных событий
- Вибрация при препятствиях

**⏳ Шаг 3: Event-driven отправка** (ОСТАЛОСЬ)
Нужно ЗАМЕНИТЬ строки 182-280 в index.tsx на:

```javascript
// Event-driven отправка: когда накопилось 5 событий ИЛИ прошло 60 сек
useEffect(() => {
  if (!isTracking || Platform.OS === 'web') return;
  
  // Проверка каждую минуту
  const intervalId = setInterval(() => {
    if (detectedEvents.length > 0) {
      console.log(`📦 Отправка batch: ${detectedEvents.length} событий`);
      sendEventsToServer(detectedEvents);
      setDetectedEvents([]); // Очистить буфер
    }
  }, 60000); // 60 секунд
  
  return () => clearInterval(intervalId);
}, [isTracking, detectedEvents, currentLocation]);

// Функция отправки событий
const sendEventsToServer = async (events: DetectedEvent[]) => {
  if (!currentLocation) {
    console.log('⚠️ Нет GPS для отправки событий');
    return;
  }
  
  const deviceId = Constants.deviceId || `mobile-app-${Date.now()}`;
  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 
                    Constants.expoConfig?.extra?.backendUrl || 
                    'https://roadquality.emergent.host';
  const apiUrl = backendUrl.endsWith('/') ? backendUrl + 'api/sensor-data' : backendUrl + '/api/sensor-data';
  
  const payload = {
    deviceId,
    sensorData: events.map(event => ({
      type: 'event',
      eventType: event.eventType,
      severity: event.severity,
      roadType: event.roadType,
      timestamp: event.timestamp,
      location: {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        speed: currentSpeed,
        accuracy: gpsAccuracy,
      },
      accelerometer: event.accelerometer,
    }))
  };
  
  try {
    console.log(`📡 Отправка на: ${apiUrl}`);
    console.log(`📊 События: ${events.map(e => e.eventType).join(', ')}`);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Успешно отправлено ${events.length} событий!`, result);
    } else {
      console.error(`❌ Ошибка: ${response.status}`);
    }
  } catch (error: any) {
    console.error('❌ Ошибка сети:', error.message);
  }
};
```

**⏳ Шаг 4: UI индикаторы** (ОСТАЛОСЬ)
Добавить ПОСЛЕ кнопки отслеживания (строка ~500+):

```jsx
{/* Event Detector Info */}
{isTracking && eventDetector && (
  <View style={styles.eventInfo}>
    <Text style={styles.eventInfoTitle}>📊 Детектор событий</Text>
    
    <View style={styles.eventRow}>
      <Text style={styles.eventLabel}>🛣️ Тип дороги:</Text>
      <Text style={styles.eventValue}>{currentRoadType}</Text>
    </View>
    
    <View style={styles.eventRow}>
      <Text style={styles.eventLabel}>🎯 Обнаружено:</Text>
      <Text style={styles.eventValue}>{eventCount} событий</Text>
    </View>
    
    <View style={styles.eventRow}>
      <Text style={styles.eventLabel}>📦 В буфере:</Text>
      <Text style={styles.eventValue}>{detectedEvents.length}/10</Text>
    </View>
    
    {lastEvent && (
      <View style={[styles.eventRow, styles.lastEventRow]}>
        <Text style={styles.eventLabel}>⚡ Последнее:</Text>
        <Text style={[styles.eventValue, styles.lastEventText]}>
          {lastEvent.eventType} (severity {lastEvent.severity})
        </Text>
      </View>
    )}
  </View>
)}
```

И стили в конец StyleSheet.create:

```javascript
eventInfo: {
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  padding: 16,
  borderRadius: 12,
  marginTop: 16,
  borderLeftWidth: 4,
  borderLeftColor: '#10b981',
},
eventInfoTitle: {
  color: '#fff',
  fontSize: 16,
  fontWeight: 'bold',
  marginBottom: 12,
},
eventRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  marginBottom: 8,
},
eventLabel: {
  color: '#94a3b8',
  fontSize: 14,
},
eventValue: {
  color: '#e2e8f0',
  fontSize: 14,
  fontWeight: '600',
},
lastEventRow: {
  marginTop: 8,
  paddingTop: 12,
  borderTopWidth: 1,
  borderTopColor: 'rgba(255, 255, 255, 0.1)',
},
lastEventText: {
  color: '#10b981',
},
```

---

## 🎯 ДЛЯ ЗАВЕРШЕНИЯ:

1. Открыть `/app/frontend/app/index.tsx`
2. Найти строки 182-280 (старая отправка по таймеру)
3. Заменить на event-driven код выше
4. Добавить UI индикаторы в JSX
5. Добавить стили
6. Перезапустить frontend: `sudo supervisorctl restart expo`
7. Протестировать!

---

## 📦 ФАЙЛЫ:
- `/app/frontend/services/EventDetector.ts` ✅
- `/app/frontend/app/index.tsx` ⏳ (90% готово)
- `/app/TODO_MODERNIZATION.md` ✅

---

Осталось ~30 минут работы для полного завершения Фазы 2!
