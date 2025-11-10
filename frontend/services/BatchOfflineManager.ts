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
      
      // Проверить состояние сети
      await this.checkNetworkStatus();
      
      // Подписаться на изменения сети
      this.startNetworkMonitoring();
      
      console.log('✅ BatchOfflineManager инициализирован');
      console.log(`📦 Offline очередь: ${this.offlineQueue.length} записей`);
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
        console.log(`📥 Загружено ${this.offlineQueue.length} записей из offline хранилища`);
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
   * Проверить статус сети
   */
  private async checkNetworkStatus() {
    try {
      const networkState = await Network.getNetworkStateAsync();
      this.isOnline = networkState.isConnected === true && networkState.isInternetReachable === true;
      console.log(`📡 Статус сети: ${this.isOnline ? 'Online' : 'Offline'}`);
      
      // Если онлайн и есть данные в очереди - отправить
      if (this.isOnline && this.offlineQueue.length > 0) {
        console.log('🔄 Сеть восстановлена, запуск синхронизации...');
        this.processOfflineQueue();
      }
    } catch (error) {
      console.error('❌ Ошибка проверки сети:', error);
      this.isOnline = false;
    }
  }
  
  /**
   * Мониторинг состояния сети
   */
  private startNetworkMonitoring() {
    // Проверка каждые 30 секунд
    setInterval(() => {
      this.checkNetworkStatus();
    }, 30000);
  }
  
  /**
   * Добавить событие в batch
   */
  addEvent(event: DetectedEvent, currentLocation: any, currentSpeed: number, gpsAccuracy: number) {
    this.batch.push(event);
    this.stats.totalEvents++;
    this.stats.pendingEvents = this.batch.length;
    
    console.log(`📦 Событие добавлено в batch: ${event.eventType} (severity ${event.severity})`);
    console.log(`📊 Batch размер: ${this.batch.length}/${BATCH_SIZE}`);
    
    // Немедленная отправка для критичных событий
    if (event.shouldSendImmediately) {
      console.log('🚨 Критичное событие - немедленная отправка!');
      this.sendBatch(currentLocation, currentSpeed, gpsAccuracy, 'critical');
      return;
    }
    
    // Отправка при достижении BATCH_SIZE
    if (this.batch.length >= BATCH_SIZE) {
      console.log(`✅ Batch заполнен (${BATCH_SIZE} событий) - отправка`);
      this.sendBatch(currentLocation, currentSpeed, gpsAccuracy, 'normal');
      return;
    }
    
    // Запуск таймера для отправки через BATCH_TIMEOUT_MS
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        if (this.batch.length > 0) {
          console.log(`⏰ Таймаут batch (${BATCH_TIMEOUT_MS/1000} сек) - отправка ${this.batch.length} событий`);
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
      console.log('⚠️ Batch пустой, отправка не требуется');
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
      console.log('📴 Нет сети - сохранение в offline очередь');
      this.addToOfflineQueue(dataPackage);
    }
  }
  
  /**
   * Отправить package на сервер
   */
  private async sendPackage(dataPackage: DataPackage): Promise<boolean> {
    try {
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 
                        Constants.expoConfig?.extra?.backendUrl || 
                        'https://roadquality.emergent.host';
      const apiUrl = backendUrl.endsWith('/') ? backendUrl + 'api/sensor-data' : backendUrl + '/api/sensor-data';
      
      // Подготовка payload с compression (минификация)
      const payload = {
        deviceId: dataPackage.deviceId,
        sensorData: dataPackage.events.map(event => ({
          type: 'event',
          eventType: event.eventType,
          severity: event.severity,
          roadType: event.roadType,
          timestamp: event.timestamp,
          location: dataPackage.location,
          accelerometer: {
            x: event.accelerometer.x,
            y: event.accelerometer.y,
            z: event.accelerometer.z,
            magnitude: event.accelerometer.magnitude,
            deltaY: event.accelerometer.deltaY,
            deltaZ: event.accelerometer.deltaZ,
          }
        }))
      };
      
      console.log(`📡 Отправка package ${dataPackage.id}:`);
      console.log(`   События: ${dataPackage.events.length}`);
      console.log(`   Приоритет: ${dataPackage.priority}`);
      console.log(`   URL: ${apiUrl}`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 10000,
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`✅ Package ${dataPackage.id} отправлен успешно!`, result);
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
        console.log(`🔄 Retry ${dataPackage.retryCount}/3 - добавление в offline очередь`);
        this.addToOfflineQueue(dataPackage);
      } else {
        console.log(`❌ Превышен лимит retry для package ${dataPackage.id} - отброшен`);
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
      console.log(`⚠️ Offline очередь переполнена, очищены старые записи`);
    }
    
    this.offlineQueue.push(dataPackage);
    this.saveOfflineQueue();
    
    console.log(`💾 Package ${dataPackage.id} сохранён в offline очередь`);
    console.log(`📊 Размер offline очереди: ${this.offlineQueue.length}/${MAX_OFFLINE_RECORDS}`);
  }
  
  /**
   * Обработать offline очередь (retry)
   */
  private async processOfflineQueue() {
    if (this.isSending || this.offlineQueue.length === 0 || !this.isOnline) {
      return;
    }
    
    this.isSending = true;
    console.log(`🔄 Обработка offline очереди: ${this.offlineQueue.length} записей`);
    
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
    
    console.log(`✅ Offline синхронизация завершена:`);
    console.log(`   Успешно: ${successfulIds.length}`);
    console.log(`   Осталось: ${this.offlineQueue.length}`);
    
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
    console.log('🔄 Принудительная синхронизация...');
    
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
    console.log('🧹 BatchOfflineManager очищен');
  }
}

// Singleton экземпляр
export const batchOfflineManager = new BatchOfflineManager();

export default BatchOfflineManager;
