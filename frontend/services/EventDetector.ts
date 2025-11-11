/**
 * EventDetector.ts
 * 
 * Умная система детекции дорожных событий на основе данных акселерометра
 * - Классификация событий (яма, торможение, вибрация)
 * - Определение типа дороги (асфальт, грунт, гравий)
 * - Адаптивные пороги на основе типа дороги и автомобиля
 */

export type RoadType = 'asphalt' | 'gravel' | 'dirt' | 'unknown';
export type VehicleType = 'sedan' | 'crossover' | 'suv';
/**
 * Типы событий
 */
export type EventType = 
  | 'pothole'     // Яма
  | 'braking'     // Резкое торможение
  | 'vibration'   // Вибрация (плохая дорога)
  | 'bump'        // Кочка/неровность
  | 'accident'    // Авария (пользовательская отметка) - НОВОЕ
  | 'normal'      // Нормальное движение
  | 'test_sync';  // Тестовая синхронизация
export type SeverityLevel = 1 | 2 | 3 | 4 | 5; // 1=критичный, 5=нормальный

export interface AccelerometerData {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface DetectedEvent {
  eventType: EventType;
  severity: SeverityLevel;
  timestamp: number;
  accelerometer: {
    x: number;
    y: number;
    z: number;
    magnitude: number;
    deltaY: number; // Вертикальное изменение
    deltaZ: number; // Продольное изменение (торможение/разгон)
    deltaX: number; // Боковое изменение (НОВОЕ)
    variance: number; // Variance для ML (НОВОЕ)
  };
  roadType: RoadType;
  speed?: number; // Скорость движения (НОВОЕ)
  shouldNotifyUser: boolean; // Показать диалог пользователю
  shouldSendImmediately: boolean; // Отправить немедленно (критичное)
}

export interface CalibrationProfile {
  vehicleType: VehicleType;
  baseline: AccelerometerData; // Базовые показания в покое
  thresholdMultiplier: number; // Множитель для порогов (0.8-1.2)
}

/**
 * Пороговые значения для детекции событий
 * Научно обоснованные на основе исследований качества дорог
 */
const BASE_THRESHOLDS = {
  // Вертикальная ось (Y) - основная для дорог
  pothole: {
    critical: 4.5,   // > 4.5 m/s² - критичная яма
    high: 3.0,       // 3.0-4.5 m/s² - яма
    medium: 2.0,     // 2.0-3.0 m/s² - неровность
    low: 1.5,        // 1.5-2.0 m/s² - мелкий дефект
  },
  
  // Продольная ось (Z) - торможение/разгон
  braking: {
    emergency: 3.0,  // > 3.0 m/s² - экстренное торможение
    sharp: 2.5,      // 2.5-3.0 m/s² - резкое торможение
    moderate: 1.5,   // 1.5-2.5 m/s² - умеренное торможение
  },
  
  // Поперечная ось (X) - боковые качания
  lateral: {
    sharp: 2.5,      // > 2.5 m/s² - резкий маневр
    moderate: 1.5,   // 1.5-2.5 m/s² - умеренное качание
  },
  
  // Общая magnitude для комбинированных событий
  magnitude: {
    critical: 5.0,   // Критичное событие
    high: 4.0,       // Высокая интенсивность
    medium: 3.0,     // Средняя интенсивность
  }
};

/**
 * Множители для разных типов дорог
 */
const ROAD_TYPE_MULTIPLIERS: Record<RoadType, number> = {
  asphalt: 1.0,    // Стандартные пороги
  gravel: 1.5,     // Гравий - больше допустимая вибрация
  dirt: 1.8,       // Грунт - ещё больше вибрации
  unknown: 1.2,    // Неизвестно - осторожный подход
};

/**
 * Множители для разных типов автомобилей
 */
const VEHICLE_TYPE_MULTIPLIERS: Record<VehicleType, number> = {
  sedan: 1.0,      // Легковой - мягкая подвеска, чувствительнее
  crossover: 0.9,  // Кроссовер - средняя подвеска
  suv: 0.8,        // Внедорожник - жёсткая подвеска, менее чувствителен
};

class EventDetector {
  private previousData: AccelerometerData | null = null;
  private calibration: CalibrationProfile | null = null;
  private detectedRoadType: RoadType = 'unknown';
  private roadTypeHistory: number[] = []; // История вибраций для определения типа дороги
  
