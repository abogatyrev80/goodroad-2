import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
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
import { Accelerometer } from 'expo-sensors';
import { useAudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Импортируем типы из настроек (без offline зависимостей)
import { AppSettings, SoundOption } from './settings';

// IMPORTANT: Conditional imports for web compatibility
// On web, we skip SQLite-dependent services to avoid WASM loading errors
let syncService: any = null;
if (Platform.OS !== 'web') {
  // Only import sync service on mobile platforms
  try {
    const SyncModule = require('../services/SyncService');
    syncService = SyncModule.syncService;
  } catch (error) {
    console.warn('⚠️ Sync service not available:', error);
  }
}

// Типы препятствий и предупреждений
export interface RoadHazard {
  id: string;
  type: 'pothole' | 'speed_bump' | 'road_defect' | 'pedestrian_crossing' | 'railway_crossing' | 'construction' | 'unpaved_road';
  latitude: number;
  longitude: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  distance?: number;
}

export interface WarningState {
  hazard: RoadHazard;
  distanceToHazard: number;
  timeToHazard: number;
  currentSpeed: number;
  warningLevel: 'initial' | 'caution' | 'urgent' | 'critical';
  hasUserReacted: boolean;
  initialSpeed: number;
  lastWarningTime: number;
}

const HAZARD_NAMES: Record<string, string> = {
  pothole: 'яма',
  speed_bump: 'лежачий полицейский', 
  road_defect: 'дефект покрытия',
  pedestrian_crossing: 'пешеходный переход',
  railway_crossing: 'железнодорожный переезд',
  construction: 'дорожные работы',
  unpaved_road: 'грунтовая дорога'
};

export default function GoodRoadApp() {
  // Состояние приложения
  const [isTracking, setIsTracking] = useState(false);
  const [roadConditionScore, setRoadConditionScore] = useState<number>(75);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  
  // Настройки звука
  const [appSettings, setAppSettings] = useState<Partial<AppSettings>>({});
  
  // GPS и локация данные
  const [currentLocation, setCurrentLocation] = useState<Location.LocationObject | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number>(0);
  const [satelliteCount, setSatelliteCount] = useState<number>(0);
  const [locationError, setLocationError] = useState<string | null>(null);
  
  // Акселерометр
  const [accelerometerData, setAccelerometerData] = useState({ x: 0, y: 0, z: 0 });
  
  // Умная система предупреждений
  const [activeWarnings, setActiveWarnings] = useState<WarningState[]>([]);
  const [nearbyHazards, setNearbyHazards] = useState<RoadHazard[]>([]);
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  const [lastHazardCheck, setLastHazardCheck] = useState<number>(0);
  
  // Направление к ближайшему препятствию
  const [warningDirection, setWarningDirection] = useState<number>(0);
  
  // Refs для управления ресурсами
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const accelerometerSubscription = useRef<any>(null);
  const warningIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Audio player будет инициализирован позже при необходимости

  useEffect(() => {
    setupAudio();
    requestLocationPermission();
    loadAppSettings();
    
    return () => {
      cleanup();
    };
  }, []);

  const loadAppSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem('good_road_settings');
      if (stored) {
        const settings = JSON.parse(stored) as AppSettings;
        setAppSettings(settings);
        setAudioEnabled(settings.audioWarnings);
        setVibrationEnabled(settings.vibrationWarnings);
      }
    } catch (error) {
      console.error('Error loading app settings:', error);
    }
  };

  const setupAudio = async () => {
    try {
      // expo-audio автоматически настраивает режим аудио
      console.log('🔊 Audio system initialized');
    } catch (error) {
      console.error('Audio setup error:', error);
    }
  };

  const cleanup = async () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
    }
    if (accelerometerSubscription.current) {
      accelerometerSubscription.current.remove();
    }
    // expo-audio автоматически управляет ресурсами
    if (warningIntervalRef.current) {
      clearInterval(warningIntervalRef.current);
    }
  };

  // Автоматическая отправка данных каждые 10 секунд
  useEffect(() => {
    console.log('🔍 Проверка условий отправки данных:', {
      isTracking,
      platform: Platform.OS,
      hasSyncService: !!syncService,
      hasLocation: !!currentLocation
    });

    if (!isTracking || Platform.OS === 'web' || !syncService) {
      console.log('⏸️ Отправка данных приостановлена');
      return;
    }

    console.log('✅ Отправка данных активирована!');

    const sendDataToServer = async () => {
      if (!currentLocation) {
        console.log('⚠️ Нет данных GPS для отправки');
        return;
      }
      
      console.log('📤 Начинаем отправку данных на сервер...');

      const deviceId = Constants.deviceId || `mobile-app-${Date.now()}`;
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://roadquality.preview.emergentagent.com';
      const apiUrl = backendUrl.endsWith('/') ? backendUrl + 'api/sensor-data' : backendUrl + '/api/sensor-data';

      console.log('📡 Отправка на URL:', apiUrl);
      console.log('📍 GPS:', currentLocation.coords.latitude, currentLocation.coords.longitude);
      console.log('🏃 Скорость:', currentSpeed, 'км/ч');

      try {
        const payload = {
          deviceId: deviceId,
          sensorData: [
            {
              type: 'location',
              timestamp: Date.now(),
              data: {
                latitude: currentLocation.coords.latitude,
                longitude: currentLocation.coords.longitude,
                speed: currentSpeed,
                accuracy: gpsAccuracy
              }
            },
            {
              type: 'accelerometer',
              timestamp: Date.now(),
              data: {
                x: accelerometerData.x,
                y: accelerometerData.y,
                z: accelerometerData.z
              }
            }
          ]
        };

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          timeout: 10000,
        });

        if (!response.ok) {
          console.error('❌ Ошибка отправки данных:', response.status);
        }
      } catch (error: any) {
        console.error('❌ Ошибка сети:', error.message);
      }
    };

    // Отправляем данные каждые 10 секунд
    const intervalId = setInterval(sendDataToServer, 10000);
    
    // Первая отправка через 5 секунд после старта
    const timeoutId = setTimeout(sendDataToServer, 5000);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [isTracking]); // Зависимость только от isTracking, чтобы не пересоздавать интервал

  // Функции для системы предупреждений
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000; // Радиус Земли в метрах
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360; // Нормализуем к 0-360 градусов
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

      // Запускаем акселерометр (только на мобильных)
      if (Platform.OS !== 'web') {
        Accelerometer.setUpdateInterval(500); // Обновления каждые 500ms
        accelerometerSubscription.current = Accelerometer.addListener(({ x, y, z }) => {
          setAccelerometerData({ x, y, z });
        });
        console.log('✅ Мониторинг запущен');
      }

      setIsTracking(true);
      
    } catch (error) {
      console.error('❌ Ошибка запуска:', error);
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
    
    // Останавливаем акселерометр
    if (accelerometerSubscription.current) {
      accelerometerSubscription.current.remove();
      accelerometerSubscription.current = null;
    }
    
    setIsTracking(false);
    setCurrentSpeed(0);
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
    
    // Обновляем направление к ближайшему препятствию
    if (nearbyHazards.length > 0) {
      const closestHazard = nearbyHazards[0];
      const bearing = calculateBearing(
        location.coords.latitude,
        location.coords.longitude,
        closestHazard.latitude,
        closestHazard.longitude
      );
      setWarningDirection(bearing);
      
      console.log(`🧭 Direction to hazard: ${bearing.toFixed(0)}° (${HAZARD_NAMES[closestHazard.type] || closestHazard.type})`);
    }
    
    console.log(`📍 Location: ${location.coords.latitude.toFixed(6)}, ${location.coords.longitude.toFixed(6)}`);
    console.log(`🚗 Speed: ${speedKmh.toFixed(1)} km/h`);
    console.log(`📡 Accuracy: ±${(location.coords.accuracy || 0).toFixed(1)}m`);
  };

  const handleTrackingToggle = () => {
    if (isTracking) {
      stopTracking();
    } else {
      startTracking();
    }
  };

  const testWarning = async () => {
    console.log('🚨 Testing warning system...');
    
    // Добавляем тестовое препятствие для демонстрации стрелки направления
    const testHazard: RoadHazard = {
      id: 'test_hazard',
      type: 'pothole',
      latitude: 55.7568, // Фиксированные координаты для веб-демо
      longitude: 37.6186,
      severity: 'high',
      description: 'Тестовая яма для демонстрации',
      distance: 150
    };
    
    if (nearbyHazards.length === 0) {
      setNearbyHazards([testHazard]);
      console.log('📍 Добавлено тестовое препятствие для демонстрации стрелки');
      
      // Устанавливаем направление (северо-восток, 45 градусов) для демо
      setWarningDirection(45);
      console.log('🧭 Direction set to 45° (northeast) for demo');
    } else {
      setNearbyHazards([]);
      setWarningDirection(0);
      console.log('🧹 Убрано тестовое препятствие');
    }
    
    Alert.alert(
      '🚨 ТЕСТОВОЕ ПРЕДУПРЕЖДЕНИЕ',
      nearbyHazards.length === 0 ? 
        'Добавлено тестовое препятствие! Стрелка теперь красная и указывает направление (северо-восток).' :
        'Убрано тестовое препятствие. Стрелка снова зеленая с галочкой.',
      [{ text: 'OK' }]
    );
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
        <Pressable 
          onPress={() => {
            console.log('Navigating to settings from header...');
            try {
              router.push('/settings');
            } catch (error) {
              console.error('Header navigation error:', error);
              if (Platform.OS === 'web') {
                window.location.href = '/settings';
              }
            }
          }}
          style={styles.settingsButton}
        >
          <Ionicons name="settings" size={24} color="#ffffff" />
        </Pressable>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* Web Notice */}
        {Platform.OS === 'web' && (
          <View style={styles.webNotice}>
            <Ionicons name="information-circle" size={20} color="#FF9800" />
            <Text style={styles.webNoticeText}>
              Веб-версия для демонстрации. Полный функционал доступен в мобильном приложении.
            </Text>
          </View>
        )}
        
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

        {/* Direction Indicator to Nearest Hazard */}
        <View style={styles.conditionCard}>
          <View style={styles.directionContainer}>
            <View style={[styles.compassBackground, { 
              backgroundColor: nearbyHazards.length > 0 ? '#FF5722' : '#4CAF50' 
            }]}>
              {nearbyHazards.length > 0 ? (
                <View 
                  style={[
                    styles.directionArrowLarge,
                    { 
                      transform: [{ rotate: `${warningDirection}deg` }],
                    }
                  ]}
                >
                  <Ionicons name="arrow-up" size={32} color="white" />
                </View>
              ) : (
                <Ionicons name="checkmark-circle" size={32} color="white" />
              )}
            </View>
          </View>
          <View style={styles.conditionInfo}>
            <Text style={styles.conditionTitle}>Вектор направления</Text>
            {nearbyHazards.length > 0 ? (
              <View style={styles.hazardDetails}>
                <Text style={[styles.conditionText, { color: '#FF5722' }]}>
                  {HAZARD_NAMES[nearbyHazards[0]?.type] || 'Препятствие'}
                </Text>
                <Text style={styles.distanceText}>
                  {nearbyHazards[0]?.distance < 1000 ? 
                    `${Math.round(nearbyHazards[0]?.distance)}м` : 
                    `${(nearbyHazards[0]?.distance/1000).toFixed(1)}км`}
                </Text>
                <Text style={styles.directionText}>
                  {warningDirection.toFixed(0)}° от севера
                </Text>
              </View>
            ) : (
              <Text style={[styles.conditionText, { color: '#4CAF50' }]}>
                Препятствий не обнаружено
              </Text>
            )}
          </View>
        </View>

        {/* Tracking Control */}
        <View style={styles.controlCard}>
          <Pressable
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
          </Pressable>
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
        <Pressable 
          style={[styles.testButton, { 
            backgroundColor: audioEnabled ? '#FF5722' : '#666' 
          }]}
          onPress={testWarning}
        >
          <Ionicons name="volume-high" size={20} color="white" />
          <Text style={styles.testButtonText}>
            🚨 ТЕСТОВОЕ ПРЕДУПРЕЖДЕНИЕ
          </Text>
        </Pressable>

        {/* Navigation Buttons */}
        <Pressable 
          style={styles.settingsNavButton}
          onPress={() => {
            console.log('Navigating to settings...');
            try {
              router.push('/settings');
            } catch (error) {
              console.error('Navigation error:', error);
              if (Platform.OS === 'web') {
                window.location.href = '/settings';
              }
            }
          }}
        >
          <Ionicons name="settings-outline" size={20} color="white" />
          <Text style={styles.settingsNavText}>Подробные настройки предупреждений</Text>
          <Ionicons name="chevron-forward" size={20} color="#888" />
        </Pressable>

        {/* Admin Panel Navigation */}
        <Pressable 
          style={[styles.settingsNavButton, { backgroundColor: '#FF9800' }]}
          onPress={() => {
            console.log('Navigating to admin panel...');
            try {
              router.push('/admin-simple');
            } catch (error) {
              console.error('Admin navigation error:', error);
              if (Platform.OS === 'web') {
                window.location.href = '/admin-simple';
              }
            }
          }}
        >
          <Ionicons name="analytics" size={20} color="white" />
          <Text style={styles.settingsNavText}>Административная панель</Text>
          <Ionicons name="chevron-forward" size={20} color="white" />
        </Pressable>
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
  webNotice: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  webNoticeText: {
    color: '#FF9800',
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
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
  // Новые стили для стрелки направления
  directionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  compassBackground: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  directionArrowLarge: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  hazardDetails: {
    marginTop: 4,
  },
  distanceText: {
    fontSize: 14,
    color: '#FF9800',
    fontWeight: '600',
    marginTop: 2,
  },
  directionText: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
});