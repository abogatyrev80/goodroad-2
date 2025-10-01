import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import useAppStore from '../hooks/useAppStore';

// Memoized color calculation
const getRoadConditionColor = (score: number): string => {
  if (score >= 80) return '#4CAF50';
  if (score >= 60) return '#FF9800';
  if (score >= 40) return '#FF5722';
  return '#F44336';
};

// Memoized condition text
const getRoadConditionText = (score: number): string => {
  if (score >= 80) return 'Отличная дорога';
  if (score >= 60) return 'Хорошая дорога';
  if (score >= 40) return 'Удовлетворительная';
  return 'Плохая дорога';
};

// Memoized Road Condition Component
const RoadConditionCard = React.memo<{ score: number }>(({ score }) => {
  const color = useMemo(() => getRoadConditionColor(score), [score]);
  const text = useMemo(() => getRoadConditionText(score), [score]);
  
  return (
    <View style={styles.conditionCard}>
      <View style={[styles.conditionIndicator, { backgroundColor: color }]}>
        <Text style={styles.conditionScore}>{Math.round(score)}</Text>
      </View>
      <View style={styles.conditionInfo}>
        <Text style={styles.conditionTitle}>Качество дороги</Text>
        <Text style={[styles.conditionText, { color }]}>{text}</Text>
      </View>
    </View>
  );
});

// Memoized Status Card Component
const StatusCard = React.memo<{
  icon: string;
  title: string;
  value: string;
  subtitle?: string;
  color: string;
}>(({ icon, title, value, subtitle, color }) => (
  <View style={styles.statusCard}>
    <Ionicons name={icon as any} size={24} color={color} />
    <Text style={styles.statusTitle}>{title}</Text>
    <Text style={styles.statusValue}>{value}</Text>
    {subtitle && <Text style={styles.statusSubtitle}>{subtitle}</Text>}
  </View>
));

// Memoized Warning Banner Component
const WarningBanner = React.memo<{ hazards: any[] }>(({ hazards }) => {
  if (hazards.length === 0) return null;
  
  return (
    <View style={styles.warningBanner}>
      <Ionicons name="warning" size={24} color="#FF5722" />
      <View style={styles.warningContent}>
        <Text style={styles.warningTitle}>Впереди препятствия:</Text>
        {hazards.slice(0, 2).map((hazard, index) => (
          <Text key={hazard.id || index} style={styles.warningText}>
            {hazard.type} через {hazard.distance}м
          </Text>
        ))}
      </View>
    </View>
  );
});

