import * as Network from 'expo-network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Disable SQLite on web completely - avoid bundling issues
let SQLite: any = null;

// Only load SQLite on native platforms
const initSQLite = async () => {
  if (Platform.OS !== 'web' && !SQLite) {
    try {
      SQLite = await import('expo-sqlite');
      return SQLite;
    } catch (error) {
      console.warn('SQLite not available on this platform:', error);
      return null;
    }
  }
  return SQLite;
};

// Типы для локальных данных
export interface LocalSensorData {
  id?: number;
  serverId?: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  speed: number;
  accuracy: number;
  accelerometer: {
    x: number;
    y: number;
    z: number;
  };
  roadQuality: number;
  isSynced: boolean;
  createdAt: string;
}

export interface LocalWarning {
  id?: number;
  serverId?: string;
  latitude: number;
  longitude: number;
  hazardType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  isVerified: boolean;
  region: string;
  city: string;
  country: string;
  lastUpdated: string;
}

export interface SyncStatus {
  lastSyncTime: string;
  pendingSensorData: number;
  downloadedRegions: string[];
  isOnline: boolean;
}

class LocalDatabaseManager {
  private db: SQLite.SQLiteDatabase | null = null;
  private syncInProgress = false;

  async initialize() {
    if (!SQLite) {
      console.warn('⚠️ SQLite not available on this platform - database features disabled');
      return;
    }
    
    try {
      this.db = await SQLite.openDatabaseAsync('good_road.db');
      await this.createTables();
      console.log('✅ Local database initialized');
    } catch (error) {
      console.error('❌ Database initialization error:', error);
      throw error;
    }
  }

  private async createTables() {
    if (!this.db) throw new Error('Database not initialized');

    // Таблица для данных датчиков (собранных пользователем)
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS sensor_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        timestamp TEXT NOT NULL,
        speed REAL DEFAULT 0,
        accuracy REAL DEFAULT 0,
        accelerometer_x REAL DEFAULT 0,
        accelerometer_y REAL DEFAULT 0,
        accelerometer_z REAL DEFAULT 0,
        road_quality REAL DEFAULT 50,
        is_synced INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);

