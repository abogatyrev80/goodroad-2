# Руководство по использованию CalibrationService

## 📋 Обзор

CalibrationService - это сервис для адаптивной калибровки акселерометра мобильного устройства. Он собирает данные во время поездки, отправляет их на сервер для статистического анализа и получает персональные пороги обнаружения дефектов дороги.

## 🎯 Основные функции

### 1. Инициализация (автоматическая)
```typescript
import { calibrationService } from './services/CalibrationService';

// Сервис инициализируется автоматически
// Логи в консоли:
// === 🎯 CALIBRATION SERVICE INITIALIZED ===
// Backend URL: https://...
// Device ID: mobile-app-xxxxx
```

### 2. Режим калибровки

#### Начать калибровку
```typescript
await calibrationService.startCalibration('urban');
// 'urban' | 'highway' | 'unpaved'

// Логи:
// === 🎯 START CALIBRATION ===
// Road type: urban
// Calibration mode: ACTIVE
```

#### Добавление образцов
```typescript
// В цикле сбора данных акселерометра
Accelerometer.addListener(({ x, y, z }) => {
  if (calibrationService.isCalibrationActive()) {
    calibrationService.addSample(x, y, z);
  }
});

// Логи каждые 10 образцов:
// 📊 [CALIBRATION] Образцов собрано: 10/20
// Последний образец: x=0.12, y=0.21, z=9.80
```

#### Проверка готовности
```typescript
if (calibrationService.isReadyToSubmit()) {
  // Достаточно образцов для калибровки
  await submitToServer();
}
```

#### Отправка на сервер
```typescript
const profile = await calibrationService.submitCalibration(
  currentSpeed, // км/ч
  'urban'
);

if (profile) {
  console.log('✅ Калибровка завершена!');
  // profile содержит персональные пороги
}

// Подробные логи:
// === 📤 SUBMIT CALIBRATION ===
// Samples count: 50
// Speed: 30 km/h
// 📦 Payload размер: 2456 bytes
// 🌐 Отправка на: https://...
// ✅ Профиль получен от сервера
// Baseline: x=0.114, y=0.213, z=9.805
// Total deviation threshold: 0.070
```

### 3. Загрузка профиля

```typescript
const profile = await calibrationService.loadProfile();

if (profile && profile.has_profile) {
  console.log('✅ Профиль загружен, используем персональные пороги');
} else {
  console.log('⚠️ Профиля нет, используем дефолтные пороги');
}

// Логи:
// === 📥 LOAD CALIBRATION PROFILE ===
// Device ID: mobile-app-xxxxx
// ✅ Профиль найден на сервере
// Sample count: 50
// Total deviation: 0.070
```

### 4. Обнаружение аномалий

```typescript
// В основном цикле мониторинга
Accelerometer.addListener(({ x, y, z }) => {
  const isDefect = calibrationService.detectAnomaly(x, y, z);
  
  if (isDefect) {
    // Обнаружен дефект дороги!
    showWarning();
  }
});

// Логи при обнаружении:
// 🚨 [ANOMALY DETECTED]
// Current: x=2.50, y=1.80, z=11.30
// Baseline: x=0.11, y=0.21, z=9.81
// Deviation: 2.156 > threshold: 0.070
```

### 5. Сброс профиля

```typescript
await calibrationService.resetProfile();

// Логи:
// === 🔄 RESET CALIBRATION PROFILE ===
// ✅ Профиль удален с сервера
// ✅ Профиль сброшен локально
```

## 🔄 Типичный сценарий использования

### Первый запуск (новое устройство)

