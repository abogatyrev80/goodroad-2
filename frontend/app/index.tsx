import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Platform,
  StatusBar,
  Switch,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { router } from 'expo-router';
import { AppSettings, HazardType } from './settings';

interface Hazard {
  id: string;
  type: string;
  latitude: number;
  longitude: number;
  severity: 'low' | 'medium' | 'high';
  distance?: number;
}

const SETTINGS_KEY = 'good_road_settings';
const API_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Mock hazards for demonstration
const mockHazards: Hazard[] = [
  { id: '1', type: 'pothole', latitude: 55.7558, longitude: 37.6176, severity: 'high' },
  { id: '2', type: 'speed_bump', latitude: 55.7559, longitude: 37.6177, severity: 'medium' },
  { id: '3', type: 'pedestrian_crossing', latitude: 55.7560, longitude: 37.6178, severity: 'low' },
  { id: '4', type: 'railway_crossing', latitude: 55.7562, longitude: 37.6180, severity: 'high' },
];

export default function GoodRoadApp() {
  const [isTracking, setIsTracking] = useState(false);
  const [roadConditionScore, setRoadConditionScore] = useState<number>(75);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [speedAutoStart, setSpeedAutoStart] = useState(true);
  
  // Location and sensor data
  const [currentLocation, setCurrentLocation] = useState<Location.LocationObject | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0); // km/h
  const [currentHeading, setCurrentHeading] = useState<number>(0); // degrees
  
  // Warnings system
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeWarnings, setActiveWarnings] = useState<Hazard[]>([]);
  const [lastWarningTime, setLastWarningTime] = useState<number>(0);
  const audioRef = useRef<Audio.Sound | null>(null);
  
  // Location tracking
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    loadSettings();
    setupAudio();
    return () => {
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (isTracking && settings) {
      startLocationTracking();
    } else {
      stopLocationTracking();
    }
  }, [isTracking, settings]);

  useEffect(() => {
    if (currentLocation && settings && isTracking) {
      checkForHazards();
    }
  }, [currentLocation, settings, isTracking]);

  const startTracking = async () => {
    try {
      // Start location tracking with all available positioning systems
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        // Use highest accuracy - combines GPS, GLONASS, Galileo, BeiDou, WiFi, Cell towers
        accuracy: Location.Accuracy.BestForNavigation,
        
        // Enable all positioning systems
        enableHighAccuracy: true, // GPS + GLONASS + Galileo + BeiDou
        
        // Network-based positioning (WiFi + Cell towers)
        enableNetworkLocation: true,
        
        // Time and distance intervals
        timeInterval: 3000, // 3 seconds for better road monitoring
        distanceInterval: 5, // 5 meters for precise tracking
        deferredUpdatesInterval: 30000, // 30 seconds
        
        // Background service configuration
        foregroundService: {
          notificationTitle: 'Good Road - Мониторинг дорог',
          notificationBody: 'Отслеживание качества дорожного покрытия через GPS/ГЛОНАСС/Galileo/BeiDou...',
        },
        
        // Additional positioning options
        showsBackgroundLocationIndicator: true, // Show location indicator on iOS
        pausesLocationUpdatesAutomatically: false, // Don't pause during navigation
      });

      // Start accelerometer monitoring
      Accelerometer.setUpdateInterval(100); // 10 Hz
      Accelerometer.addListener(handleAccelerometerData);
      
      setIsTracking(true);
      Alert.alert('Tracking Started', 'Road condition monitoring is now active.');
    } catch (error) {
      console.error('Error starting tracking:', error);
      Alert.alert('Error', 'Failed to start tracking. Please try again.');
    }
  };

  const stopTracking = async () => {
    try {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      Accelerometer.removeAllListeners();
      setIsTracking(false);
      Alert.alert('Tracking Stopped', 'Road monitoring has been stopped.');
    } catch (error) {
      console.error('Error stopping tracking:', error);
    }
  };

  const handleAccelerometerData = (accelerometerData: any) => {
    setAccelerometerData(accelerometerData);
    
    // Calculate road condition score based on acceleration variance
    const totalAcceleration = Math.sqrt(
      accelerometerData.x ** 2 + 
      accelerometerData.y ** 2 + 
      accelerometerData.z ** 2
    );
    
    // Store accelerometer data locally
    const sensorPoint = {
      type: 'accelerometer',
      timestamp: Date.now(),
      data: {
        x: accelerometerData.x,
        y: accelerometerData.y,
        z: accelerometerData.z,
        totalAcceleration,
      }
    };

    // Update local buffer
    setSensorBuffer(prev => {
      const newBuffer = [...prev, sensorPoint];
      // Keep only last 1000 readings to prevent memory issues
      if (newBuffer.length > 1000) {
        newBuffer.splice(0, newBuffer.length - 1000);
      }
      
      // Store in AsyncStorage
      AsyncStorage.setItem(SENSOR_DATA_KEY, JSON.stringify(newBuffer));
      
      return newBuffer;
    });

    // Calculate road condition score (0-100, higher = better road)
    const variance = calculateAccelerationVariance(sensorBuffer.slice(-50)); // Last 50 readings
    const score = Math.max(0, Math.min(100, 100 - (variance * 1000)));
    setRoadConditionScore(score);
  };

  const calculateAccelerationVariance = (readings: any[]) => {
    if (readings.length < 2) return 0;
    
    const accelerations = readings
      .filter(r => r.type === 'accelerometer')
      .map(r => r.data.totalAcceleration);
    
    if (accelerations.length < 2) return 0;
    
    const mean = accelerations.reduce((sum, val) => sum + val, 0) / accelerations.length;
    const variance = accelerations.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / accelerations.length;
    
    return variance;
  };

  const uploadSensorData = async () => {
    try {
      const storedData = await AsyncStorage.getItem(SENSOR_DATA_KEY);
      if (!storedData) return;

      const data = JSON.parse(storedData);
      if (data.length === 0) return;

      const response = await fetch(`${API_BASE_URL}/api/sensor-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceId: 'device-' + Date.now(), // Simple device ID
          sensorData: data,
        }),
      });

      if (response.ok) {
        // Clear uploaded data
        await AsyncStorage.setItem(SENSOR_DATA_KEY, JSON.stringify([]));
        setSensorBuffer([]);
        console.log('Sensor data uploaded successfully');
      }
    } catch (error) {
      console.error('Error uploading sensor data:', error);
    }
  };

  const getRoadConditionColor = (score: number) => {
    if (score >= 80) return '#4CAF50'; // Green - Good road
    if (score >= 60) return '#FF9800'; // Orange - Fair road  
    if (score >= 40) return '#FF5722'; // Red-Orange - Poor road
    return '#F44336'; // Red - Very poor road
  };

  const getRoadConditionText = (score: number) => {
    if (score >= 80) return 'Excellent Road';
    if (score >= 60) return 'Good Road';
    if (score >= 40) return 'Fair Road';
    if (score >= 20) return 'Poor Road';
    return 'Very Poor Road';
  };

  // Helper functions
  const loadSettings = async () => {
    try {
      const storedSettings = await AsyncStorage.getItem(SETTINGS_KEY);
      if (storedSettings) {
        setSettings(JSON.parse(storedSettings));
      } else {
        // Set default settings
        const defaultSettings: AppSettings = {
          audioWarnings: true,
          vibrationWarnings: true,
          warningVolume: 0.8,
          speedThreshold: 15,
          minWarningDistance: 30,
          maxWarningDistance: 200,
          warningCooldown: 5,
          hazardTypes: [
            { id: 'pothole', name: 'Ямы', icon: 'alert-circle', enabled: true, criticalDistance: 50 },
            { id: 'speed_bump', name: 'Лежачие полицейские', icon: 'triangle', enabled: true, criticalDistance: 30 },
            { id: 'pedestrian_crossing', name: 'Пешеходные переходы', icon: 'walk', enabled: true, criticalDistance: 60 },
          ]
        };
        setSettings(defaultSettings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const setupAudio = async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
      });
    } catch (error) {
      console.error('Error setting up audio:', error);
    }
  };

  const cleanup = async () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
    }
    if (audioRef.current) {
      await audioRef.current.unloadAsync();
    }
  };

  const startLocationTracking = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Разрешение отклонено', 'Необходимо разрешение на геолокацию');
        return;
      }

      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000, // Update every 2 seconds
          distanceInterval: 5, // Update every 5 meters
        },
        (location) => {
          setCurrentLocation(location);
          setCurrentSpeed((location.coords.speed || 0) * 3.6); // Convert m/s to km/h
          if (location.coords.heading) {
            setCurrentHeading(location.coords.heading);
          }
        }
      );
    } catch (error) {
      console.error('Error starting location tracking:', error);
      Alert.alert('Ошибка', 'Не удалось запустить отслеживание геолокации');
    }
  };

  const stopLocationTracking = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const isHeadingTowards = (currentLat: number, currentLon: number, targetLat: number, targetLon: number, heading: number): boolean => {
    const bearing = Math.atan2(
      Math.sin((targetLon - currentLon) * Math.PI / 180) * Math.cos(targetLat * Math.PI / 180),
      Math.cos(currentLat * Math.PI / 180) * Math.sin(targetLat * Math.PI / 180) -
      Math.sin(currentLat * Math.PI / 180) * Math.cos(targetLat * Math.PI / 180) * Math.cos((targetLon - currentLon) * Math.PI / 180)
    ) * 180 / Math.PI;
    
    const normalizedBearing = (bearing + 360) % 360;
    const headingDiff = Math.abs(normalizedBearing - heading);
    
    return headingDiff < 45 || headingDiff > 315; // Within 45 degrees of current heading
  };

  const checkForHazards = async () => {
    if (!currentLocation || !settings) return;
    
    // Skip if speed is below threshold
    if (currentSpeed < settings.speedThreshold) {
      setActiveWarnings([]);
      return;
    }

    const { latitude, longitude } = currentLocation.coords;
    const currentTime = Date.now();
    
    // Check cooldown
    if (currentTime - lastWarningTime < settings.warningCooldown * 1000) {
      return;
    }

    const nearbyHazards: Hazard[] = [];

    // Check mock hazards (in real app, fetch from API)
    mockHazards.forEach(hazard => {
      const distance = calculateDistance(latitude, longitude, hazard.latitude, hazard.longitude);
      
      // Find hazard type settings
      const hazardType = settings.hazardTypes.find(ht => ht.id === hazard.type);
      if (!hazardType || !hazardType.enabled) return;
      
      // Check if hazard is within warning distance
      if (distance <= settings.maxWarningDistance && distance >= settings.minWarningDistance) {
        // Check if we're heading towards the hazard
        if (isHeadingTowards(latitude, longitude, hazard.latitude, hazard.longitude, currentHeading)) {
          nearbyHazards.push({ ...hazard, distance: Math.round(distance) });
        }
      }
      
      // Check critical distance
      if (distance <= hazardType.criticalDistance) {
        if (isHeadingTowards(latitude, longitude, hazard.latitude, hazard.longitude, currentHeading)) {
          triggerWarning(hazard, distance);
        }
      }
    });

    setActiveWarnings(nearbyHazards);
  };

  const triggerWarning = async (hazard: Hazard, distance: number) => {
    if (!settings) return;
    
    const hazardType = settings.hazardTypes.find(ht => ht.id === hazard.type);
    const hazardName = hazardType?.name || hazard.type;
    
    // Audio warning
    if (settings.audioWarnings) {
      try {
        // Create a simple beep sound programmatically
        const { sound } = await Audio.Sound.createAsync(
          { uri: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvGUgBSuG0O/AaykEK4nS8LljIAUug8rz0LljIAUiiM7t2o0zCWjT9yIGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvGUgBSuG0O/AaykEK4nS8LljIAUug8rz0LljIAUiiM7t2o0zC' },
          { shouldPlay: true, volume: settings.warningVolume }
        );
        audioRef.current = sound;
      } catch (error) {
        console.error('Error playing audio warning:', error);
      }
    }

    // Vibration warning  
    if (settings.vibrationWarnings) {
      Vibration.vibrate([100, 50, 100, 50, 200]);
    }

    // Visual alert
    Alert.alert(
      '⚠️ ПРЕДУПРЕЖДЕНИЕ',
      `${hazardName} через ${Math.round(distance)}м`,
      [{ text: 'OK' }],
      { cancelable: true }
    );

    setLastWarningTime(Date.now());
  };

  const getHazardIcon = (type: string): string => {
    const hazardType = settings?.hazardTypes.find(ht => ht.id === type);
    return hazardType?.icon || 'warning';
  };

  const getRoadConditionColor = (score: number) => {
    if (score >= 80) return '#4CAF50';
    if (score >= 60) return '#FF9800';
    if (score >= 40) return '#FF5722';
    return '#F44336';
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
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
        {/* Active Warnings Banner */}
        {activeWarnings.length > 0 && (
          <View style={styles.warningBanner}>
            <Ionicons name="warning" size={24} color="#FF5722" />
            <View style={styles.warningContent}>
              <Text style={styles.warningTitle}>Впереди препятствия:</Text>
              {activeWarnings.slice(0, 2).map(warning => (
                <Text key={warning.id} style={styles.warningText}>
                  <Ionicons name={getHazardIcon(warning.type) as any} size={14} />
                  {' '}{warning.distance}м
                </Text>
              ))}
            </View>
          </View>
        )}

        {/* Speed Warning */}
        {settings && currentSpeed < settings.speedThreshold && isTracking && (
          <View style={styles.speedWarningBanner}>
            <Ionicons name="speedometer" size={20} color="#FF9800" />
            <Text style={styles.speedWarningText}>
              Предупреждения отключены (скорость ниже {settings.speedThreshold} км/ч)
            </Text>
          </View>
        )}

        {/* Road Condition Display */}
        <View style={styles.conditionCard}>
          <View style={[styles.conditionIndicator, { backgroundColor: getRoadConditionColor(roadConditionScore) }]}>
            <Text style={styles.conditionScore}>{Math.round(roadConditionScore)}</Text>
          </View>
          <View style={styles.conditionInfo}>
            <Text style={styles.conditionTitle}>Качество дороги</Text>
            <Text style={[styles.conditionText, { color: getRoadConditionColor(roadConditionScore) }]}>
              {roadConditionScore >= 80 ? 'Отличная дорога' :
               roadConditionScore >= 60 ? 'Хорошая дорога' :
               roadConditionScore >= 40 ? 'Удовлетворительная' : 'Плохая дорога'}
            </Text>
          </View>
        </View>

        {/* Tracking Control */}
        <View style={styles.controlCard}>
          <TouchableOpacity
            style={[styles.trackingButton, { backgroundColor: isTracking ? '#F44336' : '#4CAF50' }]}
            onPress={() => setIsTracking(!isTracking)}
          >
            <Ionicons 
              name={isTracking ? "stop" : "play"} 
              size={24} 
              color="white" 
            />
            <Text style={styles.buttonText}>
              {isTracking ? 'Остановить мониторинг' : 'Начать мониторинг'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Status Cards */}
        <View style={styles.statusGrid}>
          <View style={styles.statusCard}>
            <Ionicons name="location" size={24} color={currentLocation ? "#4CAF50" : "#888"} />
            <Text style={styles.statusTitle}>GPS</Text>
            <Text style={styles.statusValue}>
              {currentLocation ? 'Подключен' : 'Ожидание...'}
            </Text>
            {currentLocation && (
              <Text style={styles.statusSubtitle}>
                Точность: ±{currentLocation.coords.accuracy?.toFixed(0)}м
              </Text>
            )}
          </View>

          <View style={styles.statusCard}>
            <Ionicons name="speedometer" size={24} color="#2196F3" />
            <Text style={styles.statusTitle}>Скорость</Text>
            <Text style={styles.statusValue}>{Math.round(currentSpeed)} км/ч</Text>
            <Text style={styles.statusSubtitle}>
              {settings && currentSpeed >= settings.speedThreshold ? 
                'Предупреждения активны' : 'Предупреждения отключены'}
            </Text>
          </View>
        </View>

        {/* Audio Settings Quick Toggle */}
        <View style={styles.quickSettingsCard}>
          <Text style={styles.settingsTitle}>🔊 Быстрые настройки</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Звуковые предупреждения</Text>
            <Switch
              value={settings?.audioWarnings || false}
              onValueChange={async (value) => {
                if (settings) {
                  const newSettings = { ...settings, audioWarnings: value };
                  setSettings(newSettings);
                  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
                }
              }}
              thumbColor={settings?.audioWarnings ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Вибрация</Text>
            <Switch
              value={settings?.vibrationWarnings || false}
              onValueChange={async (value) => {
                if (settings) {
                  const newSettings = { ...settings, vibrationWarnings: value };
                  setSettings(newSettings);
                  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
                }
              }}
              thumbColor={settings?.vibrationWarnings ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>
        </View>

        {/* Settings Button */}
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
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
    marginTop: 4,
  },
  content: {
    flex: 1,
    padding: 16,
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
    elevation: 2,
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
  dataCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  dataTitle: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 12,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  dataLabel: {
    fontSize: 14,
    color: '#888',
  },
  dataValue: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '500',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  uploadButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  settingsCard: {
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
  carModeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF5020',
    padding: 8,
    borderRadius: 8,
    marginTop: 12,
  },
  carModeText: {
    fontSize: 14,
    color: '#4CAF50',
    marginLeft: 8,
    fontWeight: '500',
  },
  batteryCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  batteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  batteryText: {
    fontSize: 14,
    color: '#ffffff',
    marginLeft: 12,
  },
});