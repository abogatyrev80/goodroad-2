/**
 * Good Road App - Новая архитектура
 * 
 * Избыточный сбор данных + серверная классификация
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  StatusBar,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import Constants from 'expo-constants';
import * as Network from 'expo-network';

// Новые сервисы
import RawDataCollector, { Warning } from '../services/RawDataCollector';
import WarningAlert from '../components/WarningAlert';

export default function GoodRoadApp() {
  // Состояние приложения
  const [isTracking, setIsTracking] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<Location.LocationObject | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [gpsAccuracy, setGpsAccuracy] = useState(0);
  const [accelerometerData, setAccelerometerData] = useState({ x: 0, y: 0, z: 0 });
  const [isOnline, setIsOnline] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // Статистика
  const [dataPointsCollected, setDataPointsCollected] = useState(0);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  
  // Refs для управления ресурсами
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const accelerometerSubscription = useRef<any>(null);
  const dataCollectionInterval = useRef<NodeJS.Timeout | null>(null);
  const rawDataCollector = useRef<RawDataCollector | null>(null);
  
  // Backend URL
  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 
                     Constants.expoConfig?.extra?.backendUrl ||
                     'https://potholefinder.preview.emergentagent.com';
  
  // Device ID
  const deviceId = `mobile-app-${Date.now()}`;
  
  // Проверка сети
  useEffect(() => {
    const checkNetwork = async () => {
      try {
        const networkState = await Network.getNetworkStateAsync();
        setIsOnline(networkState.isConnected || false);
      } catch (error) {
        console.error('Network check error:', error);
      }
    };
    
    checkNetwork();
    const interval = setInterval(checkNetwork, 5000);
    return () => clearInterval(interval);
  }, []);
  
  // Инициализация RawDataCollector
  useEffect(() => {
    if (!rawDataCollector.current) {
      rawDataCollector.current = new RawDataCollector(
        deviceId,
        backendUrl,
        handleWarningsReceived
      );
    }
  }, []);
  
  // Обработка предупреждений от сервера
  const handleWarningsReceived = (newWarnings: Warning[]) => {
    console.log(`⚠️  Получены предупреждения: ${newWarnings.length}`);
    setWarnings(prev => [...prev, ...newWarnings]);
  };
  
  // Отклонение предупреждения
  const handleDismissWarning = async (warningId: string) => {
    setWarnings(prev => prev.filter(w => w.id !== warningId));
    
    if (rawDataCollector.current) {
      await rawDataCollector.current.dismissWarning(warningId);
    }
  };
  
  // Запрос разрешений
  const requestPermissions = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        alert('Для работы приложения необходим доступ к геолокации');
        return false;
      }
      
      console.log('✅ Location permissions granted');
      return true;
    } catch (error) {
      console.error('Permission request error:', error);
      return false;
    }
  };
  
  // Старт отслеживания
  const startTracking = async () => {
    if (Platform.OS === 'web') {
      alert('Мобильные сенсоры недоступны в веб-версии');
      return;
    }
    
    setIsLoading(true);
    
    const hasPermissions = await requestPermissions();
    if (!hasPermissions) {
      setIsLoading(false);
      return;
    }
    
    try {
      // Подписка на GPS
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 1,
        },
        (location) => {
          setCurrentLocation(location);
          setCurrentSpeed(location.coords.speed ? location.coords.speed * 3.6 : 0);
          setGpsAccuracy(location.coords.accuracy || 0);
        }
      );
      
      // Подписка на акселерометр
      Accelerometer.setUpdateInterval(100); // 10 Hz
      accelerometerSubscription.current = Accelerometer.addListener((data) => {
        setAccelerometerData(data);
      });
      
      // Запуск динамического сбора данных (частота зависит от скорости)
      const startDynamicCollection = () => {
        if (currentLocation && rawDataCollector.current) {
          rawDataCollector.current.addDataPoint(currentLocation, accelerometerData);
          setDataPointsCollected(prev => prev + 1);
          
          // Вычисляем новый интервал на основе текущей скорости
          const nextInterval = rawDataCollector.current.getCollectionInterval(currentSpeed);
          
          // Перезапускаем таймер с новым интервалом
          dataCollectionInterval.current = setTimeout(startDynamicCollection, nextInterval);
        }
      };
      
      // Запускаем первый цикл
      startDynamicCollection();
      
      setIsTracking(true);
      console.log('✅ Отслеживание запущено');
      
    } catch (error) {
      console.error('Error starting tracking:', error);
      alert('Ошибка запуска отслеживания');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Остановка отслеживания
  const stopTracking = async () => {
    setIsLoading(true);
    
    try {
      // Принудительная отправка данных
      if (rawDataCollector.current) {
        await rawDataCollector.current.forceSend();
      }
      
      // Остановка подписок
      if (locationSubscription.current) {
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }
      
      if (accelerometerSubscription.current) {
        accelerometerSubscription.current.remove();
        accelerometerSubscription.current = null;
      }
      
      if (dataCollectionInterval.current) {
        clearTimeout(dataCollectionInterval.current);
        dataCollectionInterval.current = null;
      }
      
      setIsTracking(false);
      console.log('✅ Отслеживание остановлено');
      
    } catch (error) {
      console.error('Error stopping tracking:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Cleanup при размонтировании
  useEffect(() => {
    return () => {
      if (isTracking) {
        stopTracking();
      }
    };
  }, []);
  
  // Кнопка сообщить об аварии
  const reportAccident = async () => {
    if (!currentLocation) {
      alert('GPS данные недоступны');
      return;
    }
    
    try {
      // Отправляем через новый endpoint /api/raw-data с меткой userReported
      const accidentData = {
        deviceId: deviceId,
        data: [{
          deviceId: deviceId,
          timestamp: Date.now(),
          gps: {
            latitude: currentLocation.coords.latitude,
            longitude: currentLocation.coords.longitude,
            speed: currentSpeed,
            accuracy: gpsAccuracy,
            altitude: currentLocation.coords.altitude,
          },
          accelerometer: {
            x: accelerometerData.x,
            y: accelerometerData.y,
            z: accelerometerData.z,
          },
          // Специальная метка для аварии
          userReported: true,
          eventType: 'accident',
          severity: 1,
        }]
      };
      
      console.log('📢 Отправка сообщения об аварии...');
      
      const response = await fetch(`${backendUrl}/api/raw-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accidentData),
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Авария зарегистрирована:', result);
        alert('✅ Авария зарегистрирована');
      } else {
        const errorText = await response.text();
        console.error('❌ Ошибка отправки:', response.status, errorText);
        alert(`❌ Ошибка отправки: ${response.status}`);
      }
    } catch (error) {
      console.error('Error reporting accident:', error);
      alert('❌ Ошибка соединения');
    }
  };
  
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoIcon}>🛣️</Text>
          </View>
          <View>
            <Text style={styles.headerTitle}>Good Road</Text>
            <Text style={styles.headerSubtitle}>Новая архитектура</Text>
          </View>
        </View>
        
        <View style={styles.headerRight}>
          <Pressable onPress={() => router.push('/settings')} style={styles.iconButton}>
            <Ionicons name="settings-outline" size={24} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={() => router.push('/admin-simple')} style={styles.iconButton}>
            <Ionicons name="analytics-outline" size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
      
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        
        {/* Предупреждения */}
        {warnings.length > 0 && (
          <View style={styles.warningsContainer}>
            {warnings.map(warning => (
              <WarningAlert
                key={warning.id}
                warning={warning}
                onDismiss={handleDismissWarning}
              />
            ))}
          </View>
        )}
        
        {/* Кнопка "Сообщить об аварии" */}
        <Pressable
          style={[styles.accidentButton, !currentLocation && styles.buttonDisabled]}
          onPress={reportAccident}
          disabled={!currentLocation}
        >
          <Ionicons name="warning" size={24} color="#FFFFFF" />
          <Text style={styles.accidentButtonText}>Сообщить об аварии</Text>
        </Pressable>
        
        {/* GPS Status */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="location" size={24} color="#4CAF50" />
            <Text style={styles.cardTitle}>GPS Статус</Text>
          </View>
          
          {currentLocation ? (
            <View style={styles.cardContent}>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Координаты:</Text>
                <Text style={styles.statValue}>
                  {currentLocation.coords.latitude.toFixed(6)}, {currentLocation.coords.longitude.toFixed(6)}
                </Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Скорость:</Text>
                <Text style={styles.statValue}>{currentSpeed.toFixed(1)} км/ч</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Точность:</Text>
                <Text style={styles.statValue}>±{gpsAccuracy.toFixed(1)}м</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.noDataText}>Ожидание GPS сигнала...</Text>
          )}
        </View>
        
        {/* Акселерометр */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="speedometer" size={24} color="#2196F3" />
            <Text style={styles.cardTitle}>Акселерометр</Text>
          </View>
          
          <View style={styles.cardContent}>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>X:</Text>
              <Text style={styles.statValue}>{accelerometerData.x.toFixed(3)}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Y:</Text>
              <Text style={styles.statValue}>{accelerometerData.y.toFixed(3)}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Z:</Text>
              <Text style={styles.statValue}>{accelerometerData.z.toFixed(3)}</Text>
            </View>
          </View>
        </View>
        
        {/* Статистика сбора данных */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="stats-chart" size={24} color="#FF9800" />
            <Text style={styles.cardTitle}>Сбор данных</Text>
          </View>
          
          <View style={styles.cardContent}>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Собрано точек:</Text>
              <Text style={styles.statValue}>{dataPointsCollected}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Частота сбора:</Text>
              <Text style={styles.statValue}>
                {rawDataCollector.current 
                  ? `${(rawDataCollector.current.getCollectionInterval(currentSpeed) / 1000).toFixed(1)}с`
                  : '-'}
              </Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Сеть:</Text>
              <View style={styles.networkStatus}>
                <View style={[styles.statusDot, isOnline ? styles.statusOnline : styles.statusOffline]} />
                <Text style={styles.statValue}>{isOnline ? 'Online' : 'Offline'}</Text>
              </View>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Буфер:</Text>
              <Text style={styles.statValue}>
                {rawDataCollector.current?.getStats().bufferSize || 0} / 5
              </Text>
            </View>
          </View>
        </View>
        
      </ScrollView>
      
      {/* Главная кнопка */}
      <View style={styles.footer}>
        <Pressable
          style={[
            styles.mainButton,
            isTracking && styles.mainButtonActive,
            isLoading && styles.buttonDisabled,
          ]}
          onPress={isTracking ? stopTracking : startTracking}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="large" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons
                name={isTracking ? 'stop-circle' : 'play-circle'}
                size={32}
                color="#FFFFFF"
              />
              <Text style={styles.mainButtonText}>
                {isTracking ? 'Остановить мониторинг' : 'Начать мониторинг'}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1E1E1E',
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2C2C2C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoIcon: {
    fontSize: 28,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#888888',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2C2C2C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  warningsContainer: {
    marginBottom: 16,
  },
  accidentButton: {
    backgroundColor: '#FF3B30',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  accidentButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333333',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cardContent: {
    gap: 12,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 14,
    color: '#AAAAAA',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  networkStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusOnline: {
    backgroundColor: '#4CAF50',
  },
  statusOffline: {
    backgroundColor: '#FF5252',
  },
  noDataText: {
    color: '#888888',
    fontSize: 14,
    fontStyle: 'italic',
  },
  footer: {
    padding: 16,
    paddingBottom: 24,
    backgroundColor: '#1E1E1E',
    borderTopWidth: 1,
    borderTopColor: '#333333',
  },
  mainButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  mainButtonActive: {
    backgroundColor: '#FF5252',
    shadowColor: '#FF5252',
  },
  mainButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
