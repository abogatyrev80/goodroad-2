/**
 * RawDataCollector.ts
 * 
 * Новый сервис для избыточного сбора данных
 * Отправляет ВСЕ сырые данные GPS + акселерометр на сервер
 * Сервер анализирует и возвращает предупреждения
 * 
 * Офлайн: данные сохраняются в AsyncStorage и отправляются при появлении сети.
 */

import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import { Platform } from 'react-native';

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

const MAX_OFFLINE_BATCHES = 50; // Максимум батчей в офлайн-очереди (на трассах без сети)
const OFFLINE_STORAGE_KEY = 'raw_data_offline_queue';

class RawDataCollector {
  /** Текущий экземпляр (для экрана статистики) */
  static currentInstance: RawDataCollector | null = null;

  private deviceId: string;
  private backendUrl: string;
  private dataBuffer: RawSensorDataPoint[] = [];
  private isOnline: boolean = false;
  private networkUnsubscribe: (() => void) | null = null;
  private isProcessingQueue = false;

  // Настройки
  private readonly BATCH_SIZE = 1; // Отправлять каждую точку немедленно (для production)
  private readonly MAX_BUFFER_SIZE = 50; // Максимум в буфере
  private readonly OFFLINE_STORAGE_KEY = OFFLINE_STORAGE_KEY;
  
  // Динамическая частота сбора в зависимости от скорости
  // 🆕 УВЕЛИЧЕНО для анализа паттернов (нужно 40-50 точек акселерометра)
  // При частоте 10 Гц: 5 сек = ~50 точек
  private readonly SPEED_INTERVALS = {
    STATIONARY: 5000,    // 0-10 км/ч - каждые 5 секунд (~50 точек)
    SLOW: 5000,          // 10-30 км/ч - каждые 5 секунд (~50 точек) 
    MEDIUM: 5000,        // 30-60 км/ч - каждые 5 секунд (~50 точек)
    FAST: 5000,          // 60-90 км/ч - каждые 5 секунд (~50 точек)
    VERY_FAST: 5000,     // 90+ км/ч - каждые 5 секунд (~50 точек)
  };
  
  // Колбэки
  private onWarningsReceived?: (warnings: Warning[]) => void;
  
  constructor(
    deviceId: string,
    backendUrl: string,
    onWarningsReceived?: (warnings: Warning[]) => void
  ) {
    this.deviceId = deviceId;
    this.backendUrl = backendUrl.endsWith('/') ? backendUrl : backendUrl + '/';
    this.onWarningsReceived = onWarningsReceived;

    // Подписка на восстановление сети — сразу отправляем накопленные данные
    if (Platform.OS !== 'web') {
      const sub = Network.addNetworkStateListener((state) => {
        if (state.isConnected) {
          this.isOnline = true;
          this.processOfflineQueue();
        } else {
          this.isOnline = false;
        }
      });
      this.networkUnsubscribe = () => sub.remove();
    }

    RawDataCollector.currentInstance = this;
  }

  /** Количество батчей в офлайн-очереди (для экрана статистики) */
  static async getOfflineQueueLength(): Promise<number> {
    try {
      const json = await AsyncStorage.getItem(OFFLINE_STORAGE_KEY);
      if (!json) return 0;
      const queue: RawDataBatch[] = JSON.parse(json);
      return Array.isArray(queue) ? queue.length : 0;
    } catch {
      return 0;
    }
  }
  