  constructor(calibration?: CalibrationProfile) {
    this.calibration = calibration || null;
  }
  
  /**
   * Установить калибровочный профиль
   */
  setCalibration(calibration: CalibrationProfile) {
    this.calibration = calibration;
  }
  
  /**
   * Основной метод обработки данных акселерометра
   */
  processAccelerometerData(data: AccelerometerData): DetectedEvent | null {
    // Первое чтение - сохраняем и выходим
    if (!this.previousData) {
      this.previousData = data;
      return null;
    }
    
    // Вычисляем изменения (delta)
    const deltaX = Math.abs(data.x - this.previousData.x);
    const deltaY = Math.abs(data.y - this.previousData.y);
    const deltaZ = Math.abs(data.z - this.previousData.z);
    
    // Общая magnitude изменения
    const magnitude = Math.sqrt(deltaX ** 2 + deltaY ** 2 + deltaZ ** 2);
    
    // Обновляем историю для определения типа дороги
    this.updateRoadTypeHistory(magnitude);
    this.detectRoadType();
    
    // Получаем адаптивные пороги
    const thresholds = this.getAdaptiveThresholds();
    
    // Классифицируем событие
    const event = this.classifyEvent({
      deltaX,
      deltaY,
      deltaZ,
      magnitude,
      thresholds,
      data
    });
    
    // Обновляем предыдущие данные
    this.previousData = data;
    
    return event;
  }
  
  /**
   * Обновить историю вибраций для определения типа дороги
   */
  private updateRoadTypeHistory(magnitude: number) {
    this.roadTypeHistory.push(magnitude);
    
    // Храним только последние 100 измерений (примерно 2 секунды при 50Hz)
    if (this.roadTypeHistory.length > 100) {
      this.roadTypeHistory.shift();
    }
  }
  
  /**
   * Вычислить variance для последних N измерений (НОВОЕ - для ML)
   * Variance показывает изменчивость accelerometer данных
   */
  private calculateVariance(windowSize: number = 20): number {
    if (this.roadTypeHistory.length < windowSize) {
      return 0;
    }
    
    // Берём последние windowSize измерений
    const recentData = this.roadTypeHistory.slice(-windowSize);
    
    // Средне значение
    const mean = recentData.reduce((sum, val) => sum + val, 0) / recentData.length;
    
    // Variance = среднее квадратов отклонений от среднего
    const variance = recentData.reduce((sum, val) => {
      const diff = val - mean;
      return sum + (diff * diff);
    }, 0) / recentData.length;
    
    return variance;
  }
  
  /**
   * Автоматическое определение типа дороги
   */
  private detectRoadType() {
    if (this.roadTypeHistory.length < 50) {
      return; // Недостаточно данных
    }
    
    // Вычисляем среднюю базовую вибрацию
    const avgVibration = this.roadTypeHistory.reduce((sum, val) => sum + val, 0) / this.roadTypeHistory.length;
    
    // Классификация на основе средней вибрации
    if (avgVibration < 0.5) {
      this.detectedRoadType = 'asphalt'; // Низкая вибрация = асфальт
    } else if (avgVibration < 1.0) {
      this.detectedRoadType = 'gravel'; // Средняя вибрация = гравий
    } else {
      this.detectedRoadType = 'dirt'; // Высокая вибрация = грунт
    }
  }
  