    // Таблица для предупреждений (скачанных с сервера)
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT UNIQUE,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        hazard_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        description TEXT,
        is_verified INTEGER DEFAULT 0,
        region TEXT,
        city TEXT,
        country TEXT,
        last_updated TEXT NOT NULL
      );
    `);

    // Таблица для статуса синхронизации регионов
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_regions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        region_code TEXT UNIQUE,
        region_name TEXT,
        last_sync TEXT,
        warning_count INTEGER DEFAULT 0
      );
    `);

    // Индексы для быстрого поиска по координатам
    await this.db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_sensor_location 
      ON sensor_data(latitude, longitude);
    `);

    await this.db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_warnings_location 
      ON warnings(latitude, longitude);
    `);

    console.log('✅ Database tables created');
  }

  // === SENSOR DATA MANAGEMENT ===
  async saveSensorData(data: Omit<LocalSensorData, 'id' | 'createdAt'>): Promise<number> {
    if (!this.db || !SQLite) {
      console.warn('Database not available - sensor data not stored locally');
      return -1;
    }

    const result = await this.db.runAsync(`
      INSERT INTO sensor_data (
        server_id, latitude, longitude, timestamp, speed, accuracy,
        accelerometer_x, accelerometer_y, accelerometer_z, 
        road_quality, is_synced, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.serverId || null,
      data.latitude,
      data.longitude, 
      data.timestamp,
      data.speed,
      data.accuracy,
      data.accelerometer.x,
      data.accelerometer.y,
      data.accelerometer.z,
      data.roadQuality,
      data.isSynced ? 1 : 0,
      new Date().toISOString()
    ]);

    console.log(`💾 Saved sensor data locally (ID: ${result.lastInsertRowId})`);
    return result.lastInsertRowId as number;
  }

  async getUnsyncedSensorData(): Promise<LocalSensorData[]> {
    if (!this.db || !SQLite) {
      console.warn('Database not available - returning empty unsynced data');
      return [];
    }

    const result = await this.db.getAllAsync(`
      SELECT * FROM sensor_data WHERE is_synced = 0 ORDER BY created_at
    `) as any[];

    return result.map(row => ({
      id: row.id,
      serverId: row.server_id,
      latitude: row.latitude,
      longitude: row.longitude,
      timestamp: row.timestamp,
      speed: row.speed,
      accuracy: row.accuracy,
      accelerometer: {
        x: row.accelerometer_x,
        y: row.accelerometer_y,
        z: row.accelerometer_z
      },
      roadQuality: row.road_quality,
      isSynced: row.is_synced === 1,
      createdAt: row.created_at
    }));
  }

  async markSensorDataSynced(localIds: number[], serverIds?: string[]) {
    if (!this.db || !SQLite || localIds.length === 0) {
      if (!this.db || !SQLite) {
        console.warn('Database not available - sensor data sync status not updated');
      }
      return;
    }

    const placeholders = localIds.map(() => '?').join(',');
    
    await this.db.runAsync(`
      UPDATE sensor_data 
      SET is_synced = 1 ${serverIds ? ', server_id = ?' : ''}
      WHERE id IN (${placeholders})
    `, serverIds ? [...localIds, ...serverIds] : localIds);

    console.log(`✅ Marked ${localIds.length} sensor data records as synced`);
  }

  // === WARNINGS MANAGEMENT ===
  async saveWarnings(warnings: LocalWarning[]) {
    if (!this.db || !SQLite || warnings.length === 0) {
      if (!this.db || !SQLite) {
        console.warn('Database not available - warnings not saved locally');
      }
      return;
    }

    const statement = await this.db.prepareAsync(`
      INSERT OR REPLACE INTO warnings (
        server_id, latitude, longitude, hazard_type, severity,
        description, is_verified, region, city, country, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      for (const warning of warnings) {
        await statement.executeAsync([
          warning.serverId || `local_${Date.now()}_${Math.random()}`,
          warning.latitude,
          warning.longitude,
          warning.hazardType,
          warning.severity,
          warning.description || '',
          warning.isVerified ? 1 : 0,
          warning.region || '',
          warning.city || '',
          warning.country || '',
          warning.lastUpdated
        ]);
      }
      
      console.log(`💾 Saved ${warnings.length} warnings locally`);
    } finally {
      await statement.finalizeAsync();
    }
  }

  async getNearbyWarnings(latitude: number, longitude: number, radiusKm: number = 1): Promise<LocalWarning[]> {
    if (!this.db || !SQLite) {
      console.warn('Database not available - returning empty warnings');
      return [];
    }

    // Простое приближение для поиска в радиусе
    const latRange = radiusKm / 111; // ~1 градус = 111 км
    const lonRange = radiusKm / (111 * Math.cos(latitude * Math.PI / 180));

    const result = await this.db.getAllAsync(`
      SELECT * FROM warnings 
      WHERE latitude BETWEEN ? AND ? 
      AND longitude BETWEEN ? AND ?
      AND is_verified = 1
      ORDER BY 
        (latitude - ?) * (latitude - ?) + 
        (longitude - ?) * (longitude - ?)
      LIMIT 50
    `, [
      latitude - latRange,
      latitude + latRange,
      longitude - lonRange,
      longitude + lonRange,
      latitude, latitude,
      longitude, longitude
    ]) as any[];

    return result.map(row => ({
      id: row.id,
      serverId: row.server_id,
      latitude: row.latitude,
      longitude: row.longitude,
      hazardType: row.hazard_type,
      severity: row.severity as 'low' | 'medium' | 'high' | 'critical',
      description: row.description,
      isVerified: row.is_verified === 1,
      region: row.region,
      city: row.city,
      country: row.country,
      lastUpdated: row.last_updated
    }));
  }

  // === REGION MANAGEMENT ===
  async updateRegionSyncStatus(regionCode: string, regionName: string, warningCount: number) {
    if (!this.db || !SQLite) {
      console.warn('Database not available - region sync status not updated');
      return;
    }

    await this.db.runAsync(`
      INSERT OR REPLACE INTO sync_regions (region_code, region_name, last_sync, warning_count)
      VALUES (?, ?, ?, ?)
    `, [regionCode, regionName, new Date().toISOString(), warningCount]);

    console.log(`📍 Updated sync status for region: ${regionName} (${warningCount} warnings)`);
  }

  async getDownloadedRegions(): Promise<Array<{code: string, name: string, lastSync: string, warningCount: number}>> {
    if (!this.db || !SQLite) {
      console.warn('Database not available - returning empty regions');
      return [];
    }

    const result = await this.db.getAllAsync(`
      SELECT * FROM sync_regions ORDER BY region_name
    `) as any[];

    return result.map(row => ({
      code: row.region_code,
      name: row.region_name,
      lastSync: row.last_sync,
      warningCount: row.warning_count
    }));
  }

  // === SYNC STATUS ===
  async getSyncStatus(): Promise<SyncStatus> {
    const lastSyncTime = await AsyncStorage.getItem('last_sync_time') || 'Never';
    const downloadedRegions = await this.getDownloadedRegions();
    const unsyncedData = await this.getUnsyncedSensorData();
    const networkState = await Network.getNetworkStateAsync();

    return {
      lastSyncTime,
      pendingSensorData: unsyncedData.length,
      downloadedRegions: downloadedRegions.map(r => r.name),
      isOnline: networkState.isConnected || false
    };
  }

  // === DATA CLEANUP ===
  async cleanupOldData(daysOld: number = 30) {
    if (!this.db) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();

    // Удаляем старые синхронизированные данные датчиков
    const sensorResult = await this.db.runAsync(`
      DELETE FROM sensor_data 
      WHERE is_synced = 1 AND created_at < ?
    `, [cutoffISO]);

    // Удаляем старые неверифицированные предупреждения
    const warningResult = await this.db.runAsync(`
      DELETE FROM warnings 
      WHERE is_verified = 0 AND last_updated < ?
    `, [cutoffISO]);

    console.log(`🧹 Cleanup: removed ${sensorResult.changes} old sensor records, ${warningResult.changes} old warnings`);
  }

  async getDatabaseStats() {
    if (!this.db || !SQLite) {
      console.warn('Database not available - returning null stats');
      return null;
    }

    const sensorCount = await this.db.getFirstAsync(`SELECT COUNT(*) as count FROM sensor_data`) as {count: number};
    const warningCount = await this.db.getFirstAsync(`SELECT COUNT(*) as count FROM warnings`) as {count: number};
    const unsyncedCount = await this.db.getFirstAsync(`SELECT COUNT(*) as count FROM sensor_data WHERE is_synced = 0`) as {count: number};

    return {
      totalSensorData: sensorCount.count,
      totalWarnings: warningCount.count,
      unsyncedData: unsyncedCount.count
    };
  }
}

export const localDB = new LocalDatabaseManager();