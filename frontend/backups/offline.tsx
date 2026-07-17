import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

// Offline модули будут загружены динамически только для мобильных устройств
let syncService: any = null;
let SyncStatus: any = null;

// Динамическая загрузка сервисов только в мобильном приложении
// Для веб-версии сервисы недоступны

export default function OfflineSettings() {
  // Web fallback component
  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Offline режим</Text>
          <View style={styles.placeholder} />
        </View>
        
        <View style={styles.webFallback}>
          <Ionicons name="phone-portrait" size={64} color="#4CAF50" />
          <Text style={styles.webFallbackTitle}>Только для мобильных устройств</Text>
          <Text style={styles.webFallbackText}>
            Offline режим и локальная синхронизация данных доступны только в мобильном приложении.
          </Text>
          <Text style={styles.webFallbackText}>
            Для полного доступа к этим функциям используйте Expo Go на своем смартфоне.
          </Text>
          
          <Pressable 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={20} color="white" />
            <Text style={styles.backButtonText}>Назад</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Состояние данных (только для мобильных)
  const [syncStatus, setSyncStatus] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);

  useEffect(() => {
    if (syncService) {
      initializeOfflineSettings();
    }
  }, []);

  const initializeOfflineSettings = async () => {
    try {
      setIsLoading(true);
      
      // Попытка динамической загрузки сервисов только для мобильных устройств
      if (Platform.OS !== 'web') {
        try {
          const syncModule = await import('../services/SyncService');
          syncService = syncModule.syncService;
          
          await syncService.initialize();
          const status = await syncService.getSyncStatus();
          setSyncStatus(status);
          
          console.log('✅ Offline services initialized successfully');
        } catch (importError) {
          console.warn('⚠️ Offline services not available:', importError.message);
          
          // Установить fallback статус для веб-версии
          setSyncStatus({
            isOnline: true,
            lastSyncTime: 'Недоступно в веб-версии',
            pendingUploads: 0,
            totalStoredRecords: 0
          });
        }
      } else {
        console.log('🌐 Web platform - offline services disabled');
        
        // Установить демо-статус для веб-версии
        setSyncStatus({
          isOnline: true,
          lastSyncTime: 'Недоступно в веб-версии',
          pendingUploads: 0,
          totalStoredRecords: 0
        });
      }
    } catch (error) {
      console.error('❌ Offline settings initialization error:', error);
      
      // Не показывать Alert для веб-версии
      if (Platform.OS !== 'web') {
        Alert.alert('Ошибка', 'Не удалось инициализировать offline настройки');
      }
    } finally {
      setIsLoading(false);
    }
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
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Offline режим</Text>
        <Pressable onPress={initializeOfflineSettings}>
          <Ionicons name="refresh" size={24} color="#ffffff" />
        </Pressable>
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
                Последняя синхронизация: {syncStatus?.lastSyncTime || 'Никогда'}
              </Text>
            </View>
          </View>
        </View>

        {/* Features Available */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📱 Доступные функции</Text>
          
          <View style={styles.featureItem}>
            <Ionicons name="database" size={24} color="#4CAF50" />
            <View style={styles.featureInfo}>
              <Text style={styles.featureTitle}>Локальная база данных SQLite</Text>
              <Text style={styles.featureDescription}>
                Автономное хранение и синхронизация данных
              </Text>
            </View>
          </View>
          
          <View style={styles.featureItem}>
            <Ionicons name="cloud-download" size={24} color="#2196F3" />
            <View style={styles.featureInfo}>
              <Text style={styles.featureTitle}>Загрузка данных по регионам</Text>
              <Text style={styles.featureDescription}>
                Предварительная загрузка предупреждений для offline использования
              </Text>
            </View>
          </View>
          
          <View style={styles.featureItem}>
            <Ionicons name="sync" size={24} color="#FF9800" />
            <View style={styles.featureInfo}>
              <Text style={styles.featureTitle}>Автоматическая синхронизация</Text>
              <Text style={styles.featureDescription}>
                Синхронизация накопленных данных при подключении к сети
              </Text>
            </View>
          </View>
        </View>

        {/* Mobile Instructions */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📲 Инструкция</Text>
          
          <Text style={styles.instructionText}>
            1. Откройте Expo Go на своем смартфоне
          </Text>
          <Text style={styles.instructionText}>
            2. Отсканируйте QR код или введите URL для подключения
          </Text>
          <Text style={styles.instructionText}>
            3. На мобильном устройстве будут доступны все offline функции
          </Text>
          <Text style={styles.instructionText}>
            4. Данные будут автоматически синхронизироваться при подключении к интернету
          </Text>
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
  placeholder: {
    width: 24,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  webFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  webFallbackTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 20,
    marginBottom: 16,
    textAlign: 'center',
  },
  webFallbackText: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 30,
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
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
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  featureInfo: {
    flex: 1,
    marginLeft: 12,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#ffffff',
    marginBottom: 4,
  },
  featureDescription: {
    fontSize: 13,
    color: '#888',
    lineHeight: 18,
  },
  instructionText: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
    paddingLeft: 8,
  },
  bottomPadding: {
    height: 20,
  },
});