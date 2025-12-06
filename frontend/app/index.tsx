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
import AsyncStorage from '@react-native-async-storage/async-storage';

// Сервисы
import RawDataCollector from '../services/RawDataCollector';
import { useObstacleAlerts } from '../hooks/useObstacleAlerts';
import ObstacleWarningOverlay, { WarningSize, WarningPosition } from '../components/ObstacleWarningOverlay';

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
          <Ionicons name="volume-high" size={34} color="#00d4ff" />
          <Text style={styles.buttonText}>АУДИО НАСТРОЙКИ</Text>
        </Pressable>

        {/* Автозапуск */}
        <Pressable
          style={styles.button}
          onPress={() => router.push('/autostart-settings')}
        >
          <Ionicons name="flash" size={34} color="#00d4ff" />
          <Text style={styles.buttonText}>АВТОЗАПУСК</Text>
        </Pressable>

        {/* Админ панель */}
        <Pressable
          style={styles.button}
          onPress={() => router.push('/admin-simple')}
        >
          <Ionicons name="analytics" size={34} color="#00d4ff" />
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
    backgroundColor: '#0f0f23', // Более глубокий темный
  },
  header: {
    alignItems: 'center',
    paddingVertical: 32,
    borderBottomWidth: 2,
    borderBottomColor: '#1a1a3e',
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    color: '#00d4ff', // Яркий голубой
    letterSpacing: 3,
    textShadowColor: 'rgba(0, 212, 255, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#8b94a8',
    marginTop: 8,
    fontWeight: '500',
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
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: '#1a1a3e',
    borderWidth: 2,
    borderColor: '#2d2d5f',
    gap: 10,
  },
  statusBadgeActive: {
    borderColor: '#00ff88', // Яркий зеленый
    backgroundColor: '#002211',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#6b7280',
  },
  statusDotActive: {
    backgroundColor: '#00ff88',
    shadowColor: '#00ff88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  statusText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#c7cad9',
  },
  obstaclesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 150, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 150, 0, 0.3)',
    gap: 8,
  },
  obstaclesText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ff9500', // Яркий оранжевый
  },
  buttonsContainer: {
    flex: 1,
    padding: 24,
    gap: 16,
  },
  mainButton: {
    height: 130,
    backgroundColor: '#0066ff', // Яркий синий
    borderRadius: 20,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#0066ff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 12,
  },
  mainButtonActive: {
    backgroundColor: '#ff3b30', // Ярко-красный
    shadowColor: '#ff3b30',
  },
  mainButtonText: {
    fontSize: 19,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.5,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  button: {
    height: 76,
    backgroundColor: '#1a1a3e',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#00d4ff', // Яркая голубая рамка
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#00d4ff',
    letterSpacing: 1.2,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#1a1a3e',
  },
  footerText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
});
