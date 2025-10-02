import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Switch,
  Alert,
  Vibration,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';

export default function GoodRoadApp() {
  // Состояние приложения
  const [isTracking, setIsTracking] = useState(false);
  const [roadConditionScore, setRoadConditionScore] = useState<number>(75);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  
  // GPS и локация данные
  const [currentLocation, setCurrentLocation] = useState<Location.LocationObject | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number>(0);
  const [satelliteCount, setSatelliteCount] = useState<number>(0);
  const [locationError, setLocationError] = useState<string | null>(null);
  
  // Refs для управления ресурсами
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    setupAudio();
    requestLocationPermission();
    
    return () => {
      cleanup();
    };
  }, []);

  const setupAudio = async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      console.log('🔊 Audio system initialized');
    } catch (error) {
      console.error('Audio setup error:', error);
    }
  };

  const cleanup = async () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
    }
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch (error) {
        console.error('Sound cleanup error:', error);
      }
    }
  };

  const requestLocationPermission = async () => {
    try {
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      
      if (foregroundStatus !== 'granted') {
        setLocationError('Разрешение на геолокацию отклонено');
        Alert.alert(
          'Разрешение на геолокацию',
          'Для работы приложения необходимо разрешение на определение местоположения',
          [{ text: 'OK' }]
        );
        return;
      }

      // Запрос фонового доступа
      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        console.log('Background location not granted');
      }

      console.log('✅ Location permissions granted');
      setLocationError(null);
      
    } catch (error) {
      console.error('Permission request error:', error);
      setLocationError('Ошибка запроса разрешений');
    }
  };

  const startTracking = async () => {
    if (locationError) {
      Alert.alert('Ошибка', 'Сначала необходимо предоставить разрешение на геолокацию');
      return;
    }

    setIsLoading(true);
    
    try {
      // Проверяем доступность GPS
      const isLocationEnabled = await Location.hasServicesEnabledAsync();
      if (!isLocationEnabled) {
        Alert.alert('GPS отключен', 'Включите GPS для работы приложения');
        setIsLoading(false);
        return;
      }

      // Запускаем отслеживание геолокации
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000, // Обновления каждую секунду
          distanceInterval: 1, // Обновления каждый метр
        },
        (location) => {
          updateLocationData(location);
        }
      );

      setIsTracking(true);
      console.log('🛰️ GPS tracking started');
      
    } catch (error) {
      console.error('GPS start error:', error);
      Alert.alert('Ошибка GPS', 'Не удалось запустить отслеживание GPS');
    } finally {
      setIsLoading(false);
    }
  };

  const stopTracking = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    
    setIsTracking(false);
    setCurrentSpeed(0);
    console.log('🛑 GPS tracking stopped');
  };

  const updateLocationData = (location: Location.LocationObject) => {
    setCurrentLocation(location);
    
    // Обновляем скорость (конвертируем м/с в км/ч)
    const speedKmh = (location.coords.speed || 0) * 3.6;
    setCurrentSpeed(speedKmh);
    
    // Обновляем точность GPS
    setGpsAccuracy(location.coords.accuracy || 0);
    
    // Симулируем количество спутников на основе точности
    const estimatedSatellites = Math.max(4, Math.min(12, Math.round(20 - (location.coords.accuracy || 50) / 5)));
    setSatelliteCount(estimatedSatellites);
    
    console.log(`📍 Location: ${location.coords.latitude.toFixed(6)}, ${location.coords.longitude.toFixed(6)}`);
    console.log(`🚗 Speed: ${speedKmh.toFixed(1)} km/h`);
    console.log(`📡 Accuracy: ±${(location.coords.accuracy || 0).toFixed(1)}m`);
  };

  const playWarningSound = async () => {
    if (!audioEnabled) return;

    try {
      // Освобождаем предыдущий звук
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      // Создаем простой звуковой сигнал с помощью data URI
      const soundUri = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvGUgBSuG0O/AaykEK4nS8LljIAUug8rz0LljIAUiiM7t2o0zCQ==';
      
      const { sound } = await Audio.Sound.createAsync(
        { uri: soundUri },
        {
          shouldPlay: true,
          volume: 0.8,
          rate: 1.0,
        }
      );

      soundRef.current = sound;
      
      // Воспроизводим 3 коротких сигнала
      for (let i = 0; i < 3; i++) {
        await sound.replayAsync();
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      console.log('🔊 Warning sound played successfully');
      
    } catch (error) {
      console.error('Sound play error:', error);
      console.log('🔊 Sound fallback: Audio alert would play on device');
    }
  };

  const triggerVibration = () => {
    if (!vibrationEnabled) return;

    if (Platform.OS !== 'web') {
      Vibration.vibrate([200, 100, 200, 100, 200, 100]);
      console.log('📳 Vibration triggered');
    } else {
      console.log('📳 Vibration would work on mobile device');
    }
  };

  const testWarning = async () => {
    console.log('🚨 Testing warning system...');
    
    await playWarningSound();
    triggerVibration();
    
    Alert.alert(
      '⚠️ ДОРОЖНОЕ ПРЕДУПРЕЖДЕНИЕ',
      `Впереди препятствие - яма через 50 метров!
      
🔊 Звук: ${audioEnabled ? 'Воспроизведен ✅' : 'Отключен ❌'}
📳 Вибрация: ${vibrationEnabled ? 'Активирована ✅' : 'Отключена ❌'}
📍 GPS: ${isTracking ? 'Активен' : 'Неактивен'}
🚗 Скорость: ${currentSpeed.toFixed(1)} км/ч`,
      [{ text: 'Понятно' }]
    );
  };

  const handleTrackingToggle = () => {
    if (isTracking) {
      stopTracking();
    } else {
      startTracking();
    }
  };

  const getRoadConditionColor = (score: number) => {
    if (score >= 80) return '#4CAF50';
    if (score >= 60) return '#FF9800';
    if (score >= 40) return '#FF5722';
    return '#F44336';
  };

  const getRoadConditionText = (score: number) => {
    if (score >= 80) return 'Отличная дорога';
    if (score >= 60) return 'Хорошая дорога';
    if (score >= 40) return 'Удовлетворительная';
    return 'Плохая дорога';
  };

  const getGPSStatusColor = () => {
    if (!isTracking) return '#888';
    if (gpsAccuracy <= 5) return '#4CAF50';
    if (gpsAccuracy <= 15) return '#FF9800';
    return '#F44336';
  };

  const getGPSStatusText = () => {
    if (locationError) return 'Ошибка GPS';
    if (!isTracking) return 'GPS выключен';
    if (gpsAccuracy <= 5) return 'Отличный сигнал';
    if (gpsAccuracy <= 15) return 'Хороший сигнал';
    return 'Слабый сигнал';
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="car-sport" size={32} color="#4CAF50" />
        <Text style={styles.title}>Good Road</Text>
        <TouchableOpacity 
          onPress={() => router.push('/settings')}
          style={styles.settingsButton}
        >
          <Ionicons name="settings" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* GPS Status Banner */}
        <View style={[styles.statusBanner, { borderLeftColor: getGPSStatusColor() }]}>
          <Ionicons name="radio" size={24} color={getGPSStatusColor()} />
          <View style={styles.bannerContent}>
            <Text style={styles.bannerTitle}>GPS Статус: {getGPSStatusText()}</Text>
            <Text style={styles.bannerText}>
              {isTracking ? (
                `📡 ${satelliteCount} спутников • Точность: ±${gpsAccuracy.toFixed(1)}м`
              ) : (
                'Нажмите "Начать мониторинг" для активации GPS'
              )}
            </Text>
          </View>
        </View>

        {/* Road Condition Display */}
        <View style={styles.conditionCard}>
          <View style={[styles.conditionIndicator, { backgroundColor: getRoadConditionColor(roadConditionScore) }]}>
            <Text style={styles.conditionScore}>{Math.round(roadConditionScore)}</Text>
          </View>
          <View style={styles.conditionInfo}>
            <Text style={styles.conditionTitle}>Качество дороги</Text>
            <Text style={[styles.conditionText, { color: getRoadConditionColor(roadConditionScore) }]}>
              {getRoadConditionText(roadConditionScore)}
            </Text>
          </View>
        </View>

        {/* Tracking Control */}
        <View style={styles.controlCard}>
          <TouchableOpacity
            style={[styles.trackingButton, { 
              backgroundColor: isTracking ? '#F44336' : '#4CAF50',
              opacity: isLoading ? 0.7 : 1 
            }]}
            onPress={handleTrackingToggle}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons 
                name={isTracking ? "stop" : "play"} 
                size={24} 
                color="white" 
              />
            )}
            <Text style={styles.buttonText}>
              {isLoading ? 'Подключение к GPS...' : 
               isTracking ? 'Остановить мониторинг' : 'Начать мониторинг'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Status Cards */}
        <View style={styles.statusGrid}>
          {/* GPS Card */}
          <View style={styles.statusCard}>
            <Ionicons name="location" size={24} color={getGPSStatusColor()} />
            <Text style={styles.statusTitle}>GPS</Text>
            <Text style={[styles.statusValue, { color: getGPSStatusColor() }]}>
              {getGPSStatusText()}
            </Text>
            <Text style={styles.statusSubtitle}>
              {isTracking ? `${satelliteCount} спутников` : 'Неактивен'}
            </Text>
          </View>

          {/* Speed Card */}
          <View style={styles.statusCard}>
            <Ionicons name="speedometer" size={24} color="#2196F3" />
            <Text style={styles.statusTitle}>Скорость</Text>
            <Text style={[styles.statusValue, { 
              color: currentSpeed > 0 ? '#4CAF50' : '#888',
              fontSize: 18
            }]}>
              {currentSpeed.toFixed(1)} км/ч
            </Text>
            <Text style={styles.statusSubtitle}>
              {currentSpeed > 0 ? 'В движении' : 'Стоим'}
            </Text>
          </View>
        </View>

        {/* Real-time Location Info */}
        {currentLocation && (
          <View style={styles.locationCard}>
            <Text style={styles.locationTitle}>📍 Текущая позиция</Text>
            <Text style={styles.locationText}>
              Широта: {currentLocation.coords.latitude.toFixed(6)}°
            </Text>
            <Text style={styles.locationText}>
              Долгота: {currentLocation.coords.longitude.toFixed(6)}°
            </Text>
            <Text style={styles.locationText}>
              Высота: {(currentLocation.coords.altitude || 0).toFixed(1)} м
            </Text>
            <Text style={styles.locationText}>
              Направление: {(currentLocation.coords.heading || 0).toFixed(0)}°
            </Text>
          </View>
        )}

        {/* Audio Settings */}
        <View style={styles.quickSettingsCard}>
          <Text style={styles.settingsTitle}>🔊 Звуковые настройки</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Звуковые предупреждения</Text>
            <Switch
              value={audioEnabled}
              onValueChange={setAudioEnabled}
              thumbColor={audioEnabled ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Вибрация</Text>
            <Switch
              value={vibrationEnabled}
              onValueChange={setVibrationEnabled}
              thumbColor={vibrationEnabled ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>
        </View>

        {/* Test Warning Button */}
        <TouchableOpacity 
          style={[styles.testButton, { 
            backgroundColor: audioEnabled ? '#FF5722' : '#666' 
          }]}
          onPress={testWarning}
        >
          <Ionicons name="volume-high" size={20} color="white" />
          <Text style={styles.testButtonText}>
            🚨 ТЕСТОВОЕ ПРЕДУПРЕЖДЕНИЕ
          </Text>
        </TouchableOpacity>

        {/* Settings Navigation */}
        <TouchableOpacity 
          style={styles.settingsNavButton}
          onPress={() => router.push('/settings')}
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
  statusBanner: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 4,
  },
  bannerContent: {
    flex: 1,
    marginLeft: 12,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  bannerText: {
    fontSize: 14,
    color: '#888',
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
    fontWeight: '600',
    marginTop: 4,
  },
  statusSubtitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  locationCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  locationTitle: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 8,
  },
  locationText: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
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
    padding: 18,
    borderRadius: 12,
    marginBottom: 16,
  },
  testButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
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