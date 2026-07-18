import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

export type BackendMode = 'auto' | 'local' | 'prod';

const STORAGE_KEY = '@backend_mode';
const PROD_URL = 'https://goodroad.su';
const LOCAL_URL = 'http://192.168.8.213:8000';
const HEALTH_TIMEOUT_MS = 2000;

class BackendConfigService {
  private mode: BackendMode = 'auto';
  private activeUrl: string = PROD_URL;
  private lastCheckedAt: number = 0;
  private checkPromise: Promise<string> | null = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored && ['auto', 'local', 'prod'].includes(stored)) {
        this.mode = stored as BackendMode;
      }
    } catch {}
    await this.resolve();
    this.isInitialized = true;
  }

  async setMode(mode: BackendMode): Promise<void> {
    this.mode = mode;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, mode);
    } catch {}
    await this.resolve();
  }

  getMode(): BackendMode {
    return this.mode;
  }

  getActiveUrl(): string {
    return this.activeUrl;
  }

  getLocalUrl(): string {
    return LOCAL_URL;
  }

  getProdUrl(): string {
    return PROD_URL;
  }

  async getActiveUrlAsync(): Promise<string> {
    if (!this.isInitialized) await this.initialize();
    return this.activeUrl;
  }

  private async resolve(): Promise<void> {
    switch (this.mode) {
      case 'local':
        this.activeUrl = LOCAL_URL;
        return;
      case 'prod':
        this.activeUrl = PROD_URL;
        return;
      case 'auto':
      default:
        await this.autoDetect();
        return;
    }
  }

  private async autoDetect(): Promise<void> {
    if (this.checkPromise) {
      await this.checkPromise;
      return;
    }

    this.checkPromise = this._doAutoDetect();
    try {
      this.activeUrl = await this.checkPromise;
    } finally {
      this.checkPromise = null;
    }
  }

  private async _doAutoDetect(): Promise<string> {
    const localOk = await this.checkHealth(LOCAL_URL);
    if (localOk) return LOCAL_URL;
    return PROD_URL;
  }

  private async checkHealth(baseUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const res = await fetch(`${baseUrl}/`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  async testConnection(url: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${url}/`, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      return { ok: res.ok, latencyMs: Date.now() - start };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - start, error: e?.message || 'Connection failed' };
    }
  }

  async refresh(): Promise<string> {
    await this.resolve();
    return this.activeUrl;
  }
}

export const backendConfigService = new BackendConfigService();
export default backendConfigService;
