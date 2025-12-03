/**
 * RawDataCollector.ts
 * 
 * Новый сервис для избыточного сбора данных
 * Отправляет ВСЕ сырые данные GPS + акселерометр на сервер
 * Сервер анализирует и возвращает предупреждения
 */

import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

export interface RawSensorDataPoint {
  deviceId: string;
  timestamp: number;
  gps: {
    latitude: number;
    longitude: number;
    speed: number;
    accuracy: number;
    altitude?: number;
  };
  // 🆕 Массив высокочастотных данных акселерометра (10 Hz, ~50 значений за 5 сек)
  accelerometer: Array<{
    x: number;
    y: number;
    z: number;
    timestamp: number;
  }>;
}

export interface RawDataBatch {
  deviceId: string;
  data: RawSensorDataPoint[];
}

export interface Warning {
  id: string;
  deviceId: string;
  eventType: string;
  severity: number;
  latitude: number;
  longitude: number;
  distance: number;
  message: string;
  expiresAt: string;
  created_at: string;
}

export interface RawDataResponse {
  message: string;
  rawDataSaved: number;
  eventsDetected: number;
  warningsGenerated: number;
  warnings: Warning[];
}

class RawDataCollector {
  private deviceId: string;
  private backendUrl: string;
  private dataBuffer: RawSensorDataPoint[] = [];
  private isOnline: boolean = false;
  
  // Настройки
  private readonly BATCH_SIZE = 1; // Отправлять каждую точку немедленно (для production)
  private readonly MAX_BUFFER_SIZE = 50; // Максимум в буфере
  private readonly OFFLINE_STORAGE_KEY = 'raw_data_offline_queue';
  
  // Динамическая частота сбора в зависимости от скорости
  private readonly SPEED_INTERVALS = {
    STATIONARY: 5000,    // 0-10 км/ч - каждые 5 секунд
    SLOW: 3000,          // 10-30 км/ч - каждые 3 секунды
    MEDIUM: 2000,        // 30-60 км/ч - каждые 2 секунды
    FAST: 1000,          // 60-90 км/ч - каждую 1 секунду
    VERY_FAST: 500,      // 90+ км/ч - каждые 0.5 секунды
  };
  
  // Колбэки
  private onWarningsReceived?: (warnings: Warning[]) => void;
  
  constructor(
    deviceId: string,
    backendUrl: string,
    onWarningsReceived?: (warnings: Warning[]) => void
  ) {
    this.deviceId = deviceId;
    this.backendUrl = backendUrl;
    this.onWarningsReceived = onWarningsReceived;
    
    console.log('✅ RawDataCollector инициализирован');
    console.log(`   Device ID: ${this.deviceId}`);
    console.log(`   Backend URL: ${this.backendUrl}`);
  }
  
  /**
   * Добавить точку данных с массивом высокочастотных данных акселерометра
   */
  public async addDataPoint(
    location: Location.LocationObject,
    accelerometerBuffer: Array<{ x: number; y: number; z: number; timestamp: number }>,
    customTimestamp?: number // 🆕 Опциональный параметр для точного timestamp
  ): Promise<void> {
    console.log(`📊 Добавление точки с ${accelerometerBuffer.length} значениями акселерометра`);
    
    const dataPoint: RawSensorDataPoint = {
      deviceId: this.deviceId,
      timestamp: customTimestamp || Date.now(), // 🆕 Используем переданный timestamp если есть
      gps: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        speed: location.coords.speed || 0,
        accuracy: location.coords.accuracy || 0,
        altitude: location.coords.altitude || undefined,
      },
      // 🆕 Передаем весь массив накопленных данных
      accelerometer: accelerometerBuffer,
    };
    
    this.dataBuffer.push(dataPoint);
    
    // Ограничиваем размер буфера
    if (this.dataBuffer.length > this.MAX_BUFFER_SIZE) {
      this.dataBuffer.shift();
    }
    
