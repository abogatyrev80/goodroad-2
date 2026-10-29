import AsyncStorage from '@react-native-async-storage/async-storage';


export type BackendMode = 'auto' | 'local' | 'prod';

const STORAGE_KEY = '@backend_mode';
const LOCAL_URL_KEY = '@backend_local_url';
const PROD_URL = 'https://goodroad.su';
const DEFAULT_LOCAL_URL = 'http://192.168.1.213:8000';
const HEALTH_TIMEOUT_MS = 2000;

class BackendConfigService {
  private mode: BackendMode = 'prod';
  private activeUrl: string = PROD_URL;
  private customLocalUrl: string = DEFAULT_LOCAL_URL;
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
      const custom = await AsyncStorage.getItem(LOCAL_URL_KEY);
      if (custom) {
        this.customLocalUrl = custom;
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
    return this.customLocalUrl;
  }

  async setLocalUrl(url: string): Promise<void> {
    this.customLocalUrl = url;
    try {
      await AsyncStorage.setItem(LOCAL_URL_KEY, url);
    } catch {}
    if (this.mode === 'local') {
      this.activeUrl = url;
    } else if (this.mode === 'auto') {
      await this.resolve();
    }
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
        this.activeUrl = this.customLocalUrl;
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
    const localOk = await this.checkHealth(this.customLocalUrl);
    if (localOk) return this.customLocalUrl;
    return PROD_URL;
  }

  private async checkHealth(baseUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const res = await fetch(`${baseUrl}/api`, {
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
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${url}/api`, { method: 'GET', signal: controller.signal });
      return {
        ok: res.ok,
        latencyMs: Date.now() - start,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (e: any) {
      const aborted = e?.name === 'AbortError';
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: aborted ? 'таймаут 5с' : (e?.message || 'нет ответа'),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async refresh(): Promise<string> {
    await this.resolve();
    return this.activeUrl;
  }
}

export const backendConfigService = new BackendConfigService();
export default backendConfigService;
