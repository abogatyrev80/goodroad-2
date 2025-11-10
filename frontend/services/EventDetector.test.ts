/**
 * EventDetector Test Script
 * 
 * Тестирует работу EventDetector с различными сценариями
 */

import EventDetector from './EventDetector';

// Цветной вывод для консоли
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

// Тестовые сценарии
const scenarios = [
  {
    name: '🚗 Нормальное движение по асфальту',
    data: [
      { x: 0.1, y: 0.2, z: 9.8, timestamp: Date.now() },
      { x: 0.15, y: 0.25, z: 9.85, timestamp: Date.now() + 20 },
      { x: 0.12, y: 0.22, z: 9.82, timestamp: Date.now() + 40 },
      { x: 0.13, y: 0.23, z: 9.83, timestamp: Date.now() + 60 },
    ]
  },
  {
    name: '🕳️ ЯМА! (высокий deltaY)',
    data: [
      { x: 0.1, y: 0.2, z: 9.8, timestamp: Date.now() },
      { x: 0.2, y: 4.5, z: 9.7, timestamp: Date.now() + 20 }, // Резкий скачок Y
      { x: 0.15, y: 0.3, z: 9.85, timestamp: Date.now() + 40 },
    ]
  },
  {
    name: '🚨 ЭКСТРЕННОЕ ТОРМОЖЕНИЕ (высокий deltaZ)',
    data: [
      { x: 0.1, y: 0.2, z: 9.8, timestamp: Date.now() },
      { x: 0.2, y: 0.3, z: 6.5, timestamp: Date.now() + 20 }, // Резкое изменение Z
      { x: 0.15, y: 0.25, z: 7.0, timestamp: Date.now() + 40 },
    ]
  },
  {
    name: '〰️ Вибрация/Неровность (средний deltaY)',
    data: [
      { x: 0.1, y: 0.2, z: 9.8, timestamp: Date.now() },
      { x: 0.2, y: 2.5, z: 9.7, timestamp: Date.now() + 20 }, // Умеренный скачок Y
      { x: 0.15, y: 0.3, z: 9.85, timestamp: Date.now() + 40 },
    ]
  },
  {
    name: '🌊 Боковое качание (высокий deltaX)',
    data: [
      { x: 0.1, y: 0.2, z: 9.8, timestamp: Date.now() },
      { x: 3.0, y: 0.3, z: 9.7, timestamp: Date.now() + 20 }, // Резкий скачок X
      { x: 0.2, y: 0.25, z: 9.85, timestamp: Date.now() + 40 },
    ]
  },
  {
    name: '🛣️ Грунтовая дорога (постоянная вибрация)',
    data: Array.from({ length: 20 }, (_, i) => ({
      x: 0.3 + Math.random() * 0.4,
      y: 0.5 + Math.random() * 0.8, // Постоянная высокая вибрация
      z: 9.5 + Math.random() * 0.6,
      timestamp: Date.now() + i * 20,
    }))
  },
  {
    name: '⚡ Критичное событие (комбинированное)',
    data: [
      { x: 0.1, y: 0.2, z: 9.8, timestamp: Date.now() },
      { x: 3.5, y: 5.5, z: 6.0, timestamp: Date.now() + 20 }, // Все оси зашкаливают
      { x: 0.2, y: 0.3, z: 9.7, timestamp: Date.now() + 40 },
    ]
  },
];

// Запуск тестов
async function runTests() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('🧪 EventDetector Test Suite', colors.cyan);
  log('='.repeat(60) + '\n', colors.cyan);

  // Создаём детектор с калибровкой для легкового авто
  const calibration = {
    vehicleType: 'sedan' as const,
    baseline: { x: 0, y: 0, z: 9.81, timestamp: Date.now() },
    thresholdMultiplier: 1.0,
  };

  const detector = new EventDetector(calibration);
  log('✅ EventDetector создан с калибровкой: Легковой автомобиль\n', colors.green);

  // Тестируем каждый сценарий
  for (const scenario of scenarios) {
    log(`\n${'─'.repeat(60)}`, colors.blue);
    log(`📋 Сценарий: ${scenario.name}`, colors.blue);
    log('─'.repeat(60), colors.blue);

    let eventCount = 0;
    let lastEvent: any = null;

    for (let i = 0; i < scenario.data.length; i++) {
      const data = scenario.data[i];
      const event = detector.processAccelerometerData(data);

      if (event) {
        eventCount++;
        lastEvent = event;

        // Цвет в зависимости от severity
        const severityColors = {
          1: colors.red,
          2: colors.magenta,
          3: colors.yellow,
          4: colors.cyan,
          5: colors.green,
        };

        const color = severityColors[event.severity] || colors.reset;

        log(`\n  🎯 Событие обнаружено (точка ${i + 1}/${scenario.data.length}):`, color);
        log(`     Тип: ${event.eventType}`, color);
        log(`     Серьёзность: ${event.severity}/5 ${event.severity === 1 ? '⚠️ КРИТИЧНО!' : ''}`, color);
        log(`     Magnitude: ${event.accelerometer.magnitude.toFixed(2)} m/s²`, color);
        log(`     ΔY (вертикаль): ${event.accelerometer.deltaY.toFixed(2)} m/s²`, color);
        log(`     ΔZ (торможение): ${event.accelerometer.deltaZ.toFixed(2)} m/s²`, color);
        log(`     Тип дороги: ${event.roadType}`, color);
        
        if (event.shouldNotifyUser) {
          log(`     🔔 Показать уведомление пользователю!`, colors.red);
        }
        if (event.shouldSendImmediately) {
          log(`     📤 Отправить немедленно!`, colors.red);
        }
      }
    }

    // Итоги сценария
    const roadType = detector.getRoadType();
    log(`\n  📊 Итоги сценария:`, colors.green);
    log(`     Обнаружено событий: ${eventCount}`, colors.green);
    log(`     Определён тип дороги: ${roadType}`, colors.green);

    if (lastEvent) {
      log(`     Последнее событие: ${lastEvent.eventType} (severity ${lastEvent.severity})`, colors.green);
    } else {
      log(`     События не обнаружены (нормальное движение)`, colors.green);
    }

    // Сброс детектора для следующего сценария
    detector.reset();
  }

  log('\n' + '='.repeat(60), colors.cyan);
  log('✅ Все тесты завершены!', colors.cyan);
  log('='.repeat(60) + '\n', colors.cyan);

  // Итоговая статистика
  log('📈 Возможности EventDetector:', colors.magenta);
  log('  ✅ Детекция ям и неровностей (deltaY)', colors.magenta);
  log('  ✅ Детекция торможения/разгона (deltaZ)', colors.magenta);
  log('  ✅ Детекция боковых качаний (deltaX)', colors.magenta);
  log('  ✅ Автоматическое определение типа дороги', colors.magenta);
  log('  ✅ 5 уровней серьёзности событий', colors.magenta);
  log('  ✅ Адаптивные пороги (дорога × авто × калибровка)', colors.magenta);
  log('  ✅ Флаги для UX (notify, sendImmediately)', colors.magenta);
  log('\n');
}

// Запуск
runTests().catch(console.error);
