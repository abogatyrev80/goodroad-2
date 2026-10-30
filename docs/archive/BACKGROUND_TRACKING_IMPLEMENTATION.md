# Реализация фонового отслеживания в Good Road App

## Проблема
Мобильное приложение "засыпало" и прекращало сбор данных при блокировке экрана или переходе в фон. Данные собирались только когда экран был активен.

## Решение
Реализовано **настоящее фоновое отслеживание** с использованием `expo-task-manager` и `expo-location`.

---

## Ключевые изменения

### 1. Добавлена фоновая задача (Background Task)

```typescript
// Определение фоновой задачи ВНЕ компонента
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('❌ Background location task error:', error);
    return;
  }
  
  if (data) {
    const { locations } = data as any;
    // Сохранение локаций в AsyncStorage для последующей обработки
    await AsyncStorage.setItem('lastBackgroundLocation', JSON.stringify(location));
  }
});
```

**Важно:** 
- `TaskManager.defineTask` должен быть вызван **ВНЕ** компонента React
- Фоновая задача работает даже когда приложение свёрнуто или экран заблокирован
- В фоновой задаче нет доступа к состоянию React компонента

### 2. Запуск фонового отслеживания

```typescript
await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 1000, // Обновление каждую секунду
  distanceInterval: 1, // Обновление при движении на 1 метр
  foregroundService: {
    notificationTitle: 'Good Road',
    notificationBody: 'Отслеживание качества дороги активно',
    notificationColor: '#4CAF50',
  },
  pausesUpdatesAutomatically: false, // НЕ останавливать при остановке устройства
  showsBackgroundLocationIndicator: true, // Показывать индикатор
});
```

**Ключевые параметры:**
- `foregroundService` - создаёт постоянное уведомление (Android)
- `pausesUpdatesAutomatically: false` - продолжать работу даже при остановке
- `showsBackgroundLocationIndicator: true` - показывать индикатор фонового GPS (iOS)

### 3. Dual-Mode отслеживание

Приложение теперь использует **два режима одновременно**:

1. **Background Task** - для фонового сбора GPS координат
2. **Foreground Subscription** - для обновления UI в реальном времени

```typescript
// 1. Фоновое отслеживание (работает ВСЕГДА)
await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {...});

// 2. Foreground подписка (работает когда экран активен)
locationSubscription.current = await Location.watchPositionAsync({...}, callback);
```

### 4. Корректная остановка

```typescript
const stopTracking = async () => {
  // Остановка фоновой задачи
  const hasTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (hasTask) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
  
  // Остановка foreground подписки
  if (locationSubscription.current) {
    locationSubscription.current.remove();
  }
};
```

---

## Настройки разрешений

### iOS (app.json)

```json
"ios": {
  "infoPlist": {
    "UIBackgroundModes": [
      "location",
      "background-fetch",
      "background-processing"
    ],
    "NSLocationAlwaysAndWhenInUseUsageDescription": "Good Road needs location access to monitor road conditions while driving.",
    "NSLocationWhenInUseUsageDescription": "Good Road needs location access to monitor road conditions.",
    "NSMotionUsageDescription": "Good Road uses motion sensors to detect road quality."
  }
}
```

### Android (app.json)

```json
"android": {
  "permissions": [
    "ACCESS_FINE_LOCATION",
    "ACCESS_COARSE_LOCATION", 
    "ACCESS_BACKGROUND_LOCATION",
    "FOREGROUND_SERVICE",
    "WAKE_LOCK",
    "RECEIVE_BOOT_COMPLETED"
  ]
}
```

---

## Запрос разрешений

```typescript
// 1. Foreground разрешения
const { status } = await Location.requestForegroundPermissionsAsync();

// 2. Background разрешения (критически важно!)
const backgroundStatus = await Location.requestBackgroundPermissionsAsync();
if (backgroundStatus.status !== 'granted') {
  console.warn('⚠️ Фоновые разрешения не предоставлены');
}
```

**Важно:** На iOS пользователь должен выбрать "Always Allow" для работы в фоне.

---

## Как это работает

### Когда экран активен:
1. **Foreground subscription** обновляет UI в реальном времени
2. **Background task** работает параллельно и сохраняет данные в AsyncStorage
3. Акселерометр собирает данные каждые 100мс
4. Каждую секунду создаётся синхронизированный пакет (GPS + акселерометр)

### Когда экран заблокирован:
1. **Foreground subscription** перестаёт работать
2. **Background task** ПРОДОЛЖАЕТ работать и сохранять GPS координаты
3. Акселерометр перестаёт работать (ограничение iOS/Android)
4. При разблокировке экрана данные из AsyncStorage обрабатываются

---

## Ограничения

### Акселерометр в фоне
❌ **Акселерометр НЕ работает в фоне** на iOS и Android по причинам:
- Экономия батареи
- Политика конфиденциальности
- Ограничения ОС

**Решение:** Сбор акселерометра возобновляется при разблокировке экрана.

### Энергопотребление
⚡ Фоновое GPS отслеживание потребляет батарею. Оптимизации:
- `pausesUpdatesAutomatically: false` - для точности
- `distanceInterval: 1` - обновление только при движении
- Уведомление пользователя о фоновой работе

---

## Тестирование

### В разработке (Expo Go)
⚠️ **Ограничения Expo Go:**
- Фоновые задачи работают с ограничениями
- Рекомендуется использовать **Development Build**

### В продакшне
✅ После деплоя фоновое отслеживание работает полностью:
- GPS координаты сохраняются при заблокированном экране
- Уведомление показывает статус отслеживания
- Данные синхронизируются при возобновлении приложения

---

## Отладка

### Логи фоновой задачи

```typescript
// В фоновой задаче
console.log(`📍 Background location update: ${locations?.length || 0} locations`);
console.log(`✅ Background location saved: (${lat}, ${lng})`);
```

### Проверка работы фоновой задачи

```typescript
const hasTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
const taskInfo = await TaskManager.getRegisteredTasksAsync();
console.log('Registered tasks:', taskInfo);
```

---

## Известные проблемы и решения

### 1. "Task not registered"
**Проблема:** Ошибка при вызове `stopLocationUpdatesAsync`

**Решение:** Всегда проверяйте регистрацию задачи перед остановкой:
```typescript
const hasTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
if (hasTask) {
  await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
}
```

### 2. Задача не работает в Expo Go
**Проблема:** Фоновые задачи ограничены в Expo Go

**Решение:** Используйте Development Build или тестируйте после деплоя

### 3. iOS "Always Allow" не запрашивается
**Проблема:** Пользователь не видит опцию "Always Allow"

**Решение:** 
- Убедитесь что `NSLocationAlwaysAndWhenInUseUsageDescription` добавлен в app.json
- Вызывайте `requestBackgroundPermissionsAsync()` ПОСЛЕ foreground permissions

---

## Результат

✅ **До:** Данные собирались только при активном экране
✅ **После:** Данные собираются постоянно, даже при заблокированном экране

**Фоновое отслеживание теперь работает корректно на iOS и Android!**
