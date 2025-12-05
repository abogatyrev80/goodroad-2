/**
 * Good Road App - Минималистичный интерфейс для конечных пользователей
 * Стиль: Большие кнопки, чистый дизайн
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';

// Сервисы
import RawDataCollector from '../services/RawDataCollector';
import { useObstacleAlerts } from '../hooks/useObstacleAlerts';
import ObstacleWarningOverlay from '../components/ObstacleWarningOverlay';

// Константы
const LOCATION_TASK_NAME = 'background-location-task';

export default function HomeScreen() {
  // Основные состояния
  const [isTracking, setIsTracking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<any>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);

  // Refs
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const accelerometerSubscription = useRef<any>(null);
  const rawDataCollector = useRef<RawDataCollector | null>(null);

  // Хук для препятствий
  const { obstacles, closestObstacle, obstaclesCount } = useObstacleAlerts(
    isTracking,
    currentLocation,
    currentSpeed
  );

  // Инициализация при загрузке
  useEffect(() => {
    initializeServices();
    return () => {
      cleanup();
    };
  }, []);

  const initializeServices = async () => {
    try {
      // Проверяем разрешения
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      
      if (locationStatus !== 'granted' || bgStatus !== 'granted') {
        Alert.alert(
          'Разрешения необходимы',
          'Для работы приложения нужны разрешения на GPS и фоновую работу'
        );
      }

      // Инициализируем коллектор данных
      if (!rawDataCollector.current) {
        rawDataCollector.current = new RawDataCollector(
          process.env.EXPO_PUBLIC_BACKEND_URL || 'https://road-monitor-4.emergent.host',
          'mobile-device-' + Math.random().toString(36).substr(2, 9)
        );
      }
    } catch (error) {
      console.error('Error initializing services:', error);
    }
  };

  const cleanup = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
    }
    if (accelerometerSubscription.current) {
      accelerometerSubscription.current.remove();
    }
  };

  // Начать/остановить мониторинг
  const toggleTracking = async () => {
    if (isTracking) {
      await stopTracking();
    } else {
      await startTracking();
    }
  };

  const startTracking = async () => {
    setIsLoading(true);
    try {
      // Запускаем GPS
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (location) => {
          setCurrentLocation(location);
          setCurrentSpeed((location.coords.speed || 0) * 3.6); // м/с -> км/ч
        }
      );
      locationSubscription.current = subscription;

      // Запускаем акселерометр
      Accelerometer.setUpdateInterval(100);
      const accelSubscription = Accelerometer.addListener((data) => {
        // Данные акселерометра обрабатываются в коллекторе
      });
      accelerometerSubscription.current = accelSubscription;

      setIsTracking(true);
      Alert.alert('Мониторинг запущен', 'Приложение отслеживает состояние дороги');
    } catch (error) {
      console.error('Error starting tracking:', error);
      Alert.alert('Ошибка', 'Не удалось запустить мониторинг');
    } finally {
      setIsLoading(false);
    }
  };

  const stopTracking = async () => {
    setIsLoading(true);
    try {
      if (locationSubscription.current) {
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }
      if (accelerometerSubscription.current) {
        accelerometerSubscription.current.remove();
        accelerometerSubscription.current = null;
      }

      setIsTracking(false);
      setCurrentLocation(null);
      Alert.alert('Мониторинг остановлен', 'Приложение больше не отслеживает дорогу');
    } catch (error) {
      console.error('Error stopping tracking:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />

      {/* Плавающее предупреждение о препятствии */}
      <ObstacleWarningOverlay
        obstacle={closestObstacle}
        visible={isTracking && closestObstacle !== null && closestObstacle.distance < 1000}
      />

      {/* Заголовок */}
      <View style={styles.header}>
        <Text style={styles.title}>GOOD ROAD</Text>
        <Text style={styles.subtitle}>Мониторинг качества дорог</Text>
      </View>

      {/* Статус */}
      <View style={styles.statusContainer}>
        <View style={[styles.statusBadge, isTracking && styles.statusBadgeActive]}>
          <View style={[styles.statusDot, isTracking && styles.statusDotActive]} />
          <Text style={styles.statusText}>
            {isTracking ? 'АКТИВЕН' : 'ОСТАНОВЛЕН'}
          </Text>
        </View>
        {isTracking && obstaclesCount > 0 && (
          <View style={styles.obstaclesBadge}>
            <Ionicons name="warning" size={16} color="#fbbf24" />
            <Text style={styles.obstaclesText}>{obstaclesCount} препятствий</Text>
          </View>
        )}
      </View>

      {/* Главные кнопки */}
      <View style={styles.buttonsContainer}>
        {/* Кнопка мониторинга */}
        <Pressable
          style={[
            styles.mainButton,
            isTracking && styles.mainButtonActive,
            isLoading && styles.buttonDisabled,
          ]}
          onPress={toggleTracking}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : (
            <>
              <Ionicons
                name={isTracking ? 'stop-circle' : 'play-circle'}
                size={48}
                color="#fff"
              />
              <Text style={styles.mainButtonText}>
                {isTracking ? 'ОСТАНОВИТЬ МОНИТОРИНГ' : 'НАЧАТЬ МОНИТОРИНГ'}
              </Text>
            </>
          )}
        </Pressable>

        {/* Настройки аудио */}
        <Pressable
          style={styles.button}
          onPress={() => router.push('/audio-settings')}
        >
          <Ionicons name="volume-high" size={32} color="#60a5fa" />
          <Text style={styles.buttonText}>АУДИО НАСТРОЙКИ</Text>
        </Pressable>

        {/* Автозапуск */}
        <Pressable
          style={styles.button}
          onPress={() => router.push('/autostart-settings')}
        >
          <Ionicons name="flash" size={32} color="#60a5fa" />
          <Text style={styles.buttonText}>АВТОЗАПУСК</Text>
        </Pressable>

        {/* Админ панель */}
        <Pressable
          style={styles.button}
          onPress={() => router.push('/admin-simple')}
        >
          <Ionicons name="analytics" size={32} color="#60a5fa" />
          <Text style={styles.buttonText}>СТАТИСТИКА</Text>
        </Pressable>
      </View>

      {/* Информация внизу */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>GoodRoad v2.0</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e1a',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 32,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 8,
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 24,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#334155',
    gap: 8,
  },
  statusBadgeActive: {
    borderColor: '#22c55e',
    backgroundColor: '#14532d',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#64748b',
  },
  statusDotActive: {
    backgroundColor: '#22c55e',
  },
  statusText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#94a3b8',
  },
  obstaclesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    gap: 6,
  },
  obstaclesText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fbbf24',
  },
  buttonsContainer: {
    flex: 1,
    padding: 24,
    gap: 16,
  },
  mainButton: {
    height: 120,
    backgroundColor: '#1e40af',
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  mainButtonActive: {
    backgroundColor: '#dc2626',
    borderColor: '#ef4444',
    shadowColor: '#ef4444',
  },
  mainButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1,
  },
  button: {
    height: 80,
    backgroundColor: 'transparent',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#3b82f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#60a5fa',
    letterSpacing: 1,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  footerText: {
    fontSize: 12,
    color: '#475569',
  },
});
