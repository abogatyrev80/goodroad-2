import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { syncService } from '../services/SyncService';
import backendConfigService from '../services/BackendConfigService';

// Локальная статистика устройства
interface LocalStats {
  totalSensorData: number;
  totalWarnings: number;
  unsyncedData: number;
}

interface SyncStatus {
  lastSyncTime: string;
  pendingSensorData: number;
  downloadedRegions: string[];
  isOnline: boolean;
}

export default function AdminPanelSimple() {
  const [localStats, setLocalStats] = useState<LocalStats | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Админка только для разработчиков — в production перенаправляем на главную
    if (!__DEV__) {
      router.replace('/');
      return;
    }
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);

      // Инициализируем sync service (если ещё не инициализирован)
      await syncService.initialize();

      // Загружаем локальную статистику и статус синхронизации
      const [stats, status] = await Promise.all([
        syncService.getDatabaseStats(),
        syncService.getSyncStatus(),
      ]);

      setLocalStats(stats || null);
      setSyncStatus(status);
    } catch (error: any) {
      console.error('❌ Admin data loading error:', error);
      setLocalStats(null);
      setSyncStatus(null);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
  };

  const handleForceSync = async () => {
    if (!syncStatus?.isOnline) {
      Alert.alert('Нет соединения', 'Проверьте подключение к интернету для синхронизации.');
      return;
    }
    setIsSyncing(true);
    try {
      const success = await syncService.forceFullSync();
      await loadData();
      Alert.alert(success ? 'Готово' : 'Ошибка', success ? 'Синхронизация завершена' : 'Не удалось синхронизировать данные');
    } catch (error) {
      Alert.alert('Ошибка', 'Ошибка при синхронизации');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleOpenWebAdmin = async () => {
    const backendUrl = backendConfigService.getActiveUrl();
    const adminUrl = backendUrl.endsWith('/')
      ? `${backendUrl}api/admin/dashboard/v3`
      : `${backendUrl}/api/admin/dashboard/v3`;

    try {
      const supported = await Linking.canOpenURL(adminUrl);
      if (supported) {
        await Linking.openURL(adminUrl);
      } else {
        Alert.alert('Ошибка', 'Не удалось открыть веб-админку');
      }
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось открыть веб-админку');
    }
  };

  const formatLastSync = (time: string) => {
    if (!time || time === 'Never') return 'Никогда';
    try {
      const date = new Date(time);
      return date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return time;
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Загрузка административных данных...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isWeb = Platform.OS === 'web';
  const hasLocalDb = localStats !== null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            try {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.push('/');
              }
            } catch {
              router.push('/');
            }
          }}
          style={styles.headerButton}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Админ-панель</Text>
        <Pressable onPress={handleRefresh} disabled={isRefreshing} style={styles.headerButton}>
          {isRefreshing ? (
            <ActivityIndicator size={20} color="#4CAF50" />
          ) : (
            <Ionicons name="refresh" size={20} color="#ffffff" />
          )}
        </Pressable>
      </View>

      <ScrollView style={styles.content}>
        {/* Локальная статистика устройства */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📱 Локальные данные устройства</Text>

          {isWeb ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                Локальная база данных недоступна в веб-версии.{'\n'}
                Используйте полную админ-панель на сервере для просмотра всех данных.
              </Text>
            </View>
          ) : hasLocalDb ? (
            <View style={styles.statsContainer}>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{localStats.totalSensorData}</Text>
                <Text style={styles.statLabel}>Данных датчиков</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{localStats.totalWarnings}</Text>
                <Text style={styles.statLabel}>Предупреждений</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNumber, localStats.unsyncedData > 0 && styles.statNumberWarning]}>
                  {localStats.unsyncedData}
                </Text>
                <Text style={styles.statLabel}>Ожидают синхронизации</Text>
              </View>
            </View>
          ) : (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>База данных не инициализирована</Text>
            </View>
          )}
        </View>

        {/* Статус синхронизации */}
        {syncStatus && !isWeb && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🔄 Синхронизация</Text>
            <View style={styles.syncStatusCard}>
              <View style={styles.syncStatusRow}>
                <Text style={styles.syncLabel}>Последняя синхронизация:</Text>
                <Text style={styles.syncValue}>{formatLastSync(syncStatus.lastSyncTime)}</Text>
              </View>
              <View style={styles.syncStatusRow}>
                <Text style={styles.syncLabel}>Сеть:</Text>
                <View style={[styles.statusDot, { backgroundColor: syncStatus.isOnline ? '#4CAF50' : '#F44336' }]} />
                <Text style={styles.syncValue}>{syncStatus.isOnline ? 'Онлайн' : 'Офлайн'}</Text>
              </View>
              {syncStatus.downloadedRegions.length > 0 && (
                <View style={styles.syncStatusRow}>
                  <Text style={styles.syncLabel}>Регионы:</Text>
                  <Text style={styles.syncValue}>{syncStatus.downloadedRegions.join(', ')}</Text>
                </View>
              )}
            </View>

            <Pressable
              style={[styles.actionButton, isSyncing && styles.actionButtonDisabled]}
              onPress={handleForceSync}
              disabled={isSyncing || !syncStatus.isOnline}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color="#1a1a1a" />
              ) : (
                <Ionicons name="sync" size={20} color="#1a1a1a" />
              )}
              <Text style={styles.actionButtonText}>
                {isSyncing ? 'Синхронизация...' : 'Принудительная синхронизация'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Ссылка на веб-админку */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🌐 Полная аналитика</Text>
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Сырые данные, события и карты доступны в веб-админке на сервере.
            </Text>
          </View>
          <Pressable style={[styles.actionButton, styles.actionButtonSecondary]} onPress={handleOpenWebAdmin}>
            <Ionicons name="open-outline" size={20} color="#4CAF50" />
            <Text style={[styles.actionButtonText, styles.actionButtonTextSecondary]}>
              Открыть веб-админку
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.versionInfo}>
        <Text style={styles.versionText}>Good Road v2.0.0</Text>
        <Text style={styles.versionSubtext}>
          {Platform.OS === 'web' ? 'Web' : 'Mobile'} • Только обработанные данные на устройстве
        </Text>
      </View>
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
  headerButton: {
    marginLeft: 12,
    padding: 4,
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
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statCard: {
    flex: 1,
    minWidth: 90,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    margin: 4,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 4,
  },
  statNumberWarning: {
    color: '#FF9800',
  },
  statLabel: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
  },
  syncStatusCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  syncStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  syncLabel: {
    fontSize: 14,
    color: '#888',
    flex: 1,
  },
  syncValue: {
    fontSize: 14,
    color: '#ffffff',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    padding: 14,
    gap: 8,
  },
  actionButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  actionButtonTextSecondary: {
    color: '#4CAF50',
  },
  versionInfo: {
    backgroundColor: '#2a2a2a',
    padding: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#333',
    marginTop: 16,
  },
  versionText: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  versionSubtext: {
    color: '#888',
    fontSize: 11,
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: '#2a2a2a',
    padding: 14,
    borderRadius: 8,
    marginBottom: 12,
  },
  infoText: {
    color: '#aaaaaa',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
});