  /**
   * Добавить точку данных с массивом высокочастотных данных акселерометра
   */
  public async addDataPoint(
    location: Location.LocationObject,
    accelerometerBuffer: Array<{ x: number; y: number; z: number; timestamp: number }>,
    customTimestamp?: number // 🆕 Опциональный параметр для точного timestamp
  ): Promise<void> {
    
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
   * Отправить батч данных на сервер.
   * Если сети нет — батч сохраняется в офлайн-очередь и отправится при появлении интернета.
   */
  private async sendBatch(): Promise<void> {
    if (this.dataBuffer.length === 0) {
      return;
    }

    const batch: RawDataBatch = {
      deviceId: this.deviceId,
      data: [...this.dataBuffer],
    };
    this.dataBuffer = []; // Освобождаем буфер сразу

    // Проверяем сеть до запроса — без сети сразу в очередь, не теряем данные
    try {
      const networkState = await Network.getNetworkStateAsync();
      if (!networkState.isConnected) {
        this.isOnline = false;
        await this.saveToOfflineQueue(batch);
        return;
      }
    } catch {
      this.isOnline = false;
      await this.saveToOfflineQueue(batch);
      return;
    }

    try {
      
      const response = await fetch(`${this.backendUrl}api/raw-data`, {
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
      
      
      // Обрабатываем предупреждения
      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach(w => {
        });
        
        if (this.onWarningsReceived) {
          this.onWarningsReceived(result.warnings);
        }
      }
      
      this.isOnline = true;
      
    } catch (error) {
      console.error('❌ Ошибка отправки батча:', error);
      this.isOnline = false;
      await this.saveToOfflineQueue(batch);
    }
  }
  
  /**
   * Принудительная отправка всех данных
   */
  public async forceSend(): Promise<void> {
    
    // Отправляем текущий буфер
    if (this.dataBuffer.length > 0) {
      await this.sendBatch();
    }
    
    // Отправляем offline очередь
    await this.processOfflineQueue();
  }
  
  /**
   * Сохранить батч в offline очередь (при отсутствии сети или ошибке отправки)
   */
  private async saveToOfflineQueue(batch: RawDataBatch): Promise<void> {
    try {
      const queueJson = await AsyncStorage.getItem(this.OFFLINE_STORAGE_KEY);
      const queue: RawDataBatch[] = queueJson ? JSON.parse(queueJson) : [];
      queue.push(batch);
      if (queue.length > MAX_OFFLINE_BATCHES) {
        queue.splice(0, queue.length - MAX_OFFLINE_BATCHES);
      }
      await AsyncStorage.setItem(this.OFFLINE_STORAGE_KEY, JSON.stringify(queue));
    } catch (error) {
      console.error('❌ Ошибка сохранения в офлайн-очередь:', error);
    }
  }
  
  /**
   * Обработать офлайн-очередь при появлении сети. Отправляет по одному батчу,
   * удаляет из очереди только успешно отправленные.
   */
  private async processOfflineQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    try {
      const queueJson = await AsyncStorage.getItem(this.OFFLINE_STORAGE_KEY);
      if (!queueJson) {
        this.isProcessingQueue = false;
        return;
      }
      let queue: RawDataBatch[] = JSON.parse(queueJson);
      if (queue.length === 0) {
        this.isProcessingQueue = false;
        return;
      }
      const stillPending: RawDataBatch[] = [];
      for (const batch of queue) {
        try {
          const networkState = await Network.getNetworkStateAsync();
          if (!networkState.isConnected) {
            stillPending.push(batch);
            continue;
          }
          const response = await fetch(`${this.backendUrl}api/raw-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch),
          });
          if (response.ok) {
            try {
              const result = await response.json();
              if (this.onWarningsReceived && result.warnings?.length) {
                this.onWarningsReceived(result.warnings);
              }
            } catch {}
          } else {
            stillPending.push(batch);
          }
        } catch (error) {
          console.error('❌ Ошибка отправки офлайн-батча:', error);
          stillPending.push(batch);
          break; // Сеть снова пропала — выходим, остальное отправим при следующем восстановлении
        }
      }
      if (stillPending.length === 0) {
        await AsyncStorage.removeItem(this.OFFLINE_STORAGE_KEY);
      } else {
        await AsyncStorage.setItem(this.OFFLINE_STORAGE_KEY, JSON.stringify(stillPending));
      }
    } catch (error) {
      console.error('❌ Ошибка обработки офлайн-очереди:', error);
    } finally {
      this.isProcessingQueue = false;
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
  }
}

export default RawDataCollector;