```typescript
// 1. При старте приложения
useEffect(() => {
  initializeCalibration();
}, []);

async function initializeCalibration() {
  // Пробуем загрузить существующий профиль
  const profile = await calibrationService.loadProfile();
  
  if (!profile || !profile.has_profile) {
    console.log('🎯 Новое устройство, требуется калибровка');
    setNeedsCalibration(true);
  } else {
    console.log('✅ Профиль найден, калибровка не требуется');
    setNeedsCalibration(false);
  }
}

// 2. Когда пользователь начинает поездку
async function startMonitoring() {
  const needsCalibration = !calibrationService.getProfile();
  
  if (needsCalibration) {
    // Показываем уведомление
    Alert.alert(
      'Калибровка',
      'Первые 5 минут поездки - калибровка датчиков. Пожалуйста, двигайтесь по ровной дороге.',
      [{ text: 'OK' }]
    );
    
    // Начинаем калибровку
    await calibrationService.startCalibration('urban');
    setCalibrationTimer(5 * 60); // 5 минут
  }
  
  // Начинаем мониторинг
  startAccelerometerListener();
}

// 3. В listener акселерометра
function startAccelerometerListener() {
  Accelerometer.setUpdateInterval(500); // 500ms
  
  Accelerometer.addListener(({ x, y, z }) => {
    // Если калибровка активна - собираем образцы
    if (calibrationService.isCalibrationActive()) {
      calibrationService.addSample(x, y, z);
      
      // Обновляем UI счетчика
      const count = calibrationService.getSampleCount();
      setCalibrationProgress(count);
      
      // Проверяем готовность к отправке
      if (calibrationService.isReadyToSubmit()) {
        submitCalibrationData();
      }
    } else {
      // Обычный режим - проверяем аномалии
      const isDefect = calibrationService.detectAnomaly(x, y, z);
      if (isDefect) {
        handleRoadDefect();
      }
    }
  });
}

// 4. Отправка калибровочных данных
async function submitCalibrationData() {
  const speed = await getSpeed(); // Получаем текущую скорость
  
  const profile = await calibrationService.submitCalibration(speed, 'urban');
  
  if (profile) {
    Alert.alert(
      'Калибровка завершена!',
      'Теперь система адаптирована под ваше устройство.',
      [{ text: 'Отлично!' }]
    );
    
    setNeedsCalibration(false);
  } else {
    console.error('Не удалось завершить калибровку');
  }
}
```

### Повторная поездка (устройство откалибровано)

```typescript
// 1. Загружаем профиль
const profile = await calibrationService.loadProfile();

// 2. Используем персональные пороги для обнаружения
Accelerometer.addListener(({ x, y, z }) => {
  const isDefect = calibrationService.detectAnomaly(x, y, z);
  if (isDefect) {
    // Реагируем на дефект
  }
});

// 3. Периодически отправляем новые калибровочные данные
//    для адаптации (раз в неделю/месяц)
if (shouldRecalibrate()) {
  await calibrationService.startCalibration('urban');
  // Собираем новые образцы...
}
```

## 📊 Логи для отладки

### Успешная калибровка
```
=== 🎯 START CALIBRATION ===
Road type: urban
Calibration mode: ACTIVE
============================

📊 [CALIBRATION] Образцов собрано: 10/20
📊 [CALIBRATION] Образцов собрано: 20/20

=== 📤 SUBMIT CALIBRATION ===
Samples count: 20
Speed: 30 km/h
📦 Payload размер: 2456 bytes
🌐 Отправка на: https://roadquality.preview.emergentagent.com/api/calibration/submit
📡 Response status: 200
✅ Профиль получен от сервера:
   Baseline: x=0.114, y=0.213, z=9.805
   Std Dev: x=0.022, y=0.022, z=0.016
   Total deviation threshold: 0.070
   Sample count: 20
   Update type: new
💾 Профиль сохранен в AsyncStorage
============================
```

### Обнаружение дефектов
```
🚨 [ANOMALY DETECTED]
   Current: x=2.50, y=1.80, z=11.30
   Baseline: x=0.11, y=0.21, z=9.81
   Deviation: 2.156 > threshold: 0.070
```

### Ошибки
```
❌ [CALIBRATION] Недостаточно образцов: 5/20
❌ [CALIBRATION] Server error: 500 Internal Server Error
❌ [CALIBRATION] Ошибка отправки: Network request failed
```

## 🔧 Настройки

### Минимальное количество образцов
```typescript
private readonly MIN_SAMPLES = 20;
```
Увеличьте для более точной калибровки (рекомендуется 50-100)

### Максимальное количество образцов
```typescript
private readonly MAX_SAMPLES = 100;
```
Ограничивает размер payload при отправке

### Интервал сбора данных
```typescript
Accelerometer.setUpdateInterval(500); // миллисекунды
```
Рекомендуется 200-500ms для баланса точности и производительности

## ⚠️ Важные заметки

1. **Первая калибровка** - требует 5 минут езды по ровной дороге
2. **Адаптация** - профиль автоматически обновляется (70% старое + 30% новое)
3. **Кэширование** - профиль сохраняется локально и работает оффлайн
4. **Device ID** - уникален для каждого устройства

## 🐛 Отладка

Все логи имеют префиксы для легкой фильтрации:
- `[CALIBRATION]` - общие события калибровки
- `[ANOMALY DETECTED]` - обнаружение дефектов
- `🎯` - начало/конец процессов
- `✅` - успешные операции
- `❌` - ошибки
- `⚠️` - предупреждения

Используйте в терминале:
```bash
# Все логи калибровки
tail -f /var/log/supervisor/expo.out.log | grep CALIBRATION

# Только обнаружение аномалий
tail -f /var/log/supervisor/expo.out.log | grep ANOMALY

# Ошибки калибровки
tail -f /var/log/supervisor/expo.out.log | grep "❌.*CALIBRATION"
```
