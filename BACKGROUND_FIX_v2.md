# Исправление фонового отслеживания - v2

## Проблема (ПОДТВЕРЖДЕНА пользователем!)

**Симптомы:**
- ✅ Foreground service работает (уведомление показывается)
- ❌ Данные НЕ отправляются при заблокированном экране
- ✅ Первые 2 минуты работало (14:19-14:21 МСК)
- ❌ После блокировки экрана данные перестали поступать (~час тишины)

**Тестовая поездка:**
- Начало: 14:19 МСК
- Блокировка экрана: ~14:21 МСК
- Завершение: ~15:20 МСК
- Данные на сервере: только до 14:21 МСК
- **Потеряно: ~59 минут данных**

---

## Корневая причина

### Версия 1 (неполная)
```typescript
// Background task ТОЛЬКО сохранял GPS в AsyncStorage
await AsyncStorage.setItem('lastBackgroundLocation', JSON.stringify(location));
// ❌ НО НЕ отправлял на сервер!
```

**Проблема:** Background task сохранял данные локально, но:
1. Нет кода для отправки на сервер
2. Foreground код не читает данные из AsyncStorage
3. При разблокировке данные не синхронизируются

---

## Решение v2

### Прямая отправка из Background Task

```typescript
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (data) {
    const { locations } = data as any;
    const location = locations[0];
    
    // 1. Получаем настройки из AsyncStorage
    const backendUrl = await AsyncStorage.getItem('backendUrl');
    const deviceId = await AsyncStorage.getItem('deviceId');
    
    // 2. Формируем пакет данных (GPS без акселерометра)
    const gpsData = {
      deviceId: deviceId,
      data: [{
        timestamp: location.timestamp,
        gps: {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          speed: location.coords.speed || 0,
          accuracy: location.coords.accuracy || 0,
          altitude: location.coords.altitude,
        },
        accelerometer: [], // Пустой - не работает в фоне
      }]
    };
    
    // 3. 🆕 ПРЯМАЯ ОТПРАВКА на сервер
    const response = await fetch(`${backendUrl}/api/raw-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gpsData),
    });
    
    if (response.ok) {
      console.log('✅ Background: данные отправлены');
    }
  }
});
```

### Сохранение настроек при старте

```typescript
useEffect(() => {
  // Сохраняем backendUrl и deviceId для background task
  const saveSettings = async () => {
    await AsyncStorage.setItem('backendUrl', backendUrl);
    await AsyncStorage.setItem('deviceId', deviceId);
  };
  saveSettings();
}, [deviceId, backendUrl]);
```

---

## Как это работает теперь

### Когда экран активен:
1. **Foreground subscription** → UI обновляется в реальном времени
2. **Background task** → Параллельно отправляет GPS на сервер
3. **Акселерометр** → Собирает данные каждые 100мс
4. **RawDataCollector** → Создаёт синхронизированные пакеты (GPS + accel)

### Когда экран заблокирован:
1. **Foreground subscription** → Останавливается (нормально)
2. **Background task** → ✅ ПРОДОЛЖАЕТ работать и отправлять GPS
3. **Акселерометр** → Останавливается (ограничение ОС)
4. **Foreground service** → Показывает уведомление

### При разблокировке:
1. **Foreground subscription** → Возобновляется
2. **Акселерометр** → Возобновляется
3. **Background task** → Продолжает работать параллельно

---

## Структура отправляемых данных

### Foreground режим (с акселерометром):
```json
{
  "deviceId": "mobile-app-1234567890",
  "data": [
    {
      "timestamp": 1733315670000,
      "gps": {
        "latitude": 55.676646,
        "longitude": 37.252046,
        "speed": 4.75,
        "accuracy": 10.5,
        "altitude": 150
      },
      "accelerometer": [
        {"x": 0.12, "y": -0.05, "z": 9.81, "timestamp": 1733315670100},
        {"x": 0.15, "y": -0.03, "z": 9.78, "timestamp": 1733315670200},
        ...
      ]
    }
  ]
}
```

### Background режим (только GPS):
```json
{
  "deviceId": "mobile-app-1234567890",
  "data": [
    {
      "timestamp": 1733315670000,
      "gps": {
        "latitude": 55.676646,
        "longitude": 37.252046,
        "speed": 4.75,
        "accuracy": 10.5,
        "altitude": 150
      },
      "accelerometer": []  // Пустой массив
    }
  ]
}
```

---

## Преимущества решения

### ✅ Непрерывный сбор GPS
- Данные отправляются каждую секунду, даже при заблокированном экране
- Траектория движения не прерывается

### ✅ Независимость от foreground
- Background task не зависит от состояния React компонента
- Работает параллельно с foreground логикой

### ✅ Graceful degradation
- При активном экране: GPS + акселерометр (полные данные)
- При заблокированном экране: только GPS (частичные данные)
- Сервер обрабатывает оба формата

### ✅ Надёжность
- Прямая отправка из background task
- Нет зависимости от AsyncStorage синхронизации
- Логи для отладки в background task

---

## Ограничения

### Акселерометр в фоне
❌ **По-прежнему не работает** (ограничение iOS/Android)
- Данные качества дороги неполные при заблокированном экране
- Возобновляется при разблокировке

### Expo Go
⚠️ **Background tasks ограничены в Expo Go**
- Для полного тестирования нужен Development Build или production деплой
- В Expo Go фоновое отслеживание может работать нестабильно

### Энергопотребление
⚡ **Постоянное GPS отслеживание потребляет батарею**
- Показывается уведомление о фоновой работе
- Пользователь информирован через foreground service notification

---

## Тестирование

### Сценарий 1: Активный экран
1. Открыть приложение
2. Нажать "Начать отслеживание"
3. Подождать 10 секунд
4. Остановить отслеживание
5. **Ожидание:** Данные с GPS + акселерометром на сервере

### Сценарий 2: Заблокированный экран (КЛЮЧЕВОЙ!)
1. Открыть приложение
2. Нажать "Начать отслеживание"
3. **Заблокировать экран** 📱🔒
4. Ждать 1-2 минуты
5. Разблокировать
6. Остановить отслеживание
7. **Ожидание:** Данные за всё время (с пустым акселерометром во время блокировки)

### Сценарий 3: Приложение в фоне
1. Открыть приложение
2. Нажать "Начать отслеживание"
3. **Свернуть приложение** (перейти на домашний экран)
4. Ждать 1-2 минуты
5. Вернуться в приложение
6. Остановить отслеживание
7. **Ожидание:** Данные за всё время

---

## Проверка на production

```bash
# Последние данные
curl -s 'https://goodroad.su/api/admin/v2/raw-data?limit=10' \
  | jq '.data | map({timestamp, latitude, longitude, speed})'

# Мониторинг в реальном времени
watch -n 5 'curl -s "https://goodroad.su/api/admin/v2/analytics" | jq ".summary"'
```

---

## Следующие шаги

1. **Пользовательское тестирование**
   - Протестировать на реальном устройстве
   - Длинная поездка с заблокированным экраном
   - Проверить непрерывность данных на сервере

2. **Если не работает в Expo Go**
   - Создать Development Build
   - Или дождаться production деплоя

3. **Дополнительные улучшения**
   - Добавить буферизацию background данных при отсутствии сети
   - Добавить retry логику при ошибках отправки
   - Оптимизировать частоту отправки для экономии батареи

---

## Изменённые файлы

- `/app/frontend/app/index.tsx`
  - Background task теперь отправляет данные на сервер
  - Добавлено сохранение настроек в AsyncStorage
  - Улучшено логирование

---

**Статус:** ✅ Готово к тестированию на реальном устройстве
**Ожидаемый результат:** Непрерывный сбор GPS координат, даже при заблокированном экране