// Main optimized component
export default function GoodRoadApp() {
  // Zustand store hooks
  const {
    settings,
    isTracking,
    currentLocation,
    roadConditionScore,
    activeHazards,
    dataProcessingStats,
    setTracking,
    updateSettings,
    loadSettings,
  } = useAppStore();

  // Local loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isTogglingTracking, setIsTogglingTracking] = useState(false);

  // Initialize store on mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        loadSettings();
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate loading
      } catch (error) {
        console.error('App initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, [loadSettings]);

  // Memoized callbacks to prevent unnecessary re-renders
  const handleTrackingToggle = useCallback(async () => {
    setIsTogglingTracking(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 300)); // Simulate processing
      setTracking(!isTracking);
    } catch (error) {
      console.error('Tracking toggle error:', error);
      Alert.alert('Ошибка', 'Не удалось изменить состояние мониторинга');
    } finally {
      setIsTogglingTracking(false);
    }
  }, [isTracking, setTracking]);

  const handleSettingsNavigation = useCallback(() => {
    router.push('/settings');
  }, []);

  const handleTestWarning = useCallback(() => {
    Alert.alert(
      '⚠️ ПРЕДУПРЕЖДЕНИЕ',
      'Впереди препятствие - яма через 50 метров!',
      [{ text: 'OK' }]
    );
  }, []);

  const handleAudioToggle = useCallback((value: boolean) => {
    updateSettings({ audioWarnings: value });
  }, [updateSettings]);

  const handleVibrationToggle = useCallback((value: boolean) => {
    updateSettings({ vibrationWarnings: value });
  }, [updateSettings]);

  // Memoized computed values
  const currentSpeed = useMemo(() => {
    return currentLocation?.speed ? Math.round(currentLocation.speed * 3.6) : 0;
  }, [currentLocation?.speed]);

  const gpsStatus = useMemo(() => {
    if (!currentLocation) return { text: 'Ожидание...', color: '#888' };
    return { 
      text: 'Подключен', 
      color: '#4CAF50',
      subtitle: currentLocation.accuracy ? `±${currentLocation.accuracy.toFixed(0)}м` : undefined
    };
  }, [currentLocation]);

  const speedWarningActive = useMemo(() => {
    return settings && currentSpeed >= settings.speedThreshold && isTracking;
  }, [settings, currentSpeed, isTracking]);

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Загрузка Good Road...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      {/* Optimized Header */}
      <View style={styles.header}>
        <Ionicons name="car-sport" size={32} color="#4CAF50" />
        <Text style={styles.title}>Good Road</Text>
        <TouchableOpacity 
          onPress={handleSettingsNavigation}
          style={styles.settingsButton}
          accessible
          accessibilityLabel="Настройки приложения"
        >
          <Ionicons name="settings" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={styles.content} 
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Warning Banner - только если есть активные угрозы */}
        <WarningBanner hazards={activeHazards} />

        {/* Speed Warning */}
        {settings && currentSpeed < settings.speedThreshold && isTracking && (
          <View style={styles.speedWarningBanner}>
            <Ionicons name="speedometer" size={20} color="#FF9800" />
            <Text style={styles.speedWarningText}>
              Предупреждения отключены (скорость ниже {settings.speedThreshold} км/ч)
            </Text>
          </View>
        )}

        {/* Road Condition Display - Memoized */}
        <RoadConditionCard score={roadConditionScore} />

        {/* Tracking Control */}
        <View style={styles.controlCard}>
          <TouchableOpacity
            style={[
              styles.trackingButton, 
              { backgroundColor: isTracking ? '#F44336' : '#4CAF50' }
            ]}
            onPress={handleTrackingToggle}
            disabled={isTogglingTracking}
            accessible
            accessibilityLabel={isTracking ? 'Остановить мониторинг' : 'Начать мониторинг'}
          >
            {isTogglingTracking ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons 
                name={isTracking ? "stop" : "play"} 
                size={24} 
                color="white" 
              />
            )}
            <Text style={styles.buttonText}>
              {isTracking ? 'Остановить мониторинг' : 'Начать мониторинг'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Status Cards - Memoized */}
        <View style={styles.statusGrid}>
          <StatusCard
            icon="location"
            title="GPS"
            value={gpsStatus.text}
            subtitle={gpsStatus.subtitle}
            color={gpsStatus.color}
          />
          <StatusCard
            icon="speedometer"
            title="Скорость"
            value={`${currentSpeed} км/ч`}
            subtitle={speedWarningActive ? 'Предупреждения активны' : 'Предупреждения отключены'}
            color="#2196F3"
          />
        </View>

        {/* Performance Stats */}
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>📊 Статистика</Text>
          <Text style={styles.statsText}>
            Обработано точек: {dataProcessingStats.totalDataPoints}
          </Text>
          <Text style={styles.statsText}>
            Ошибки синхронизации: {dataProcessingStats.syncErrors}
          </Text>
          {dataProcessingStats.lastSyncTime > 0 && (
            <Text style={styles.statsText}>
              Последняя синхронизация: {new Date(dataProcessingStats.lastSyncTime).toLocaleTimeString()}
            </Text>
          )}
        </View>

        {/* Quick Settings */}
        <View style={styles.quickSettingsCard}>
          <Text style={styles.settingsTitle}>🔊 Быстрые настройки</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Звуковые предупреждения</Text>
            <Switch
              value={settings?.audioWarnings || false}
              onValueChange={handleAudioToggle}
              thumbColor={settings?.audioWarnings ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Вибрация</Text>
            <Switch
              value={settings?.vibrationWarnings || false}
              onValueChange={handleVibrationToggle}
              thumbColor={settings?.vibrationWarnings ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>
        </View>

        {/* Test Warning Button */}
        <TouchableOpacity 
          style={styles.testButton}
          onPress={handleTestWarning}
          accessible
          accessibilityLabel="Протестировать звуковое предупреждение"
        >
          <Ionicons name="volume-high" size={20} color="white" />
          <Text style={styles.testButtonText}>Тестовое предупреждение</Text>
        </TouchableOpacity>

        {/* Settings Navigation */}
        <TouchableOpacity 
          style={styles.settingsNavButton}
          onPress={handleSettingsNavigation}
          accessible
          accessibilityLabel="Открыть детальные настройки"
        >
          <Ionicons name="settings-outline" size={20} color="white" />
          <Text style={styles.settingsNavText}>Подробные настройки предупреждений</Text>
          <Ionicons name="chevron-forward" size={20} color="#888" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 16,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    flex: 1,
    textAlign: 'center',
  },
  settingsButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  warningBanner: {
    backgroundColor: '#FF572220',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: '#FF5722',
  },
  warningContent: {
    flex: 1,
    marginLeft: 12,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF5722',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 14,
    color: '#FF5722',
    marginVertical: 2,
  },
  speedWarningBanner: {
    backgroundColor: '#FF980220',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  speedWarningText: {
    fontSize: 14,
    color: '#FF9800',
    marginLeft: 8,
    flex: 1,
  },
  conditionCard: {
    flexDirection: 'row',
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  conditionIndicator: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  conditionScore: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  conditionInfo: {
    flex: 1,
  },
  conditionTitle: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '600',
  },
  conditionText: {
    fontSize: 16,
    marginTop: 4,
    fontWeight: '500',
  },
  controlCard: {
    marginBottom: 16,
  },
  trackingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  statusGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statusCard: {
    flex: 0.48,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statusTitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 8,
  },
  statusValue: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
    marginTop: 4,
  },
  statusSubtitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  statsCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  statsTitle: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 8,
  },
  statsText: {
    fontSize: 14,
    color: '#888',
    marginVertical: 2,
  },
  quickSettingsCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  settingsTitle: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  settingLabel: {
    fontSize: 14,
    color: '#ffffff',
    flex: 1,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2196F3',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  testButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  settingsNavButton: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  settingsNavText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
    marginLeft: 8,
  },
});

RoadConditionCard.displayName = 'RoadConditionCard';
StatusCard.displayName = 'StatusCard';
WarningBanner.displayName = 'WarningBanner';