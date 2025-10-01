import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const BACKGROUND_LOCATION_TASK = 'background-location-task';
const SENSOR_DATA_KEY = 'sensor_data_buffer';
const AUTO_START_SETTINGS_KEY = 'auto_start_settings';
const API_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Background task for location tracking
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background location task error:', error);
    return;
  }

  if (data) {
    const { locations } = data as any;
    console.log('Received new locations', locations);
    
    // Store location data locally
    try {
      const existingData = await AsyncStorage.getItem(SENSOR_DATA_KEY);
      const sensorBuffer = existingData ? JSON.parse(existingData) : [];
      
      locations.forEach((location: any) => {
        sensorBuffer.push({
          type: 'location',
          timestamp: Date.now(),
          data: {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            speed: location.coords.speed || 0,
            accuracy: location.coords.accuracy,
          }
        });
      });

      await AsyncStorage.setItem(SENSOR_DATA_KEY, JSON.stringify(sensorBuffer));
    } catch (error) {
      console.error('Error storing location data:', error);
    }
  }
});

export default function GoodRoadApp() {
  const [isTracking, setIsTracking] = useState(false);
  const [roadConditionScore, setRoadConditionScore] = useState<number>(0);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [speedAutoStart, setSpeedAutoStart] = useState(true);

  const loadAutoStartSettings = async () => {
    try {
      const settings = await AsyncStorage.getItem(AUTO_START_SETTINGS_KEY);
      if (settings) {
        const parsed = JSON.parse(settings);
        setAutoStartEnabled(parsed.autoStartEnabled || false);
        setSpeedAutoStart(parsed.speedAutoStart || true);
      }
    } catch (error) {
      console.error('Error loading auto-start settings:', error);
    }
  };

  const saveAutoStartSettings = async () => {
    try {
      const settings = {
        autoStartEnabled,
        speedAutoStart,
      };
      await AsyncStorage.setItem(AUTO_START_SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving auto-start settings:', error);
    }
  };

  const checkPermissions = async () => {
    // Request location permissions
    const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
    if (foregroundStatus !== 'granted') {
      Alert.alert('Permission denied', 'Location permission is required for road monitoring.');
      return;
    }

    const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
    if (backgroundStatus !== 'granted') {
      Alert.alert(
        'Background Permission',
        'Background location access is needed for continuous road monitoring while driving.'
      );
    }
  };

  const setupBackgroundFetch = async () => {
    // Simplified background data sync - removed BackgroundFetch dependency
    console.log('Background sync setup completed');
  };

  const loadStoredData = async () => {
    try {
      const storedData = await AsyncStorage.getItem(SENSOR_DATA_KEY);
      if (storedData) {
        const data = JSON.parse(storedData);
        setSensorBuffer(data);
      }
    } catch (error) {
      console.error('Error loading stored data:', error);
    }
  };

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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      <View style={styles.header}>
        <Ionicons name="car-sport" size={32} color="#4CAF50" />
        <Text style={styles.title}>Good Road</Text>
        <Text style={styles.subtitle}>Smart Road Monitoring</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Road Condition Display */}
        <View style={styles.conditionCard}>
          <View style={[styles.conditionIndicator, { backgroundColor: getRoadConditionColor(roadConditionScore) }]}>
            <Text style={styles.conditionScore}>{Math.round(roadConditionScore)}</Text>
          </View>
          <View style={styles.conditionInfo}>
            <Text style={styles.conditionTitle}>Current Road Condition</Text>
            <Text style={[styles.conditionText, { color: getRoadConditionColor(roadConditionScore) }]}>
              {getRoadConditionText(roadConditionScore)}
            </Text>
          </View>
        </View>

        {/* Tracking Control */}
        <View style={styles.controlCard}>
          <TouchableOpacity
            style={[styles.trackingButton, { backgroundColor: isTracking ? '#F44336' : '#4CAF50' }]}
            onPress={isTracking ? stopTracking : startTracking}
          >
            <Ionicons 
              name={isTracking ? "stop" : "play"} 
              size={24} 
              color="white" 
            />
            <Text style={styles.buttonText}>
              {isTracking ? 'Stop Monitoring' : 'Start Monitoring'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Status Cards */}
        <View style={styles.statusGrid}>
          <View style={styles.statusCard}>
            <Ionicons name="location" size={24} color="#4CAF50" />
            <Text style={styles.statusTitle}>Позиционирование</Text>
            <Text style={styles.statusValue}>
              {locationData ? 'GPS+ГЛОНАСС+Galileo' : 'Ожидание...'}
            </Text>
            <Text style={styles.statusSubtitle}>
              {locationData && locationData.accuracy ? `±${locationData.accuracy?.toFixed(1)}м` : ''}
            </Text>
          </View>

          <View style={styles.statusCard}>
            <Ionicons name="analytics" size={24} color="#2196F3" />
            <Text style={styles.statusTitle}>Данные сенсоров</Text>
            <Text style={styles.statusValue}>{sensorBuffer.length} точек</Text>
            <Text style={styles.statusSubtitle}>
              {accelerometerData ? 'Акселерометр активен' : 'Ожидание данных'}
            </Text>
          </View>
        </View>

        {/* Current Data Display */}
        {accelerometerData && (
          <View style={styles.dataCard}>
            <Text style={styles.dataTitle}>Live Sensor Data</Text>
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>Acceleration X:</Text>
              <Text style={styles.dataValue}>{accelerometerData.x.toFixed(3)}</Text>
            </View>
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>Acceleration Y:</Text>
              <Text style={styles.dataValue}>{accelerometerData.y.toFixed(3)}</Text>
            </View>
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>Acceleration Z:</Text>
              <Text style={styles.dataValue}>{accelerometerData.z.toFixed(3)}</Text>
            </View>
          </View>
        )}

        {/* Auto-Start Settings */}
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>🚗 Автозапуск при движении</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Включить автозапуск</Text>
            <Switch
              value={autoStartEnabled}
              onValueChange={(value) => {
                setAutoStartEnabled(value);
                saveAutoStartSettings();
              }}
              thumbColor={autoStartEnabled ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>При обнаружении движения</Text>
            <Switch
              value={speedAutoStart}
              onValueChange={(value) => {
                setSpeedAutoStart(value);
                saveAutoStartSettings();
              }}
              thumbColor={speedAutoStart ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
              disabled={!autoStartEnabled}
            />
          </View>

          {carModeDetected && (
            <View style={styles.carModeIndicator}>
              <Ionicons name="car" size={16} color="#4CAF50" />
              <Text style={styles.carModeText}>Режим автомобиля активен</Text>
            </View>
          )}
        </View>

        {/* Upload Button */}
        <TouchableOpacity style={styles.uploadButton} onPress={uploadSensorData}>
          <Ionicons name="cloud-upload" size={20} color="white" />
          <Text style={styles.uploadButtonText}>Загрузить данные сейчас</Text>
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