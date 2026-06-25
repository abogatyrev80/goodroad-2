import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

interface AccelerometerSample {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

interface CalibrationProfile {
  deviceId: string;
  baseline: { x: number; y: number; z: number };
  thresholds: {
    x_max: number;
    x_min: number;
    y_max: number;
    y_min: number;
    z_max: number;
    z_min: number;
    total_deviation: number;
  };
  std_dev: { x: number; y: number; z: number };
  sample_count: number;
  last_updated: string;
  road_type: string;
  has_profile: boolean;
}

class CalibrationService {
  private backendUrl: string;
  private deviceId: string;
  private calibrationSamples: AccelerometerSample[] = [];
  private isCalibrating: boolean = false;
  private calibrationProfile: CalibrationProfile | null = null;
  private readonly CALIBRATION_SAMPLES_KEY = 'calibration_samples';
  private readonly CALIBRATION_PROFILE_KEY = 'calibration_profile';
  private readonly MIN_SAMPLES = 20; // Минимум 20 образцов для калибровки
  private readonly MAX_SAMPLES = 100; // Максимум 100 образцов

  constructor() {
    const url = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://goodroad.su';
    this.backendUrl = url.endsWith('/') ? url : url + '/';
    this.deviceId = Constants.deviceId || `mobile-app-${Date.now()}`;
    
  }

  // Получить ID устройства
  getDeviceId(): string {
    return this.deviceId;
  }

  // Начать калибровку
  async startCalibration(roadType: string = 'urban'): Promise<void> {
    
    this.isCalibrating = true;
    this.calibrationSamples = [];
    
  }

  // Остановить калибровку
  stopCalibration(): void {
    
    this.isCalibrating = false;
  }

  // Проверить активна ли калибровка
  isCalibrationActive(): boolean {
    return this.isCalibrating;
  }

  // Добавить образец акселерометра
  addSample(x: number, y: number, z: number): void {
    if (!this.isCalibrating) {
      return;
    }

    const sample: AccelerometerSample = {
      x,
      y,
      z,
      timestamp: Date.now()
    };

    this.calibrationSamples.push(sample);

    // Логируем каждый 10-й образец
    if (this.calibrationSamples.length % 10 === 0) {
    }

    // Ограничиваем количество образцов
    if (this.calibrationSamples.length > this.MAX_SAMPLES) {
      this.calibrationSamples.shift();
    }
  }

  // Получить количество собранных образцов
  getSampleCount(): number {
    return this.calibrationSamples.length;
  }

  // Проверить готовность к отправке
  isReadyToSubmit(): boolean {
    return this.calibrationSamples.length >= this.MIN_SAMPLES;
  }

  // Отправить калибровочные данные на сервер
  async submitCalibration(speed: number, roadType: string = 'urban'): Promise<CalibrationProfile | null> {

    if (this.calibrationSamples.length < this.MIN_SAMPLES) {
      console.error(`❌ [CALIBRATION] Недостаточно образцов: ${this.calibrationSamples.length}/${this.MIN_SAMPLES}`);
      return null;
    }

    try {
      const payload = {
        deviceId: this.deviceId,
        accelerometerData: this.calibrationSamples,
        speed: speed,
        roadType: roadType
      };


      const response = await fetch(this.backendUrl + 'api/calibration/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });


      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ [CALIBRATION] Server error:', errorText);
        throw new Error(`Server responded with ${response.status}`);
      }

      const result: CalibrationProfile = await response.json();
      

      // Сохраняем профиль
      this.calibrationProfile = result;
      await AsyncStorage.setItem(this.CALIBRATION_PROFILE_KEY, JSON.stringify(result));
      

      // Очищаем образцы после успешной отправки
      this.calibrationSamples = [];
      this.isCalibrating = false;

      return result;

    } catch (error) {
      console.error('❌ [CALIBRATION] Ошибка отправки:', error);
      console.error('Stack trace:', (error as Error).stack);
      return null;
    }
  }

  // Загрузить профиль калибровки с сервера
  async loadProfile(): Promise<CalibrationProfile | null> {

    try {
      // Сначала пробуем загрузить с сервера
      const response = await fetch(
        this.backendUrl + `api/calibration/profile/${this.deviceId}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        }
      );


      if (response.ok) {
        const profile: CalibrationProfile = await response.json();
        
        if (profile.has_profile) {
          
          this.calibrationProfile = profile;
          await AsyncStorage.setItem(this.CALIBRATION_PROFILE_KEY, JSON.stringify(profile));
        } else {
        }
        
        return profile;
      } else {
        console.warn('⚠️ [CALIBRATION] Сервер недоступен, пробуем кэш...');
        
        // Пробуем загрузить из кэша
        const cached = await AsyncStorage.getItem(this.CALIBRATION_PROFILE_KEY);
        if (cached) {
          const profile = JSON.parse(cached);
          this.calibrationProfile = profile;
          return profile;
        }
        
        return null;
      }
    } catch (error) {
      console.error('❌ [CALIBRATION] Ошибка загрузки профиля:', error);
      return null;
    }
  }

  // Получить текущий профиль
  getProfile(): CalibrationProfile | null {
    return this.calibrationProfile;
  }

  // Проверить аномалию (дефект дороги)
  detectAnomaly(x: number, y: number, z: number): boolean {
    if (!this.calibrationProfile || !this.calibrationProfile.has_profile) {
      // Если нет профиля, используем простое определение
      const totalAccel = Math.sqrt(x * x + y * y + z * z);
      const deviation = Math.abs(totalAccel - 9.8);
      return deviation > 2.0; // Дефолтный порог
    }

    const profile = this.calibrationProfile;
    const baseline = profile.baseline;
    const thresholds = profile.thresholds;

    // Рассчитываем отклонение от базовой линии
    const dx = Math.abs(x - baseline.x);
    const dy = Math.abs(y - baseline.y);
    const dz = Math.abs(z - baseline.z);
    
    const totalDeviation = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Проверяем превышение порога
    const isAnomaly = totalDeviation > thresholds.total_deviation;

    if (isAnomaly) {
    }

    return isAnomaly;
  }

  // Сбросить профиль калибровки
  async resetProfile(): Promise<void> {
    
    try {
      // Удаляем с сервера
      const response = await fetch(
        this.backendUrl + `api/calibration/profile/${this.deviceId}`,
        {
          method: 'DELETE',
        }
      );

      if (response.ok) {
      }
    } catch (error) {
      console.warn('⚠️ [CALIBRATION] Не удалось удалить профиль с сервера:', error);
    }

    // Удаляем из кэша
    await AsyncStorage.removeItem(this.CALIBRATION_PROFILE_KEY);
    this.calibrationProfile = null;
    this.calibrationSamples = [];
    
  }
}

export const calibrationService = new CalibrationService();
export type { CalibrationProfile, AccelerometerSample };