  /**
   * Получить адаптивные пороги с учётом типа дороги и автомобиля
   */
  private getAdaptiveThresholds() {
    const roadMultiplier = ROAD_TYPE_MULTIPLIERS[this.detectedRoadType];
    const vehicleMultiplier = this.calibration 
      ? VEHICLE_TYPE_MULTIPLIERS[this.calibration.vehicleType]
      : 1.0;
    
    const calibrationMultiplier = this.calibration?.thresholdMultiplier || 1.0;
    
    const totalMultiplier = roadMultiplier * vehicleMultiplier * calibrationMultiplier;
    
    // Применяем множитель ко всем порогам
    return {
      pothole: {
        critical: BASE_THRESHOLDS.pothole.critical * totalMultiplier,
        high: BASE_THRESHOLDS.pothole.high * totalMultiplier,
        medium: BASE_THRESHOLDS.pothole.medium * totalMultiplier,
        low: BASE_THRESHOLDS.pothole.low * totalMultiplier,
      },
      braking: {
        emergency: BASE_THRESHOLDS.braking.emergency * totalMultiplier,
        sharp: BASE_THRESHOLDS.braking.sharp * totalMultiplier,
        moderate: BASE_THRESHOLDS.braking.moderate * totalMultiplier,
      },
      lateral: {
        sharp: BASE_THRESHOLDS.lateral.sharp * totalMultiplier,
        moderate: BASE_THRESHOLDS.lateral.moderate * totalMultiplier,
      },
      magnitude: {
        critical: BASE_THRESHOLDS.magnitude.critical * totalMultiplier,
        high: BASE_THRESHOLDS.magnitude.high * totalMultiplier,
        medium: BASE_THRESHOLDS.magnitude.medium * totalMultiplier,
      }
    };
  }
  
  /**
   * Классификация события на основе данных акселерометра
   */
  private classifyEvent(params: {
    deltaX: number;
    deltaY: number;
    deltaZ: number;
    magnitude: number;
    thresholds: any;
    data: AccelerometerData;
  }): DetectedEvent | null {
    const { deltaX, deltaY, deltaZ, magnitude, thresholds, data } = params;
    
    let eventType: EventType = 'normal';
    let severity: SeverityLevel = 5;
    let shouldNotifyUser = false;
    let shouldSendImmediately = false;
    
    // Проверка критичных событий (приоритет 1)
    if (magnitude >= thresholds.magnitude.critical) {
      eventType = 'pothole';
      severity = 1;
      shouldNotifyUser = true;
      shouldSendImmediately = true;
    }
    // Проверка ям и неровностей (вертикальная ось Y)
    else if (deltaY >= thresholds.pothole.critical) {
      eventType = 'pothole';
      severity = 1;
      shouldNotifyUser = true;
      shouldSendImmediately = true;
    }
    else if (deltaY >= thresholds.pothole.high) {
      eventType = 'pothole';
      severity = 2;
      shouldNotifyUser = true;
      shouldSendImmediately = false;
    }
    else if (deltaY >= thresholds.pothole.medium) {
      eventType = 'bump';
      severity = 3;
    }
    else if (deltaY >= thresholds.pothole.low) {
      eventType = 'vibration';
      severity = 4;
    }
    // Проверка торможения (продольная ось Z)
    else if (deltaZ >= thresholds.braking.emergency) {
      eventType = 'braking';
      severity = 1;
      shouldNotifyUser = true;
      shouldSendImmediately = true;
    }
    else if (deltaZ >= thresholds.braking.sharp) {
      eventType = 'braking';
      severity = 2;
    }
    else if (deltaZ >= thresholds.braking.moderate) {
      eventType = 'braking';
      severity = 3;
    }
    // Проверка боковых качаний (поперечная ось X)
    else if (deltaX >= thresholds.lateral.sharp) {
      eventType = 'vibration';
      severity = 2;
    }
    else if (deltaX >= thresholds.lateral.moderate) {
      eventType = 'vibration';
      severity = 3;
    }
    
    // Если нет значимых событий - возвращаем null
    if (eventType === 'normal' && magnitude < 1.0) {
      return null;
    }
    
    // Вычислить variance для ML (НОВОЕ)
    const variance = this.calculateVariance(20);
    
    return {
      eventType,
      severity,
      timestamp: data.timestamp,
      accelerometer: {
        x: data.x,
        y: data.y,
        z: data.z,
        magnitude,
        deltaY,
        deltaZ,
        deltaX, // НОВОЕ
        variance, // НОВОЕ - для ML анализа
      },
      roadType: this.detectedRoadType,
      shouldNotifyUser,
      shouldSendImmediately,
    };
  }
  
  /**
   * Получить текущий тип дороги
   */
  getRoadType(): RoadType {
    return this.detectedRoadType;
  }
  
  /**
   * Сбросить историю (например, при смене маршрута)
   */
  reset() {
    this.previousData = null;
    this.roadTypeHistory = [];
    this.detectedRoadType = 'unknown';
  }
}

export default EventDetector;