    // Отправляем если накопилось достаточно
    if (this.dataBuffer.length >= this.BATCH_SIZE) {
      await this.sendBatch();
    }
  }
  
  /**
   * Отправить батч данных на сервер
   */
  private async sendBatch(): Promise<void> {
    if (this.dataBuffer.length === 0) {
      return;
    }
    
    const batch: RawDataBatch = {
      deviceId: this.deviceId,
      data: [...this.dataBuffer],
    };
    
    try {
      console.log(`📤 Отправка батча: ${batch.data.length} точек`);
      
      const response = await fetch(`${this.backendUrl}/api/raw-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result: RawDataResponse = await response.json();
      
      console.log(`✅ Батч отправлен успешно:`);
      console.log(`   Сохранено: ${result.rawDataSaved} точек`);
      console.log(`   Обнаружено событий: ${result.eventsDetected}`);
      console.log(`   Предупреждений: ${result.warningsGenerated}`);
      
      // Очищаем буфер после успешной отправки
      this.dataBuffer = [];
      
      // Обрабатываем предупреждения
      if (result.warnings && result.warnings.length > 0) {
        console.log(`⚠️  Получены предупреждения: ${result.warnings.length}`);
        result.warnings.forEach(w => {
          console.log(`   - ${w.message}`);
        });
        
        if (this.onWarningsReceived) {
          this.onWarningsReceived(result.warnings);
        }
      }
      
      this.isOnline = true;
      
    } catch (error) {
      console.error('❌ Ошибка отправки батча:', error);
      this.isOnline = false;
      
      // Сохраняем в offline очередь
      await this.saveToOfflineQueue(batch);
    }
  }
  
  /**
   * Принудительная отправка всех данных
   */
  public async forceSend(): Promise<void> {
    console.log('🔄 Принудительная отправка данных...');
    
    // Отправляем текущий буфер
    if (this.dataBuffer.length > 0) {
      await this.sendBatch();
    }
    
    // Отправляем offline очередь
    await this.processOfflineQueue();
  }
  
  /**
   * Сохранить батч в offline очередь
   */
  private async saveToOfflineQueue(batch: RawDataBatch): Promise<void> {
    try {
      const queueJson = await AsyncStorage.getItem(this.OFFLINE_STORAGE_KEY);
      const queue: RawDataBatch[] = queueJson ? JSON.parse(queueJson) : [];
      
      queue.push(batch);
      
      // Ограничиваем размер очереди (последние 10 батчей)
      if (queue.length > 10) {
        queue.shift();
      }
      
      await AsyncStorage.setItem(this.OFFLINE_STORAGE_KEY, JSON.stringify(queue));
      console.log(`💾 Батч сохранен в offline очередь (всего: ${queue.length})`);
      
    } catch (error) {
      console.error('❌ Ошибка сохранения в offline очередь:', error);
    }
  }
  
  /**
   * Обработать offline очередь
   */
  private async processOfflineQueue(): Promise<void> {
    try {
      const queueJson = await AsyncStorage.getItem(this.OFFLINE_STORAGE_KEY);
      if (!queueJson) {
        return;
      }
      
      const queue: RawDataBatch[] = JSON.parse(queueJson);
      
      if (queue.length === 0) {
        return;
      }
      
      console.log(`📦 Обработка offline очереди: ${queue.length} батчей`);
      
      for (const batch of queue) {
        try {
          const response = await fetch(`${this.backendUrl}/api/raw-data`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(batch),
          });
          
          if (response.ok) {
            console.log(`✅ Offline батч отправлен (${batch.data.length} точек)`);
          }
          
        } catch (error) {
          console.error('❌ Ошибка отправки offline батча:', error);
          // Прерываем обработку если нет соединения
          break;
        }
      }
      
      // Очищаем очередь после успешной отправки
      await AsyncStorage.removeItem(this.OFFLINE_STORAGE_KEY);
      console.log('✅ Offline очередь очищена');
      
    } catch (error) {
      console.error('❌ Ошибка обработки offline очереди:', error);
    }
  }
  
  /**
   * Получить активные предупреждения
   */
  public async getActiveWarnings(): Promise<Warning[]> {
    try {
      const response = await fetch(`${this.backendUrl}/api/warnings/${this.deviceId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      return result.warnings || [];
      
    } catch (error) {
      console.error('❌ Ошибка получения предупреждений:', error);
      return [];
    }
  }
  
  /**
   * Отклонить предупреждение
   */
  public async dismissWarning(warningId: string): Promise<void> {
    try {
      const response = await fetch(`${this.backendUrl}/api/warnings/${warningId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        console.log(`✅ Предупреждение отклонено: ${warningId}`);
      }
      
    } catch (error) {
      console.error('❌ Ошибка отклонения предупреждения:', error);
    }
  }
  
  /**
   * Вычислить интервал сбора данных на основе скорости
   */
  public getCollectionInterval(speed: number): number {
    if (speed < 10) {
      return this.SPEED_INTERVALS.STATIONARY;
    } else if (speed < 30) {
      return this.SPEED_INTERVALS.SLOW;
    } else if (speed < 60) {
      return this.SPEED_INTERVALS.MEDIUM;
    } else if (speed < 90) {
      return this.SPEED_INTERVALS.FAST;
    } else {
      return this.SPEED_INTERVALS.VERY_FAST;
    }
  }
  
  /**
   * Получить статистику
   */
  public getStats() {
    return {
      bufferSize: this.dataBuffer.length,
      isOnline: this.isOnline,
    };
  }
  
  /**
   * Очистить буфер
   */
  public clearBuffer(): void {
    this.dataBuffer = [];
    console.log('🗑️  Буфер данных очищен');
  }
}

export default RawDataCollector;
