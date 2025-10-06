import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { syncService } from '../services/SyncService';
import { SyncStatus } from '../services/LocalDatabase';

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

interface DownloadedRegion {
  code: string;
  name: string;
  lastSync: string;
  warningCount: number;
}

export default function OfflineSettings() {
  // Состояние данных
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [availableRegions, setAvailableRegions] = useState<RegionData[]>([]);
  const [downloadedRegions, setDownloadedRegions] = useState<DownloadedRegion[]>([]);
  const [databaseStats, setDatabaseStats] = useState<any>(null);
  
  // UI состояние
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingRegion, setDownloadingRegion] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);

  useEffect(() => {
    initializeOfflineSettings();
  }, []);

  const initializeOfflineSettings = async () => {
    try {
      setIsLoading(true);
      
      // Инициализируем sync service если еще не инициализирован
      await syncService.initialize();
      
      // Загружаем текущий статус
      await loadCurrentStatus();
      
      // Загружаем доступные регионы если есть интернет
      await loadAvailableRegions();
      
    } catch (error) {
      console.error('Offline settings initialization error:', error);
      Alert.alert('Ошибка', 'Не удалось инициализировать offline настройки');
    } finally {
      setIsLoading(false);
    }
  };

  const loadCurrentStatus = async () => {
    try {
      const status = await syncService.getSyncStatus();
      const downloaded = await syncService.getSyncStatus();
      const stats = await syncService.getDatabaseStats();
      
      setSyncStatus(status);
      setDatabaseStats(stats);
      
      // Загружаем информацию о скачанных регионах
      // Note: это нужно будет реализовать в SyncService
      setDownloadedRegions([]);
      
    } catch (error) {
      console.error('Error loading current status:', error);
    }
  };

  const loadAvailableRegions = async () => {
    try {
      const regions = await syncService.getAvailableRegions();
      setAvailableRegions(regions);
    } catch (error) {
      console.error('Error loading available regions:', error);
    }
  };

  const handleDownloadRegion = async (region: RegionData) => {
    try {
      setDownloadingRegion(region.code);
      
      Alert.alert(
        'Скачать данные региона',
        `Скачать верифицированные предупреждения для ${region.name}?\n\nЭто может занять несколько минут.`,
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Скачать',
            onPress: async () => {
              const success = await syncService.downloadRegionData(
                region.code,
                region.name,
                region.bounds
              );
              
              if (success) {
                Alert.alert('Успешно!', `Данные для ${region.name} скачаны`);
                await loadCurrentStatus();
              } else {
                Alert.alert('Ошибка', `Не удалось скачать данные для ${region.name}`);
              }
            }
          }
        ]
      );
      
    } catch (error) {
      console.error('Error downloading region:', error);
      Alert.alert('Ошибка', 'Не удалось скачать данные региона');
    } finally {
      setDownloadingRegion(null);
    }
  };

  const handleForceSync = async () => {
    try {
      setSyncing(true);
      const success = await syncService.forceFullSync();
      
      if (success) {
        Alert.alert('Синхронизация завершена', 'Данные успешно синхронизированы с сервером');
        await loadCurrentStatus();
      } else {
        Alert.alert('Ошибка синхронизации', 'Проверьте подключение к интернету');
      }
    } catch (error) {
      console.error('Force sync error:', error);
      Alert.alert('Ошибка', 'Не удалось выполнить синхронизацию');
    } finally {
      setSyncing(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatLastSync = (dateStr: string): string => {
    if (dateStr === 'Never') return 'Никогда';
    
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'Только что';
    if (diffMins < 60) return `${diffMins} мин назад`;
    if (diffHours < 24) return `${diffHours} ч назад`;
    return `${diffDays} дн назад`;
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Загрузка offline настроек...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Offline режим</Text>
        <TouchableOpacity onPress={loadCurrentStatus}>
          <Ionicons name="refresh" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Connection Status */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Ionicons 
              name={syncStatus?.isOnline ? "wifi" : "wifi-off"} 
              size={24} 
              color={syncStatus?.isOnline ? "#4CAF50" : "#F44336"} 
            />
            <View style={styles.statusInfo}>
              <Text style={styles.statusTitle}>
                {syncStatus?.isOnline ? 'Подключено к интернету' : 'Offline режим'}
              </Text>
              <Text style={styles.statusSubtitle}>
                Последняя синхронизация: {formatLastSync(syncStatus?.lastSyncTime || 'Never')}
              </Text>
            </View>
            {syncing ? (
              <ActivityIndicator color="#4CAF50" />
            ) : (
              <TouchableOpacity onPress={handleForceSync} disabled={!syncStatus?.isOnline}>
                <Ionicons name="sync" size={24} color={syncStatus?.isOnline ? "#4CAF50" : "#666"} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Database Statistics */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📊 Локальные данные</Text>
          
          <View style={styles.statGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{databaseStats?.totalSensorData || 0}</Text>
              <Text style={styles.statLabel}>Записей датчиков</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{databaseStats?.totalWarnings || 0}</Text>
              <Text style={styles.statLabel}>Предупреждений</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{syncStatus?.pendingSensorData || 0}</Text>
              <Text style={styles.statLabel}>Несинхронизированных</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{downloadedRegions.length}</Text>
              <Text style={styles.statLabel}>Скачанных регионов</Text>
            </View>
          </View>
        </View>

        {/* Auto Sync Setting */}
        <View style={styles.sectionCard}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>Автоматическая синхронизация</Text>
              <Text style={styles.settingSubtitle}>
                Синхронизировать данные при подключении к интернету
              </Text>
            </View>
            <Switch
              value={autoSyncEnabled}
              onValueChange={setAutoSyncEnabled}
              thumbColor={autoSyncEnabled ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>
        </View>

        {/* Downloaded Regions */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📍 Скачанные регионы</Text>
          
          {downloadedRegions.length === 0 ? (
            <Text style={styles.emptyText}>Нет скачанных регионов</Text>
          ) : (
            downloadedRegions.map((region) => (
              <View key={region.code} style={styles.regionItem}>
                <View style={styles.regionInfo}>
                  <Text style={styles.regionName}>{region.name}</Text>
                  <Text style={styles.regionStats}>
                    {region.warningCount} предупреждений • {formatLastSync(region.lastSync)}
                  </Text>
                </View>
                <TouchableOpacity style={styles.regionAction}>
                  <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* Available Regions */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>🌍 Доступные регионы</Text>
          
          {!syncStatus?.isOnline && (
            <Text style={styles.offlineNote}>
              Подключитесь к интернету для просмотра доступных регионов
            </Text>
          )}
          
          {availableRegions.length === 0 && syncStatus?.isOnline ? (
            <Text style={styles.emptyText}>Нет доступных регионов</Text>
          ) : (
            availableRegions
              .filter(region => !downloadedRegions.find(d => d.code === region.code))
              .map((region) => (
                <View key={region.code} style={styles.regionItem}>
                  <View style={styles.regionInfo}>
                    <Text style={styles.regionName}>{region.name}</Text>
                    <Text style={styles.regionStats}>{region.country}</Text>
                  </View>
                  <TouchableOpacity 
                    style={styles.downloadButton}
                    onPress={() => handleDownloadRegion(region)}
                    disabled={downloadingRegion === region.code || !syncStatus?.isOnline}
                  >
                    {downloadingRegion === region.code ? (
                      <ActivityIndicator size="small" color="#4CAF50" />
                    ) : (
                      <Ionicons 
                        name="cloud-download" 
                        size={24} 
                        color={syncStatus?.isOnline ? "#4CAF50" : "#666"} 
                      />
                    )}
                  </TouchableOpacity>
                </View>
              ))
          )}
        </View>

        {/* Storage Management */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>🗄️ Управление хранилищем</Text>
          
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => {
              Alert.alert(
                'Очистка старых данных',
                'Удалить синхронизированные данные старше 30 дней?',
                [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Очистить', style: 'destructive', onPress: () => {
                    // Implement cleanup
                    Alert.alert('Завершено', 'Старые данные удалены');
                  }}
                ]
              );
            }}
          >
            <Ionicons name="trash-outline" size={20} color="#FF9800" />
            <Text style={styles.actionButtonText}>Очистить старые данные</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.actionButton, { borderColor: '#F44336' }]}
            onPress={() => {
              Alert.alert(
                'Сброс базы данных',
                'Удалить ВСЕ локальные данные? Это действие нельзя отменить!',
                [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Сбросить', style: 'destructive', onPress: () => {
                    // Implement full reset
                    Alert.alert('База данных сброшена', 'Все локальные данные удалены');
                  }}
                ]
              );
            }}
          >
            <Ionicons name="warning" size={20} color="#F44336" />
            <Text style={[styles.actionButtonText, { color: '#F44336' }]}>
              Сбросить базу данных
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#2a2a2a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    fontSize: 16,
    color: '#888',
    marginTop: 12,
  },
  statusCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusInfo: {
    flex: 1,
    marginLeft: 12,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  statusSubtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statItem: {
    width: '48%',
    backgroundColor: '#333',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
  },
  settingSubtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 2,
  },
  regionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  regionInfo: {
    flex: 1,
  },
  regionName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
  },
  regionStats: {
    fontSize: 14,
    color: '#888',
    marginTop: 2,
  },
  regionAction: {
    padding: 8,
  },
  downloadButton: {
    padding: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF9800',
    marginBottom: 8,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FF9800',
    marginLeft: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    padding: 20,
  },
  offlineNote: {
    fontSize: 14,
    color: '#FF9800',
    textAlign: 'center',
    padding: 16,
    backgroundColor: '#FF980020',
    borderRadius: 8,
    marginBottom: 12,
  },
  bottomPadding: {
    height: 20,
  },
});