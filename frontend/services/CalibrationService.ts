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
    const url = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://potholefinder.preview.emergentagent.com';
    this.backendUrl = url.endsWith('/') ? url : url + '/';
    this.deviceId = Constants.deviceId || `mobile-app-${Date.now()}`;
    
    console.log('=== 🎯 CALIBRATION SERVICE INITIALIZED ===');
    console.log('Backend URL:', this.backendUrl);
    console.log('Device ID:', this.deviceId);
    console.log('Min samples required:', this.MIN_SAMPLES);
    console.log('==========================================');
  }

  // Получить ID устройства
  getDeviceId(): string {
    return this.deviceId;
  }

  // Начать калибровку
  async startCalibration(roadType: string = 'urban'): Promise<void> {
    console.log('\n=== 🎯 START CALIBRATION ===');
    console.log('Road type:', roadType);
    console.log('Device ID:', this.deviceId);
    
    this.isCalibrating = true;
    this.calibrationSamples = [];
    
    console.log('✅ Calibration mode: ACTIVE');
    console.log('📊 Samples collected: 0/' + this.MIN_SAMPLES);
    console.log('============================\n');
  }

  // Остановить калибровку
  stopCalibration(): void {
    console.log('\n=== 🛑 STOP CALIBRATION ===');
    console.log('Samples collected:', this.calibrationSamples.length);
    console.log('Calibration mode: INACTIVE');
    console.log('===========================\n');
    
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
      console.log(`📊 [CALIBRATION] Образцов собрано: ${this.calibrationSamples.length}/${this.MIN_SAMPLES}`);
      console.log(`   Последний образец: x=${x.toFixed(2)}, y=${y.toFixed(2)}, z=${z.toFixed(2)}`);
    }

    // Ограничиваем количество образцов
    if (this.calibrationSamples.length > this.MAX_SAMPLES) {
      console.log(`⚠️ [CALIBRATION] Достигнут максимум образцов (${this.MAX_SAMPLES}), удаляем старые`);
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
    console.log('\n=== 📤 SUBMIT CALIBRATION ===');
    console.log('Samples count:', this.calibrationSamples.length);
    console.log('Speed:', speed, 'km/h');
    console.log('Road type:', roadType);

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

      console.log('📦 [CALIBRATION] Payload размер:', JSON.stringify(payload).length, 'bytes');
      console.log('🌐 [CALIBRATION] Отправка на:', this.backendUrl + 'api/calibration/submit');

      const response = await fetch(this.backendUrl + 'api/calibration/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log('📡 [CALIBRATION] Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ [CALIBRATION] Server error:', errorText);
        throw new Error(`Server responded with ${response.status}`);
      }

      const result: CalibrationProfile = await response.json();
      
      console.log('✅ [CALIBRATION] Профиль получен от сервера:');
      console.log('   Baseline: x=' + result.baseline.x.toFixed(3) + ', y=' + result.baseline.y.toFixed(3) + ', z=' + result.baseline.z.toFixed(3));
      console.log('   Std Dev: x=' + result.std_dev.x.toFixed(3) + ', y=' + result.std_dev.y.toFixed(3) + ', z=' + result.std_dev.z.toFixed(3));
      console.log('   Total deviation threshold:', result.thresholds.total_deviation.toFixed(3));
      console.log('   Sample count:', result.sample_count);
      console.log('   Update type:', (result as any).update_type);

      // Сохраняем профиль
      this.calibrationProfile = result;
      await AsyncStorage.setItem(this.CALIBRATION_PROFILE_KEY, JSON.stringify(result));
      
      console.log('💾 [CALIBRATION] Профиль сохранен в AsyncStorage');

      // Очищаем образцы после успешной отправки
      this.calibrationSamples = [];
      this.isCalibrating = false;

      console.log('============================\n');
      return result;

    } catch (error) {
      console.error('❌ [CALIBRATION] Ошибка отправки:', error);
      console.error('Stack trace:', (error as Error).stack);
      console.log('============================\n');
      return null;
    }
  }

  // Загрузить профиль калибровки с сервера
  async loadProfile(): Promise<CalibrationProfile | null> {
    console.log('\n=== 📥 LOAD CALIBRATION PROFILE ===');
    console.log('Device ID:', this.deviceId);

    try {
      // Сначала пробуем загрузить с сервера
      console.log('🌐 [CALIBRATION] Запрос профиля с сервера...');
      const response = await fetch(
        this.backendUrl + `api/calibration/profile/${this.deviceId}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      console.log('📡 [CALIBRATION] Response status:', response.status);

      if (response.ok) {
        const profile: CalibrationProfile = await response.json();
        
        if (profile.has_profile) {
          console.log('✅ [CALIBRATION] Профиль найден на сервере');
          console.log('   Sample count:', profile.sample_count);
          console.log('   Last updated:', profile.last_updated);
          console.log('   Total deviation:', profile.thresholds.total_deviation.toFixed(3));
          
          this.calibrationProfile = profile;
          await AsyncStorage.setItem(this.CALIBRATION_PROFILE_KEY, JSON.stringify(profile));
          console.log('💾 [CALIBRATION] Профиль сохранен в кэш');
        } else {
          console.log('⚠️ [CALIBRATION] Профиль не найден на сервере, используем defaults');
          console.log('   Default thresholds:', profile.default_thresholds);
        }
        
        console.log('==================================\n');
        return profile;
      } else {
        console.warn('⚠️ [CALIBRATION] Сервер недоступен, пробуем кэш...');
        
        // Пробуем загрузить из кэша
        const cached = await AsyncStorage.getItem(this.CALIBRATION_PROFILE_KEY);
        if (cached) {
          const profile = JSON.parse(cached);
          console.log('📦 [CALIBRATION] Профиль загружен из кэша');
          console.log('   Last updated:', profile.last_updated);
          this.calibrationProfile = profile;
          console.log('==================================\n');
          return profile;
        }
        
        console.log('❌ [CALIBRATION] Профиль не найден ни на сервере, ни в кэше');
        console.log('==================================\n');
        return null;
      }
    } catch (error) {
      console.error('❌ [CALIBRATION] Ошибка загрузки профиля:', error);
      console.log('==================================\n');
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
      console.log('🚨 [ANOMALY DETECTED]');
      console.log('   Current: x=' + x.toFixed(2) + ', y=' + y.toFixed(2) + ', z=' + z.toFixed(2));
      console.log('   Baseline: x=' + baseline.x.toFixed(2) + ', y=' + baseline.y.toFixed(2) + ', z=' + baseline.z.toFixed(2));
      console.log('   Deviation:', totalDeviation.toFixed(3), '> threshold:', thresholds.total_deviation.toFixed(3));
    }

    return isAnomaly;
  }

  // Сбросить профиль калибровки
  async resetProfile(): Promise<void> {
    console.log('\n=== 🔄 RESET CALIBRATION PROFILE ===');
    
    try {
      // Удаляем с сервера
      const response = await fetch(
        this.backendUrl + `api/calibration/profile/${this.deviceId}`,
        {
          method: 'DELETE',
        }
      );

      if (response.ok) {
        console.log('✅ [CALIBRATION] Профиль удален с сервера');
      }
    } catch (error) {
      console.warn('⚠️ [CALIBRATION] Не удалось удалить профиль с сервера:', error);
    }

    // Удаляем из кэша
    await AsyncStorage.removeItem(this.CALIBRATION_PROFILE_KEY);
    this.calibrationProfile = null;
    this.calibrationSamples = [];
    
    console.log('✅ [CALIBRATION] Профиль сброшен локально');
    console.log('===================================\n');
  }
}

export const calibrationService = new CalibrationService();
export type { CalibrationProfile, AccelerometerSample };
