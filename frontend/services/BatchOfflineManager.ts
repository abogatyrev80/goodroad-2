/**
 * BatchOfflineManager.ts
 * 
 * Управление накоплением, хранением и отправкой данных
 * - Batch накопление событий (до 10 событий или 60 сек)
 * - Offline хранилище в AsyncStorage (лимит 1000 записей)
 * - Auto-retry при восстановлении связи
 * - Compression данных
 * - Приоритетная отправка критичных событий
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import Constants from 'expo-constants';
import { DetectedEvent } from './EventDetector';
import { backendConfigService } from './BackendConfigService';

const STORAGE_KEY = 'good_road_offline_queue';
const MAX_OFFLINE_RECORDS = 1000;
const BATCH_SIZE = 10;
const BATCH_TIMEOUT_MS = 60000; // 60 секунд

// Web compatibility flag
const IS_WEB = Platform.OS === 'web';

export interface DataPackage {
  id: string;
  deviceId: string;
  events: DetectedEvent[];
  location: {
    latitude: number;
    longitude: number;
    speed: number;
    accuracy: number;
  };
  timestamp: number;
  priority: 'critical' | 'high' | 'normal'; // Приоритет отправки
  retryCount: number; // Количество попыток отправки
}

export interface BatchStats {
  totalEvents: number;
  pendingEvents: number;
  offlineQueueSize: number;
  successfulSends: number;
  failedSends: number;
  lastSyncTime: number | null;
}

class BatchOfflineManager {
  private batch: DetectedEvent[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private offlineQueue: DataPackage[] = [];
  private isOnline: boolean = true;
  private isSending: boolean = false;
  
  // Статистика
  private stats: BatchStats = {
    totalEvents: 0,
    pendingEvents: 0,
    offlineQueueSize: 0,
    successfulSends: 0,
    failedSends: 0,
    lastSyncTime: null,
  };
  
  // Callback для обновления UI
  private onStatsUpdate?: (stats: BatchStats) => void;
  
  constructor() {
    this.initialize();
  }
  
  /**
   * Инициализация менеджера
   */
  private async initialize() {
    try {
      // Загрузить offline очередь из AsyncStorage
      await this.loadOfflineQueue();
      
      // 🔧 MIGRATION: Очистить старые данные с неправильным форматом (2025-01-19)
      // После исправления формата сообщений нужно очистить offline очередь
      if (this.offlineQueue.length > 0 && !IS_WEB) {
        this.offlineQueue = [];
        await AsyncStorage.removeItem(STORAGE_KEY);
        this.stats.offlineQueueSize = 0;
        this.stats.failedSends = 0;
        this.updateStats();
      }
      
      await this.checkNetworkStatus();
      this.setupNetworkListener(); // Мгновенная отправка при появлении сети
      this.startNetworkMonitoring();
      
    } catch (error) {
      console.error('❌ Ошибка инициализации BatchOfflineManager:', error);
    }
  }
  
  /**
   * Загрузить offline очередь из хранилища
   */
  private async loadOfflineQueue() {
    // Skip on web to avoid AsyncStorage issues
    if (IS_WEB) {
      this.offlineQueue = [];
      return;
    }
    
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.offlineQueue = JSON.parse(stored);
        this.stats.offlineQueueSize = this.offlineQueue.length;
      }
    } catch (error) {
      console.error('❌ Ошибка загрузки offline очереди:', error);
      this.offlineQueue = [];
    }
  }
  
  /**
   * Сохранить offline очередь в хранилище
   */
  private async saveOfflineQueue() {
    // Skip on web
    if (IS_WEB) {
      return;
    }
    
    try {
      // Ограничение: максимум MAX_OFFLINE_RECORDS записей
      const queueToSave = this.offlineQueue.slice(-MAX_OFFLINE_RECORDS);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queueToSave));
      this.stats.offlineQueueSize = queueToSave.length;
      this.updateStats();
    } catch (error) {
      console.error('❌ Ошибка сохранения offline очереди:', error);
    }
  }
  
  /**
   * Проверить статус сети.
   * isInternetReachable может быть undefined на части устройств — считаем это "попробовать отправить".
   */
  private async checkNetworkStatus() {
    try {
      const networkState = await Network.getNetworkStateAsync();
      const connected = networkState.isConnected === true;
      const reachable = networkState.isInternetReachable !== false; // undefined = не проверяли, считаем ок
      this.isOnline = connected && reachable;
      if (this.isOnline && this.offlineQueue.length > 0) {
        this.processOfflineQueue();
      }
    } catch (error) {
      console.error('❌ Ошибка проверки сети:', error);
      this.isOnline = false;
    }
  }

  /**
   * Подписка на восстановление сети — сразу отправляем очередь (важно на трассах без интернета)
   */
  private setupNetworkListener() {
    if (IS_WEB) return;
    try {
      Network.addNetworkStateListener((state) => {
        const connected = state.isConnected === true;
        const reachable = state.isInternetReachable !== false;
        const nowOnline = connected && reachable;
        if (nowOnline && !this.isOnline && this.offlineQueue.length > 0) {
          this.isOnline = true;
          this.processOfflineQueue();
        } else {
          this.isOnline = nowOnline;
        }
      });
    } catch (e) {
      console.warn('BatchOfflineManager: addNetworkStateListener недоступен', e);
    }
  }
  
  /**
   * Мониторинг состояния сети (периодическая проверка раз в 30 сек)
   */
  private startNetworkMonitoring() {
    setInterval(() => this.checkNetworkStatus(), 30000);
  }
  
  /**
   * Добавить событие в batch
   */
  addEvent(event: DetectedEvent, currentLocation: any, currentSpeed: number, gpsAccuracy: number) {
    this.batch.push(event);
    this.stats.totalEvents++;
    this.stats.pendingEvents = this.batch.length;
    
    
    // Немедленная отправка для критичных событий
    if (event.shouldSendImmediately) {
      this.sendBatch(currentLocation, currentSpeed, gpsAccuracy, 'critical');
      return;
    }
    
    // Отправка при достижении BATCH_SIZE
    if (this.batch.length >= BATCH_SIZE) {
      this.sendBatch(currentLocation, currentSpeed, gpsAccuracy, 'normal');
      return;
    }
    
    // Запуск таймера для отправки через BATCH_TIMEOUT_MS
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        if (this.batch.length > 0) {
          this.sendBatch(currentLocation, currentSpeed, gpsAccuracy, 'normal');
        }
      }, BATCH_TIMEOUT_MS);
    }
    
    this.updateStats();
  }
  
  /**
   * Отправить batch на сервер
   */
  private async sendBatch(
    currentLocation: any, 
    currentSpeed: number, 
    gpsAccuracy: number,
    priority: 'critical' | 'high' | 'normal' = 'normal'
  ) {
    if (this.batch.length === 0) {
      return;
    }
    
    // Очистить таймер
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    // Создать package для отправки
    const dataPackage: DataPackage = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      deviceId: Constants.deviceId || `mobile-app-${Date.now()}`,
      events: [...this.batch], // Копия событий
      location: currentLocation ? {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        speed: currentSpeed,
        accuracy: gpsAccuracy,
      } : {
        latitude: 0,
        longitude: 0,
        speed: 0,
        accuracy: 0,
      },
      timestamp: Date.now(),
      priority,
      retryCount: 0,
    };
    
    // Очистить batch
    this.batch = [];
    this.stats.pendingEvents = 0;
    this.updateStats();
    
    // Попытка отправки
    if (this.isOnline) {
      await this.sendPackage(dataPackage);
    } else {
      // Сохранить в offline очередь
      this.addToOfflineQueue(dataPackage);
    }
  }
  
  /**
   * Отправить package на сервер
   */
  private async sendPackage(dataPackage: DataPackage): Promise<boolean> {
    try {
      const backendUrl = backendConfigService.getActiveUrl();
      const apiUrl = backendUrl.endsWith('/') ? backendUrl + 'api/sensor-data' : backendUrl + '/api/sensor-data';
      
      // Подготовка payload в правильном формате для backend
      const payload = {
        deviceId: dataPackage.deviceId,
        sensorData: dataPackage.events.map(event => ({
          type: 'event',
          timestamp: event.timestamp,
          data: {
            eventType: event.eventType,
            severity: event.severity,
            roadType: event.roadType,
            speed: event.speed || 0, // НОВОЕ: скорость для ML
            location: dataPackage.location,
            accelerometer: {
              x: event.accelerometer.x,
              y: event.accelerometer.y,
              z: event.accelerometer.z,
              magnitude: event.accelerometer.magnitude,
              deltaX: event.accelerometer.deltaX, // НОВОЕ
              deltaY: event.accelerometer.deltaY,
              deltaZ: event.accelerometer.deltaZ,
              variance: event.accelerometer.variance, // НОВОЕ: variance для ML
            }
          }
        }))
      };
      
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 10000,
      });
      
      if (response.ok) {
        const result = await response.json();
        this.stats.successfulSends++;
        this.stats.lastSyncTime = Date.now();
        this.updateStats();
        return true;
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error: any) {
      console.error(`❌ Ошибка отправки package ${dataPackage.id}:`, error.message);
      this.stats.failedSends++;
      
      // Добавить в offline очередь для retry
      dataPackage.retryCount++;
      if (dataPackage.retryCount <= 3) { // Максимум 3 попытки
        this.addToOfflineQueue(dataPackage);
      } else {
      }
      
      this.updateStats();
      return false;
    }
  }
  
  /**
   * Добавить в offline очередь
   */
  private addToOfflineQueue(dataPackage: DataPackage) {
    // Проверка лимита
    if (this.offlineQueue.length >= MAX_OFFLINE_RECORDS) {
      // Удалить самые старые записи с низким приоритетом
      this.offlineQueue = this.offlineQueue
        .filter(pkg => pkg.priority === 'critical')
        .concat(
          this.offlineQueue
            .filter(pkg => pkg.priority !== 'critical')
            .slice(-MAX_OFFLINE_RECORDS + 100)
        );
    }
    
    this.offlineQueue.push(dataPackage);
    this.saveOfflineQueue();
    
  }
  
  /**
   * Обработать offline очередь (retry)
   */
  private async processOfflineQueue() {
    if (this.isSending || this.offlineQueue.length === 0 || !this.isOnline) {
      return;
    }
    
    this.isSending = true;
    
    // Сортировка по приоритету (критичные первыми)
    const sortedQueue = [...this.offlineQueue].sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    const successfulIds: string[] = [];
    
    // Отправка по одному с задержкой
    for (const dataPackage of sortedQueue) {
      const success = await this.sendPackage(dataPackage);
      if (success) {
        successfulIds.push(dataPackage.id);
      }
      
      // Задержка между отправками (чтобы не перегрузить сервер)
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Удалить успешно отправленные из очереди
    this.offlineQueue = this.offlineQueue.filter(
      pkg => !successfulIds.includes(pkg.id)
    );
    
    await this.saveOfflineQueue();
    
    
    this.isSending = false;
  }
  
  /**
   * Получить статистику
   */
  getStats(): BatchStats {
    return { ...this.stats };
  }
  
  /**
   * Установить callback для обновления статистики
   */
  setStatsCallback(callback: (stats: BatchStats) => void) {
    this.onStatsUpdate = callback;
  }
  
  /**
   * Обновить статистику и вызвать callback
   */
  private updateStats() {
    if (this.onStatsUpdate) {
      this.onStatsUpdate(this.getStats());
    }
  }
  
  /**
   * Принудительная синхронизация
   */
  async forceSyncNow(currentLocation: any, currentSpeed: number, gpsAccuracy: number) {
    
    // Если batch пустой, создать тестовое событие для подтверждения связи
    if (this.batch.length === 0 && currentLocation) {
      
      // Создать тестовое событие с текущими GPS координатами
      const testEvent: DetectedEvent = {
        timestamp: Date.now(),
        eventType: 'test_sync',
        severity: 5, // Минимальная важность
        location: {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          speed: currentSpeed,
          accuracy: gpsAccuracy,
        },
        accelerometer: {
          x: 0,
          y: 0,
          z: 9.8,
          magnitude: 9.8,
          deltaY: 0,
          deltaZ: 0,
        },
        roadType: 'unknown',
        shouldNotifyUser: false,
      };
      
      this.batch.push(testEvent);
    }
    
    // Отправить текущий batch
    if (this.batch.length > 0) {
      await this.sendBatch(currentLocation, currentSpeed, gpsAccuracy, 'high');
    }
    
    // Обработать offline очередь
    await this.processOfflineQueue();
  }
  
  /**
   * Очистить всё (для тестирования)
   */
  async clearAll() {
    this.batch = [];
    this.offlineQueue = [];
    
    // Skip AsyncStorage on web
    if (!IS_WEB) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
    
    this.stats = {
      totalEvents: 0,
      pendingEvents: 0,
      offlineQueueSize: 0,
      successfulSends: 0,
      failedSends: 0,
      lastSyncTime: null,
    };
    this.updateStats();
  }
}

// Singleton экземпляр
export const batchOfflineManager = new BatchOfflineManager();

export default BatchOfflineManager;
