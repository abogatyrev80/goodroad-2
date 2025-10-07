import * as Network from 'expo-network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { localDB, LocalSensorData, LocalWarning, SyncStatus } from './LocalDatabase';

interface RegionData {
  code: string;
  name: string;
  country: string;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export class SyncService {
  private backendUrl: string;
  private syncInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor() {
    this.backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '/';
  }

  async initialize() {
    if (this.isInitialized) return;
    
    try {
      await localDB.initialize();
      this.startPeriodicSync();
      this.isInitialized = true;
      
      console.log('✅ Sync service initialized');
    } catch (error) {
      console.error('❌ Sync service initialization error:', error);
      throw error;
    }
  }

  // === AUTOMATIC SYNC ===
  private startPeriodicSync() {
    // Синхронизация каждые 30 секунд когда есть интернет
    this.syncInterval = setInterval(async () => {
      const networkState = await Network.getNetworkStateAsync();
      if (networkState.isConnected) {
        await this.syncWithServer();
      }
    }, 30000);
  }

  async stopPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // === MAIN SYNC FUNCTION ===
  async syncWithServer(): Promise<boolean> {
    try {
      const networkState = await Network.getNetworkStateAsync();
      if (!networkState.isConnected) {
        console.log('📡 No internet connection - sync skipped');
        return false;
      }

      console.log('🔄 Starting sync with server...');

      // 1. Отправляем несинхронизированные данные на сервер
      await this.uploadSensorData();

      // 2. Обновляем локальные предупреждения
      await this.downloadUpdatedWarnings();

      // 3. Обновляем время последней синхронизации
      await AsyncStorage.setItem('last_sync_time', new Date().toISOString());

      // 4. Очищаем старые данные
      await localDB.cleanupOldData(30);

      console.log('✅ Sync completed successfully');
      return true;
    } catch (error) {
      console.error('❌ Sync error:', error);
      return false;
    }
  }

  // === UPLOAD SENSOR DATA ===
  private async uploadSensorData() {
    const unsyncedData = await localDB.getUnsyncedSensorData();
    if (unsyncedData.length === 0) {
      console.log('📤 No unsynced sensor data to upload');
      return;
    }

    console.log(`📤 Uploading ${unsyncedData.length} sensor data records...`);

    try {
      // Отправляем данные пачками по 50 записей
      const batchSize = 50;
      for (let i = 0; i < unsyncedData.length; i += batchSize) {
        const batch = unsyncedData.slice(i, i + batchSize);
        
        const response = await fetch(`${this.backendUrl}api/sensor-data/batch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            data: batch.map(item => ({
              latitude: item.latitude,
              longitude: item.longitude,
              timestamp: item.timestamp,
              speed: item.speed,
              accuracy: item.accuracy,
              accelerometer: item.accelerometer,
              road_quality_score: item.roadQuality
            }))
          }),
        });

        if (response.ok) {
          const result = await response.json();
          const localIds = batch.map(item => item.id!);
          const serverIds = result.inserted_ids || [];
          
          // Отмечаем как синхронизированные
          await localDB.markSensorDataSynced(localIds, serverIds);
          
          console.log(`✅ Uploaded batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(unsyncedData.length/batchSize)}`);
        } else {
          console.error(`❌ Failed to upload batch: ${response.status}`);
        }
      }
    } catch (error) {
      console.error('❌ Upload sensor data error:', error);
    }
  }

  // === DOWNLOAD WARNINGS ===
  private async downloadUpdatedWarnings() {
    try {
      const downloadedRegions = await localDB.getDownloadedRegions();
      
      for (const region of downloadedRegions) {
        const response = await fetch(
          `${this.backendUrl}api/warnings/region/${region.code}?since=${region.lastSync}`
        );
        
        if (response.ok) {
          const warnings = await response.json();
          
          if (warnings.length > 0) {
            const localWarnings: LocalWarning[] = warnings.map((w: any) => ({
              serverId: w._id,
              latitude: w.latitude,
              longitude: w.longitude,
              hazardType: w.hazard_type,
              severity: w.severity,
              description: w.description,
              isVerified: w.is_verified,
              region: region.code,
              city: w.city || '',
              country: w.country || '',
              lastUpdated: w.updated_at || new Date().toISOString()
            }));

            await localDB.saveWarnings(localWarnings);
            await localDB.updateRegionSyncStatus(
              region.code, 
              region.name, 
              warnings.length
            );
            
            console.log(`📥 Downloaded ${warnings.length} warnings for ${region.name}`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Download warnings error:', error);
    }
  }

  // === REGION MANAGEMENT ===
  async downloadRegionData(regionCode: string, regionName: string, bounds: RegionData['bounds']): Promise<boolean> {
    try {
      const networkState = await Network.getNetworkStateAsync();
      if (!networkState.isConnected) {
        throw new Error('No internet connection');
      }

      console.log(`📥 Downloading data for region: ${regionName}...`);

      const response = await fetch(
        `${this.backendUrl}api/warnings/region/${regionCode}/full?` +
        `north=${bounds.north}&south=${bounds.south}&east=${bounds.east}&west=${bounds.west}`
      );

      if (!response.ok) {
        throw new Error(`Failed to download region data: ${response.status}`);
      }

      const warnings = await response.json();
      
      const localWarnings: LocalWarning[] = warnings.map((w: any) => ({
        serverId: w._id,
        latitude: w.latitude,
        longitude: w.longitude,
        hazardType: w.hazard_type,
        severity: w.severity,
        description: w.description,
        isVerified: w.is_verified,
        region: regionCode,
        city: w.city || '',
        country: w.country || '',
        lastUpdated: w.updated_at || new Date().toISOString()
      }));

      await localDB.saveWarnings(localWarnings);
      await localDB.updateRegionSyncStatus(regionCode, regionName, warnings.length);

      console.log(`✅ Downloaded ${warnings.length} warnings for ${regionName}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to download region ${regionName}:`, error);
      return false;
    }
  }

  async getAvailableRegions(): Promise<RegionData[]> {
    try {
      const networkState = await Network.getNetworkStateAsync();
      if (!networkState.isConnected) {
        return [];
      }

      const response = await fetch(`${this.backendUrl}api/regions/available`);
      if (!response.ok) return [];

      return await response.json();
    } catch (error) {
      console.error('❌ Failed to get available regions:', error);
      return [];
    }
  }

  // === OFFLINE DATA ACCESS ===
  async saveOfflineSensorData(
    latitude: number,
    longitude: number,
    speed: number,
    accuracy: number,
    accelerometer: { x: number; y: number; z: number },
    roadQuality: number
  ): Promise<number> {
    const sensorData: Omit<LocalSensorData, 'id' | 'createdAt'> = {
      latitude,
      longitude,
      timestamp: new Date().toISOString(),
      speed,
      accuracy,
      accelerometer,
      roadQuality,
      isSynced: false
    };

    return await localDB.saveSensorData(sensorData);
  }

  async getNearbyWarningsOffline(
    latitude: number,
    longitude: number,
    radiusKm: number = 1
  ): Promise<LocalWarning[]> {
    return await localDB.getNearbyWarnings(latitude, longitude, radiusKm);
  }

  // === STATUS METHODS ===
  async getSyncStatus(): Promise<SyncStatus> {
    return await localDB.getSyncStatus();
  }

  async getDatabaseStats() {
    return await localDB.getDatabaseStats();
  }

  async forceFullSync(): Promise<boolean> {
    console.log('🔄 Forcing full sync...');
    return await this.syncWithServer();
  }

  // === MANUAL CONTROL ===
  async clearLocalData() {
    // Это для debug/reset функции
    console.log('🗑️ Clearing all local data...');
    // Implement database clearing if needed
  }
}

export const syncService = new SyncService();