import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Application from 'expo-application';

interface LogEntry {
  device_id: string;
  app_version: string;
  platform: string;
  timestamp: number;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  stack_trace?: string;
  context?: Record<string, any>;
}

const MAX_QUEUE = 100;
const FLUSH_INTERVAL = 30000;
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://goodroad.su';

class ClientLogService {
  private queue: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private deviceId: string | null = null;
  private isInitialized = false;

  async init() {
    if (this.isInitialized) return;
    
    this.deviceId = await this.getDeviceId();
    this.loadQueue();
    this.startFlushTimer();
    this.isInitialized = true;
    
    this.info('ClientLogService initialized');
  }

  private async getDeviceId(): Promise<string> {
    try {
      const stored = await AsyncStorage.getItem('client_log_device_id');
      if (stored) return stored;
      
      const id = `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await AsyncStorage.setItem('client_log_device_id', id);
      return id;
    } catch {
      return `device-${Date.now()}`;
    }
  }

  private loadQueue() {
    try {
      const stored = AsyncStorage.getItem('client_log_queue');
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch {
      this.queue = [];
    }
  }

  private saveQueue() {
    try {
      AsyncStorage.setItem('client_log_queue', JSON.stringify(this.queue.slice(-MAX_QUEUE)));
    } catch {
      // ignore storage errors
    }
  }

  private startFlushTimer() {
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL);
  }

  async flush() {
    if (this.queue.length === 0) return;
    
    const toSend = this.queue.splice(0, 50);
    this.saveQueue();

    try {
      await fetch(`${BACKEND_URL}/api/client-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSend),
      });
    } catch (e) {
      // Re-queue on failure
      this.queue.unshift(...toSend);
      this.saveQueue();
    }
  }

  log(level: LogEntry['level'], message: string, context?: Record<string, any>) {
    const entry: LogEntry = {
      device_id: this.deviceId || 'unknown',
      app_version: Constants.expoConfig?.version || '2.0.1',
      platform: Platform.OS,
      timestamp: Date.now(),
      level,
      message,
      context,
    };
    
    this.queue.push(entry);
    if (this.queue.length > MAX_QUEUE) {
      this.queue.shift();
    }
    this.saveQueue();
  }

  error(message: string, error?: Error, context?: Record<string, any>) {
    this.log('error', message, {
      ...context,
      stack: error?.stack,
      name: error?.name,
      message: error?.message,
    });
  }

  warn(message: string, context?: Record<string, any>) {
    this.log('warn', message, context);
  }

  info(message: string, context?: Record<string, any>) {
    this.log('info', message, context);
  }

  debug(message: string, context?: Record<string, any>) {
    this.log('debug', message, context);
  }

  async getLogs(limit = 100): Promise<LogEntry[]> {
    return this.queue.slice(-limit);
  }

  async clear() {
    this.queue = [];
    this.saveQueue();
  }

  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}

export const clientLogService = new ClientLogService();
export default clientLogService;