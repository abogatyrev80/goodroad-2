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
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import SimpleToast, { showToast } from '../components/SimpleToast';

// Сервисы
import RawDataCollector from '../services/RawDataCollector';
import { useObstacleAlerts } from '../hooks/useObstacleAlerts';
import ObstacleWarningOverlay, { WarningSize, WarningPosition } from '../components/ObstacleWarningOverlay';
import alertSettingsService from '../services/AlertSettingsService';

// Константы
const LOCATION_TASK_NAME = 'background-location-task';

export default function HomeScreen() {
  // Основные состояния
  const [isTracking, setIsTracking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<any>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  
  
  // Настройки предупреждений
  const [warningSize, setWarningSize] = useState<WarningSize>('medium');
  const [warningPosition, setWarningPosition] = useState<WarningPosition>('top');
  
  // Автозапуск/автоотключение
  const [autostartMode, setAutostartMode] = useState<string>('disabled');
  const [wasAutoStarted, setWasAutoStarted] = useState(false); // Флаг что мониторинг был запущен автоматически

  // Refs
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const accelerometerSubscription = useRef<any>(null);
  const rawDataCollector = useRef<RawDataCollector | null>(null);
  const batterySubscription = useRef<any>(null);
  const dataCollectionInterval = useRef<NodeJS.Timeout | null>(null);
  
  // Буферы для сбора данных
  const accelerometerBuffer = useRef<Array<{ x: number; y: number; z: number; timestamp: number }>>([]);
  const syncedDataBuffer = useRef<Array<{
    timestamp: number;
    gps: any;
    accelerometerData: Array<{ x: number; y: number; z: number; timestamp: number }>;
  }>>([]);
  const currentLocationRef = useRef<any>(null);

  // Хук для препятствий
  const { obstacles, closestObstacle, obstaclesCount, refetchObstacles } = useObstacleAlerts(
    isTracking,
    currentLocation,
    currentSpeed
  );

  // Инициализация при загрузке
  useEffect(() => {
    initializeServices();
    alertSettingsService.initialize(); // 🆕 Инициализация настроек предупреждений
    return () => {
      cleanup();
    };
  }, []);

  // Проверка автозапуска
  useEffect(() => {
    checkAutostart();
  }, []);

  // Предупреждение о разрядке батареи (параллельная функция)
  useEffect(() => {
    if (!isTracking) return;
    
    // Отслеживание состояния зарядки во время активного мониторинга
    const subscription = Battery.addBatteryStateListener(async ({ batteryState }) => {
      console.log('🔋 Battery state changed:', batteryState);
      
      // ✅ ИСПРАВЛЕНО: Проверяем уровень батареи для обработки ограничения 80%
      const batteryLevel = await Battery.getBatteryLevelAsync();
      const batteryPercent = Math.round(batteryLevel * 100);
      console.log(`🔋 Battery level: ${batteryPercent}%`);
      
      // Если отключили от зарядки во время мониторинга - предупреждаем
      // НО: Игнорируем если уровень > 75% (вероятно ограничение Андройд 80%)
      const isReallyUnplugged = batteryState !== Battery.BatteryState.CHARGING && 
                                 batteryState !== Battery.BatteryState.FULL &&
                                 batteryPercent < 75; // < 75% = реально отключено
      
      if (isReallyUnplugged) {
        console.log(`⚠️ Warning - device unplugged during monitoring (${batteryPercent}%)`);
        Alert.alert(
          '⚠️ Зарядка отключена',
          `Мониторинг дороги активен и расходует больше энергии. Уровень батареи: ${batteryPercent}%\n\nТелефон может быстро разрядиться. Вы можете остановить мониторинг вручную, если это необходимо.`,
          [
            {
              text: 'Продолжить мониторинг',
              style: 'cancel',
            },
            {
              text: 'Остановить',
              style: 'destructive',
              onPress: () => {
                stopTracking();
              },
            },
          ]
        );
      } else if (batteryPercent >= 75) {
        // Уровень > 75% и не заряжается = вероятно ограничение 80%
        console.log(`✅ Battery at ${batteryPercent}% (likely 80% limit) - no warning`);
      } else {
        // Подключили зарядку - можно показать позитивное уведомление
        console.log(`✅ Device plugged in - battery charging (${batteryPercent}%)`);
      }
    });
    
    batterySubscription.current = subscription;
    
    return () => {
      if (batterySubscription.current) {
        batterySubscription.current.remove();
        batterySubscription.current = null;
      }
    };
  }, [isTracking]);

  const checkAutostart = async () => {
    try {
      const mode = await AsyncStorage.getItem('autostart_mode');
      setAutostartMode(mode || 'disabled');
      console.log('🚀 Autostart mode:', mode);

      if (mode === 'onCharge' && !isTracking) {
        // Проверяем подключена ли зарядка
        const batteryState = await Battery.getBatteryStateAsync();
        const isCharging = batteryState === Battery.BatteryState.CHARGING;
        
        if (isCharging) {
          console.log('🚀 Auto-starting monitoring - device is charging...');
          setTimeout(() => {
            startTracking();
            setWasAutoStarted(true);
          }, 1000);
        }
      }
      // TODO: Добавить проверку для режимов withApps и onBluetooth
      // Потребуется интеграция с нативными API для отслеживания запущенных приложений
    } catch (error) {
      console.error('Error checking autostart:', error);
    }
  };

  const initializeServices = async () => {
    try {
      // Проверяем разрешения
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      
      if (locationStatus !== 'granted' || bgStatus !== 'granted') {
        showToast('error', '⚠️ Разрешения необходимы', 'Для работы приложения нужны разрешения на GPS и фоновую работу', 5000);
      }

      // Инициализируем коллектор данных
      if (!rawDataCollector.current) {
        const deviceId = 'mobile-app-' + Date.now();
        const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://road-monitor-4.emergent.host';
        rawDataCollector.current = new RawDataCollector(
          deviceId,
          backendUrl,
          (warnings) => {
            console.log('⚠️ Received warnings from backend:', warnings);
          }
        );
        console.log('🔧 RawDataCollector initialized with:', { deviceId, backendUrl });
      }

      // Загружаем настройки предупреждений
      await loadWarningSettings();
    } catch (error) {
      console.error('Error initializing services:', error);
    }
  };

  const loadWarningSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem('warning_settings');
      if (saved) {
        const settings = JSON.parse(saved);
        setWarningSize(settings.size || 'medium');
        setWarningPosition(settings.position || 'top');
        console.log('📐 Loaded warning settings:', settings);
      }
    } catch (error) {
      console.error('Error loading warning settings:', error);
    }
  };

  const cleanup = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
    }
    if (accelerometerSubscription.current) {
      accelerometerSubscription.current.remove();
    }
    if (dataCollectionInterval.current) {
      clearTimeout(dataCollectionInterval.current);
    }
    if (batterySubscription.current) {
      batterySubscription.current.remove();
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
          currentLocationRef.current = location; // Сохраняем в ref для использования в интервале
          setCurrentSpeed((location.coords.speed || 0) * 3.6); // м/с -> км/ч
        }
      );
      locationSubscription.current = subscription;
      console.log('✅ GPS tracking started');

      // Запускаем акселерометр (10 Hz)
      Accelerometer.setUpdateInterval(100);
      const accelSubscription = Accelerometer.addListener((data) => {
        // Накапливаем данные в буфер с временной меткой
        accelerometerBuffer.current.push({
          x: data.x,
          y: data.y,
          z: data.z,
          timestamp: Date.now()
        });
        
        // Ограничиваем размер буфера (максимум 100 значений = 10 секунд при 10Hz)
        if (accelerometerBuffer.current.length > 100) {
          accelerometerBuffer.current.shift();
        }
      });
      accelerometerSubscription.current = accelSubscription;
      console.log('✅ Accelerometer started (10 Hz)');

      // 🆕 Интервал для сбора и отправки синхронизированных пакетов данных
      const collectSyncedPacket = () => {
        if (currentLocationRef.current && rawDataCollector.current) {
          // Берем snapshot акселерометра за последнюю секунду
          const accelerometerSnapshot = [...accelerometerBuffer.current];
          
          // Очищаем буфер для следующей секунды
          accelerometerBuffer.current = [];
          
          // Создаем синхронизированный пакет
          const syncedPacket = {
            timestamp: Date.now(),
            gps: currentLocationRef.current,
            accelerometerData: accelerometerSnapshot
          };
          
          // Добавляем в буфер пакетов
          syncedDataBuffer.current.push(syncedPacket);
          
          console.log(`📦 Пакет собран: ${accelerometerSnapshot.length} точек акселерометра, буфер: ${syncedDataBuffer.current.length}/5`);
          
          // Отправляем батч когда накопится 5 пакетов (= 5 секунд данных)
          if (syncedDataBuffer.current.length >= 5) {
            console.log(`📤 Отправка батча из ${syncedDataBuffer.current.length} пакетов`);
            
            // Отправляем все пакеты
            syncedDataBuffer.current.forEach(packet => {
              rawDataCollector.current?.addDataPoint(
                packet.gps,
                packet.accelerometerData,
                packet.timestamp
              );
            });
            
            // Очищаем буфер после отправки
            syncedDataBuffer.current = [];
          }
          
          // Повторяем каждую секунду
          dataCollectionInterval.current = setTimeout(collectSyncedPacket, 1000);
        } else {
          // Если GPS еще не готов, повторяем попытку
          console.log('⏳ Ожидание GPS сигнала...');
          dataCollectionInterval.current = setTimeout(collectSyncedPacket, 1000);
        }
      };
      
      // Запускаем первый цикл с задержкой
      dataCollectionInterval.current = setTimeout(collectSyncedPacket, 2000);

      setIsTracking(true);
      showToast('success', '✅ Мониторинг запущен', 'Приложение отслеживает состояние дороги', 3000);
    } catch (error) {
      console.error('Error starting tracking:', error);
      showToast('error', '❌ Ошибка', 'Не удалось запустить мониторинг', 3000);
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
      if (batterySubscription.current) {
        batterySubscription.current.remove();
        batterySubscription.current = null;
      }
      if (dataCollectionInterval.current) {
        clearTimeout(dataCollectionInterval.current);
        dataCollectionInterval.current = null;
      }

      // Очищаем буферы
      accelerometerBuffer.current = [];
      syncedDataBuffer.current = [];
      currentLocationRef.current = null;

      setIsTracking(false);
      setCurrentLocation(null);
      setWasAutoStarted(false); // Сбрасываем флаг автозапуска
      showToast('info', '⏹️ Мониторинг остановлен', 'Приложение больше не отслеживает дорогу', 3000);
      console.log('✅ Tracking stopped and buffers cleared');
    } catch (error) {
      console.error('Error stopping tracking:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Ручная отметка препятствия
  const reportObstacle = async () => {
    if (!currentLocation) {
      showToast('warning', '⚠️ Нет GPS', 'Невозможно определить местоположение', 3000);
      return;
    }

    try {
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
      
      // Отправляем ручную отметку на сервер
      const response = await fetch(`${backendUrl}/api/raw-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: rawDataCollector.current?.deviceId || 'manual-report',
          data: [{
            deviceId: rawDataCollector.current?.deviceId || 'manual-report',
            timestamp: Date.now(),
            gps: {
              latitude: currentLocation.coords.latitude,
              longitude: currentLocation.coords.longitude,
              speed: currentLocation.coords.speed || 0,
              accuracy: currentLocation.coords.accuracy || 0,
              altitude: currentLocation.coords.altitude || 0,
            },
            accelerometer: [
              { x: 0, y: 0, z: 1.0, timestamp: Date.now() }
            ],
            userReported: true,
            eventType: 'pothole', // По умолчанию "яма", можно расширить выбором
            severity: 2,
          }]
        }),
      });

      if (response.ok) {
        showToast('success', '✅ Препятствие отмечено', 'Спасибо за вклад в безопасность дорог!', 3000);
      } else {
        throw new Error('Server error');
      }
    } catch (error) {
      console.error('Error reporting obstacle:', error);
      showToast('error', '❌ Ошибка', 'Не удалось отметить препятствие', 3000);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />

      {/* Плавающее предупреждение о препятствии */}
      <ObstacleWarningOverlay
        obstacle={closestObstacle}
        visible={
          isTracking && 
          closestObstacle !== null && 
          closestObstacle.distance < 1000 && 
          currentSpeed > 1 // 🆕 Показываем только если движемся (>1 м/с ≈ 3.6 км/ч)
        }
        size={warningSize}
        position={warningPosition}
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
      <ScrollView 
        style={styles.buttonsContainer} 
        contentContainerStyle={styles.buttonsContainerContent}
        showsVerticalScrollIndicator={false}
      >
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

        {/* 🆕 Обновить предупреждения */}
        {isTracking && (
          <Pressable
            style={[styles.compactButton, styles.refreshButton]}
            onPress={() => {
              refetchObstacles();
              showToast('success', '🔄 Обновлено', 'Предупреждения обновлены', 2000);
            }}
          >
            <Ionicons name="refresh" size={24} color="#fbbf24" />
            <Text style={styles.compactButtonText}>ОБНОВИТЬ</Text>
          </Pressable>
        )}

        {/* ⚡ АВТОЗАПУСК */}
        <Pressable
          style={[styles.compactButton, styles.autostartButton]}
          onPress={() => router.push('/autostart-settings')}
        >
          <View style={styles.buttonContent}>
            <Ionicons name="flash" size={28} color="#fbbf24" />
            <View style={styles.buttonTextContainer}>
              <Text style={[styles.compactButtonText, styles.autostartButtonText]}>АВТОЗАПУСК</Text>
              <Text style={styles.buttonSubtext}>Bluetooth / CarPlay</Text>
            </View>
          </View>
        </Pressable>

        {/* 🔊 АУДИО НАСТРОЙКИ */}
        <Pressable
          style={[styles.compactButton, styles.audioSettingsButton]}
          onPress={() => router.push('/audio-settings')}
        >
          <View style={styles.buttonContent}>
            <Ionicons name="volume-high" size={28} color="#00d4ff" />
            <View style={styles.buttonTextContainer}>
              <Text style={[styles.compactButtonText, styles.audioSettingsButtonText]}>АУДИО НАСТРОЙКИ</Text>
              <Text style={styles.buttonSubtext}>Звуки, озвучка, логика</Text>
            </View>
          </View>
        </Pressable>

        {/* Визуальные оповещения */}
        <Pressable
          style={styles.compactButton}
          onPress={() => router.push('/warning-settings')}
        >
          <Ionicons name="eye" size={24} color="#00d4ff" />
          <Text style={styles.compactButtonText}>ВИЗУАЛЬНЫЕ КАРТОЧКИ</Text>
        </Pressable>

        {/* Ручная отметка препятствия */}
        <Pressable
          style={[styles.button, styles.reportButton]}
          onPress={reportObstacle}
          disabled={!currentLocation}
        >
          <Ionicons name="alert-circle" size={34} color="#ff3b30" />
          <Text style={[styles.buttonText, styles.reportButtonText]}>
            ОТМЕТИТЬ ПРЕПЯТСТВИЕ
          </Text>
        </Pressable>

        {/* Админ панель */}
        <Pressable
          style={styles.button}
          onPress={() => router.push('/admin-simple')}
        >
          <Ionicons name="analytics" size={34} color="#00d4ff" />
          <Text style={styles.buttonText}>СТАТИСТИКА</Text>
        </Pressable>

        {/* Информация внизу */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>GoodRoad v2.0</Text>
        </View>
      </ScrollView>
      
      {/* Toast notifications */}
      <SimpleToast />
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
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#1a1a3e',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#00d4ff', // Яркий голубой
    letterSpacing: 2,
    textShadowColor: 'rgba(0, 212, 255, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  subtitle: {
    fontSize: 12,
    color: '#8b94a8',
    marginTop: 4,
    fontWeight: '500',
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1a1a3e',
    borderWidth: 2,
    borderColor: '#2d2d5f',
    gap: 8,
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
    fontSize: 13,
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
  },
  buttonsContainerContent: {
    padding: 16,
    paddingBottom: 16,
    flexGrow: 1,
  },
  mainButton: {
    height: 110,
    backgroundColor: '#0066ff', // Яркий синий
    borderRadius: 16,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
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
    fontSize: 17,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.2,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  button: {
    height: 68,
    backgroundColor: '#1a1a3e',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#00d4ff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },
  compactButton: {
    minHeight: 56,
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#00d4ff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    marginBottom: 12,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  buttonTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#00d4ff',
    letterSpacing: 1,
  },
  compactButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#00d4ff',
    letterSpacing: 0.6,
  },
  buttonSubtext: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
  },
  autostartButton: {
    borderColor: '#fbbf24',
    backgroundColor: 'rgba(251, 191, 36, 0.15)', // Более яркий фон
    borderWidth: 3, // Толще рамка
  },
  autostartButtonText: {
    color: '#fbbf24',
    fontSize: 16, // Крупнее текст
  },
  audioSettingsButton: {
    borderColor: '#00d4ff',
    backgroundColor: 'rgba(0, 212, 255, 0.15)', // Более яркий фон
    borderWidth: 3, // Толще рамка
    minHeight: 70, // Компактная высота
  },
  audioSettingsButtonText: {
    color: '#00d4ff',
    fontSize: 16, // Крупнее текст
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  refreshButton: {
    borderColor: '#fbbf24', // Желтая рамка для кнопки обновления
    backgroundColor: 'rgba(251, 191, 36, 0.1)', // Слегка желтоватый фон
  },
  reportButton: {
    borderColor: '#ff3b30', // Красная рамка для кнопки отчета
    backgroundColor: 'rgba(255, 59, 48, 0.1)', // Слегка красноватый фон
  },
  reportButtonText: {
    color: '#ff3b30', // Красный текст
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a3e',
    marginTop: 8,
  },
  footerText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
});
