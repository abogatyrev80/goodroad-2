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
  nextRetryAt?: number; // Экспоненциальный backoff: не раньше этого времени
}

// Retry policy: exponential backoff with jitter (server may answer 429/5xx)
const MAX_RETRY_COUNT = 6;
const BACKOFF_BASE_MS = 2000;   // 2s, 4s, 8s, 16s, 32s, 64s...
const BACKOFF_MAX_MS = 120000;  // cap at 2 minutes

/** Exponential backoff delay for attempt n (1-based) with ±20% jitter. */
export function backoffDelayMs(retryCount: number): number {
  const exp = Math.min(BACKOFF_BASE_MS * 2 ** (retryCount - 1), BACKOFF_MAX_MS);
  const jitter = exp * 0.2 * (Math.random() * 2 - 1);
  return Math.round(exp + jitter);
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
        console.log('🧹 Обнаружена старая offline очередь, очистка...');
        this.offlineQueue = [];
        await AsyncStorage.removeItem(STORAGE_KEY);
        this.stats.offlineQueueSize = 0;
        this.stats.failedSends = 0;
        this.updateStats();
        console.log('✅ Offline очередь очищена после обновления формата');
      }
      
      await this.checkNetworkStatus();
      this.setupNetworkListener(); // Мгновенная отправка при появлении сети
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
   * Проверить статус сети.
   * isInternetReachable может быть undefined на части устройств — считаем это "попробовать отправить".
   */
  private async checkNetworkStatus() {
    try {
      const networkState = await Network.getNetworkStateAsync();
      const connected = networkState.isConnected === true;
      const reachable = networkState.isInternetReachable !== false; // undefined = не проверяли, считаем ок
      this.isOnline = connected && reachable;
      console.log(`📡 Статус сети: ${this.isOnline ? 'Online' : 'Offline'}`);
      if (this.isOnline && this.offlineQueue.length > 0) {
        console.log('🔄 Сеть доступна, запуск синхронизации офлайн-очереди...');
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
          console.log('📡 Сеть восстановлена — немедленная отправка офлайн-очереди');
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
                        'https://goodroad.su';
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
      
      console.log(`📡 Отправка package ${dataPackage.id}:`);
      console.log(`   События: ${dataPackage.events.length}`);
      console.log(`   Приоритет: ${dataPackage.priority}`);
      console.log(`   URL: ${apiUrl}`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Idempotency key: server replays the original response on retry,
          // so retried offline uploads never duplicate raw points/clusters.
          'X-Package-Id': dataPackage.id,
        },
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
      } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        // Client error (bad payload/validation): retrying is pointless - drop.
        console.error(`⛔ Package ${dataPackage.id}: HTTP ${response.status} - отброшен без retry`);
        this.stats.failedSends++;
        this.updateStats();
        return false;
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error: any) {
      console.error(`❌ Ошибка отправки package ${dataPackage.id}:`, error.message);
      this.stats.failedSends++;
      
      // Add to offline queue for retry with exponential backoff + jitter
      dataPackage.retryCount++;
      if (dataPackage.retryCount <= MAX_RETRY_COUNT) {
        dataPackage.nextRetryAt = Date.now() + backoffDelayMs(dataPackage.retryCount);
        console.log(`🔄 Retry ${dataPackage.retryCount}/${MAX_RETRY_COUNT} через ${Math.round((dataPackage.nextRetryAt - Date.now()) / 1000)}с`);
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
    const now = Date.now();
    
    // Отправка по одному с задержкой
    for (const dataPackage of sortedQueue) {
      // Respect exponential backoff: skip packages not yet due for retry
      if (dataPackage.nextRetryAt && dataPackage.nextRetryAt > now) {
        continue;
      }

      const success = await this.sendPackage(dataPackage);
      if (success) {
        successfulIds.push(dataPackage.id);
      } else if (!this.isOnline) {
        // Network went down mid-flush: stop hammering, keep queue intact
        break;
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
    
    // Если batch пустой, создать тестовое событие для подтверждения связи
    if (this.batch.length === 0 && currentLocation) {
      console.log('📍 Batch пустой, создаём тестовую точку для синхронизации...');
      
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
      console.log('✅ Тестовая точка добавлена в batch');
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
    console.log('🧹 BatchOfflineManager очищен');
  }
}

// Singleton экземпляр
export const batchOfflineManager = new BatchOfflineManager();

export default BatchOfflineManager;
