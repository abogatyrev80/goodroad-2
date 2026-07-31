/**
 * AdaptiveCollector.ts
 *
 * Маркерный сбор данных с адаптивной частотой опроса.
 *
 * Режимы:
 *  - baseline:    акселерометр 10 Гц (триггер-детектор, НЕ отправка), GPS 1 Гц
 *  - background:  1 точка/мин (GPS+скорость, без акселерометра) -> kind=background
 *  - trigger:     вибрация |a| > порог (в g) -> окно ±2с @ 50 Гц -> kind=trigger
 *  - prearm:      приближение к зоне интереса < 300м -> 50 Гц + роллинг-буфер ±5с,
 *                 сработал триггер -> полное окно с zone_id -> kind=prearm
 *
 * Конфигурация (пороги) скачивается с сервера: GET /api/collection-config
 * и обновляется из ответа POST /api/raw-events (collectorConfig).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AccelSample {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface CollectorZone {
  id: string;
  latitude: number;
  longitude: number;
}

export interface CollectorConfig {
  version: number;
  enabled: boolean;
  trigger: {
    magnitude_threshold_g: number;
    window_before_ms: number;
    window_after_ms: number;
    capture_frequency_hz: number;
    baseline_frequency_hz: number;
    min_speed_kmh: number;
  };
  prearm: {
    zone_radius_m: number;
    buffer_window_ms: number;
    fetch_radius_m: number;
    fetch_interval_ms: number;
    min_confirmations: number;
    max_zones: number;
  };
  background: {
    interval_ms: number;
    min_speed_kmh: number;
  };
}

export interface RawEvent {
  kind: 'background' | 'trigger' | 'prearm' | 'user_report';
  timestamp: number;
  gps: {
    latitude: number;
    longitude: number;
    speed: number;
    accuracy: number;
    altitude?: number;
  };
  accelerometer?: AccelSample[];
  duration_ms?: number;
  capture_frequency_hz?: number;
  zone_id?: string;
  max_magnitude?: number;
  trigger_magnitude?: number;
  speed_kmh?: number;
  userReported?: boolean;
  eventType?: string;
  severity?: number;
}

const DEFAULT_CONFIG: CollectorConfig = {
  version: 1,
  enabled: true,
  trigger: {
    magnitude_threshold_g: 1.3,
    window_before_ms: 2000,
    window_after_ms: 2000,
    capture_frequency_hz: 50,
    baseline_frequency_hz: 10,
    min_speed_kmh: 5,
  },
  prearm: {
    zone_radius_m: 300,
    buffer_window_ms: 5000,
    fetch_radius_m: 5000,
    fetch_interval_ms: 30000,
    min_confirmations: 1,
    max_zones: 200,
  },
  background: {
    interval_ms: 60000,
    min_speed_kmh: 0,
  },
};

const CONFIG_STORAGE_KEY = 'collector_config_v1';
const OFFLINE_QUEUE_KEY = 'raw_events_offline_queue';
const GRAVITY = 9.81;

export class AdaptiveCollector {
  private backendUrl: string;
  private deviceId: string;
  private onIntervalChange?: (hz: number) => void;

  config: CollectorConfig = DEFAULT_CONFIG;

  private accelBuffer: AccelSample[] = [];
  private prearmBuffer: AccelSample[] = [];
  private prearmActive = false;
  private currentGps: { latitude: number; longitude: number; speed: number; accuracy: number } | null = null;
  private zones: CollectorZone[] = [];
  private zonesFetchedAt = 0;

  private triggerFiredAt: number | null = null;
  private captureStart: number | null = null;
  private captureEnd: number | null = null;
  private zoneForCapture: string | undefined;

  private backgroundTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBackgroundAt = 0;

  private offlineQueue: RawEvent[] = [];

  constructor(backendUrl: string, deviceId: string, onIntervalChange?: (hz: number) => void) {
    this.backendUrl = backendUrl;
    this.deviceId = deviceId;
    this.onIntervalChange = onIntervalChange;
    void this.loadConfig();
    void this.loadOfflineQueue();
  }

  // ─── Конфигурация ─────────────────────────────────────────────────────────

  async loadConfig() {
    try {
      const cached = await AsyncStorage.getItem(CONFIG_STORAGE_KEY);
      if (cached) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(cached) };
      }
    } catch {}
    try {
      const resp = await fetch(`${this.backendUrl}/api/collection-config`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.config) {
          this.applyConfig(data.config);
        }
      }
    } catch {}
  }

  applyConfig(config: Partial<CollectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.trigger) this.config.trigger = { ...DEFAULT_CONFIG.trigger, ...config.trigger };
    if (config?.prearm) this.config.prearm = { ...DEFAULT_CONFIG.prearm, ...config.prearm };
    if (config?.background) this.config.background = { ...DEFAULT_CONFIG.background, ...config.background };
    try {
      void AsyncStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(this.config));
    } catch {}
  }

  // ─── Зоны интереса (для пре-арма) ────────────────────────────────────────

  setZones(zones: CollectorZone[]) {
    const max = this.config.prearm.max_zones;
    if (zones.length > max) {
      zones = zones.slice(0, max);
    }
    this.zones = zones;
  }

  async refreshZones(force = false) {
    const now = Date.now();
    if (!force && now - this.zonesFetchedAt < this.config.prearm.fetch_interval_ms) return;
    if (!this.currentGps) return;
    try {
      const { latitude, longitude } = this.currentGps;
      const radius = this.config.prearm.fetch_radius_m;
      const minConf = this.config.prearm.min_confirmations;
      const resp = await fetch(
        `${this.backendUrl}/api/obstacles/nearby?latitude=${latitude}&longitude=${longitude}&radius=${radius}&min_confirmations=${minConf}&merge_radius=0`
      );
      if (resp.ok) {
        const data = await resp.json();
        const obstacles = data?.obstacles || [];
        this.setZones(
          obstacles
            .filter((o: any) => typeof o?.latitude === 'number' && typeof o?.longitude === 'number')
            .map((o: any) => ({ id: o.id, latitude: o.latitude, longitude: o.longitude }))
        );
        this.zonesFetchedAt = now;
      }
    } catch {}
  }

  // ─── GPS ──────────────────────────────────────────────────────────────────

  updateGps(location: any) {
    if (!location?.coords) return;
    this.currentGps = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      speed: location.coords.speed || 0,
      accuracy: location.coords.accuracy || 0,
    };
    this.checkPrearm();
  }

  private distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private checkPrearm() {
    if (!this.currentGps) return;
    const zoneRadius = this.config.prearm.zone_radius_m;
    const wasInPrearm = this.isPrearmZone();
    this.zoneForCapture = undefined;
    for (const zone of this.zones) {
      const d = this.distanceMeters(
        this.currentGps.latitude, this.currentGps.longitude,
        zone.latitude, zone.longitude
      );
      if (d <= zoneRadius) {
        this.zoneForCapture = zone.id;
        break;
      }
    }
    const inPrearm = this.isPrearmZone();
    if (inPrearm !== wasInPrearm) {
      this.applyCaptureRate();
    }
  }

  private applyCaptureRate() {
    const hz = this.isPrearmZone()
      ? this.config.trigger.capture_frequency_hz
      : this.config.trigger.baseline_frequency_hz;
    this.onIntervalChange?.(hz);
  }

  private zoneRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  startZoneRefresher() {
    if (this.zoneRefreshTimer) return;
    const loop = () => {
      void this.refreshZones();
      this.zoneRefreshTimer = setTimeout(loop, this.config.prearm.fetch_interval_ms);
    };
    this.zoneRefreshTimer = setTimeout(loop, this.config.prearm.fetch_interval_ms);
  }

  stopZoneRefresher() {
    if (this.zoneRefreshTimer) {
      clearTimeout(this.zoneRefreshTimer);
      this.zoneRefreshTimer = null;
    }
  }

  stop() {
    this.stopBackgroundSampling();
    this.stopZoneRefresher();
  }

  // ─── Акселерометр ─────────────────────────────────────────────────────────

  /** Вызывается на каждое значение акселерометра (baseline 10 Гц или 50 Гц при пре-арме) */
  onAccel(data: { x: number; y: number; z: number }, timestamp?: number) {
    if (!this.config.enabled) return;
    const ts = timestamp ?? Date.now();
    const sample: AccelSample = { x: data.x, y: data.y, z: data.z, timestamp: ts };

    const inPrearm = this.isPrearmZone();
    const maxBuf = inPrearm
      ? Math.ceil((this.config.prearm.buffer_window_ms / 1000) * this.config.trigger.capture_frequency_hz)
      : 100;

    // Роллинг-буфер
    this.accelBuffer.push(sample);
    while (this.accelBuffer.length > maxBuf) this.accelBuffer.shift();

    // Детектор вибрации: магнитуда (в g, гравитация уже в данных)
    const magnitude = Math.sqrt(sample.x ** 2 + sample.y ** 2 + sample.z ** 2) / GRAVITY;
    const threshold = this.config.trigger.magnitude_threshold_g;

    if (magnitude > threshold) {
      this.fireTrigger(inPrearm, magnitude, ts);
    }
  }

  private isPrearmZone(): boolean {
    return !!this.zoneForCapture;
  }

  private fireTrigger(isPrearm: boolean, magnitude: number, ts: number) {
    const now = Date.now();
    // Анти-спам: не чаще одного захвата в 3 секунды
    if (this.triggerFiredAt && now - this.triggerFiredAt < 3000) return;
    this.triggerFiredAt = now;

    const before = this.config.trigger.window_before_ms;
    const after = this.config.trigger.window_after_ms;
    const startTs = ts - before;
    const endTs = ts + after;

    const window = this.accelBuffer.filter((s) => s.timestamp >= startTs && s.timestamp <= endTs);
    if (window.length < 3) return;

    const gps = this.currentGps;
    if (!gps) return;

    const event: RawEvent = {
      kind: isPrearm ? 'prearm' : 'trigger',
      timestamp: ts,
      gps: {
        latitude: gps.latitude,
        longitude: gps.longitude,
        speed: gps.speed,
        accuracy: gps.accuracy,
      },
      accelerometer: window,
      duration_ms: endTs - startTs,
      capture_frequency_hz: isPrearm
        ? this.config.trigger.capture_frequency_hz
        : this.config.trigger.baseline_frequency_hz,
      zone_id: isPrearm ? this.zoneForCapture : undefined,
      max_magnitude: Math.max(...window.map((s) => Math.sqrt(s.x ** 2 + s.y ** 2 + s.z ** 2) / GRAVITY)),
      trigger_magnitude: magnitude,
      speed_kmh: (gps.speed || 0) * 3.6,
    };

    void this.sendEvent(event);
  }

  // ─── Фоновый сэмплинг ────────────────────────────────────────────────────

  startBackgroundSampling() {
    if (this.backgroundTimer) return;
    const loop = () => {
      const now = Date.now();
      if (now - this.lastBackgroundAt >= this.config.background.interval_ms) {
        this.lastBackgroundAt = now;
        void this.sendBackgroundSample();
      }
      this.backgroundTimer = setTimeout(loop, this.config.background.interval_ms);
    };
    this.backgroundTimer = setTimeout(loop, this.config.background.interval_ms);
  }

  stopBackgroundSampling() {
    if (this.backgroundTimer) {
      clearTimeout(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  }

  private async sendBackgroundSample() {
    const gps = this.currentGps;
    if (!gps) return;
    const minSpeed = this.config.background.min_speed_kmh;
    if ((gps.speed || 0) * 3.6 < minSpeed) return;
    const event: RawEvent = {
      kind: 'background',
      timestamp: Date.now(),
      gps: {
        latitude: gps.latitude,
        longitude: gps.longitude,
        speed: gps.speed,
        accuracy: gps.accuracy,
      },
      speed_kmh: (gps.speed || 0) * 3.6,
    };
    await this.sendEvent(event);
  }

  // ─── Отправка ────────────────────────────────────────────────────────────

  async sendEvent(event: RawEvent) {
    try {
      const resp = await fetch(`${this.backendUrl}/api/raw-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: this.deviceId, events: [event] }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.collectorConfig) {
          this.applyConfig(data.collectorConfig);
        }
      } else {
        await this.enqueueOffline(event);
      }
    } catch {
      await this.enqueueOffline(event);
    }
  }

  async flushOfflineQueue() {
    if (this.offlineQueue.length === 0) return;
    const batch = this.offlineQueue.splice(0, 10);
    try {
      const resp = await fetch(`${this.backendUrl}/api/raw-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: this.deviceId, events: batch }),
      });
      if (!resp.ok) {
        this.offlineQueue.unshift(...batch);
      }
    } catch {
      this.offlineQueue.unshift(...batch);
    }
    await this.saveOfflineQueue();
  }

  private async enqueueOffline(event: RawEvent) {
    if (this.offlineQueue.length >= 50) return;
    this.offlineQueue.push(event);
    await this.saveOfflineQueue();
  }

  private async loadOfflineQueue() {
    try {
      const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
      if (raw) this.offlineQueue = JSON.parse(raw);
    } catch {}
  }

  private async saveOfflineQueue() {
    try {
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(this.offlineQueue));
    } catch {}
  }
}

export default AdaptiveCollector;
