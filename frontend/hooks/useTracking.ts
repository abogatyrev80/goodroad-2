import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SimpleToast, { showToast } from '../components/SimpleToast';
import RawDataCollector from '../services/RawDataCollector';
import { useBrightnessControl } from './useBrightnessControl';

export function useTracking() {
  const [isTracking, setIsTracking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<any>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const accelerometerSubscription = useRef<any>(null);
  const rawDataCollector = useRef<RawDataCollector | null>(null);
  const batterySubscription = useRef<any>(null);
  const dataCollectionInterval = useRef<NodeJS.Timeout | null>(null);
  const accelerometerBuffer = useRef<Array<{ x: number; y: number; z: number; timestamp: number }>>([]);
  const syncedDataBuffer = useRef<Array<{
    timestamp: number;
    gps: any;
    accelerometerData: Array<{ x: number; y: number; z: number; timestamp: number }>;
  }>>([]);
  const currentLocationRef = useRef<any>(null);
  const isTrackingRef = useRef(false);

  const deviceIdRef = useRef<string>('');

  const { applyMinBrightness, restoreBrightness, forceRestoreOnUnmount } = useBrightnessControl();

  useEffect(() => {
    isTrackingRef.current = isTracking;
  }, [isTracking]);

  useEffect(() => {
    return () => {
      cleanup();
      forceRestoreOnUnmount();
    };
  }, []);

  const initializeServices = useCallback(async () => {
    try {
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      let bgStatus: string = 'granted';
      if (Platform.OS !== 'web') {
        const { status } = await Location.requestBackgroundPermissionsAsync();
        bgStatus = status;
      }
      if (locationStatus !== 'granted' || bgStatus !== 'granted') {
        showToast('error', '⚠️ Разрешения необходимы', 'Для работы приложения нужны разрешения на GPS и фоновую работу', 5000);
      }

      if (!rawDataCollector.current) {
        deviceIdRef.current = 'mobile-app-' + Date.now();
        const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://goodroad.su';
        rawDataCollector.current = new RawDataCollector(
          deviceIdRef.current,
          backendUrl,
          (warnings) => {
            console.log('⚠️ Received warnings from backend:', warnings);
          }
        );
        console.log('🔧 RawDataCollector initialized with:', { deviceId: deviceIdRef.current, backendUrl });
      }
    } catch (error) {
      console.error('Error initializing services:', error);
    }
  }, []);

  const cleanup = useCallback(() => {
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
    if (batterySubscription.current) {
      batterySubscription.current.remove();
      batterySubscription.current = null;
    }
  }, []);

  const startTracking = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    setIsLoading(true);
    try {
      if (isTrackingRef.current) {
        setIsLoading(false);
        return;
      }
      const alreadyActive = await AsyncStorage.getItem('is_tracking_active');
      if (alreadyActive === 'true') {
        if (!locationSubscription.current) {
          await AsyncStorage.removeItem('is_tracking_active');
        } else {
          setIsLoading(false);
          return;
        }
      }
      await AsyncStorage.setItem('is_tracking_active', 'true');

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 500,
          distanceInterval: 0,
        },
        (location) => {
          setCurrentLocation(location);
          currentLocationRef.current = location;
          setCurrentSpeed((location.coords.speed || 0) * 3.6);
        }
      );
      locationSubscription.current = subscription;

      if (Platform.OS !== 'web') {
        Accelerometer.setUpdateInterval(100);
        const accelSubscription = Accelerometer.addListener((data) => {
          accelerometerBuffer.current.push({
            x: data.x,
            y: data.y,
            z: data.z,
            timestamp: Date.now()
          });
          if (accelerometerBuffer.current.length > 100) {
            accelerometerBuffer.current.shift();
          }
        });
        accelerometerSubscription.current = accelSubscription;
      }

      const collectSyncedPacket = () => {
        if (currentLocationRef.current && rawDataCollector.current) {
          const accelerometerSnapshot = [...accelerometerBuffer.current];
          accelerometerBuffer.current = [];

          const syncedPacket = {
            timestamp: Date.now(),
            gps: currentLocationRef.current,
            accelerometerData: accelerometerSnapshot
          };

          syncedDataBuffer.current.push(syncedPacket);
          console.log(`📦 Пакет собран: ${accelerometerSnapshot.length} точек акселерометра, буфер: ${syncedDataBuffer.current.length}/5`);

          if (syncedDataBuffer.current.length >= 5) {
            console.log(`📤 Отправка батча из ${syncedDataBuffer.current.length} пакетов`);
            syncedDataBuffer.current.forEach(packet => {
              rawDataCollector.current?.addDataPoint(
                packet.gps,
                packet.accelerometerData,
                packet.timestamp
              );
            });
            syncedDataBuffer.current = [];
          }

          dataCollectionInterval.current = setTimeout(collectSyncedPacket, 1000);
        } else {
          console.log('⏳ Ожидание GPS сигнала...');
          dataCollectionInterval.current = setTimeout(collectSyncedPacket, 1000);
        }
      };

      dataCollectionInterval.current = setTimeout(collectSyncedPacket, 2000);

      setIsTracking(true);
      isTrackingRef.current = true;

      await applyMinBrightness();

      if (!silent) {
        showToast('success', '✅ Мониторинг запущен', 'Приложение отслеживает состояние дороги', 3000);
      }
    } catch (error) {
      console.error('Error starting tracking:', error);
      showToast('error', '❌ Ошибка', 'Не удалось запустить мониторинг', 3000);
    } finally {
      setIsLoading(false);
    }
  }, [applyMinBrightness]);

  const stopTracking = useCallback(async () => {
    setIsLoading(true);
    try {
      try {
        await rawDataCollector.current?.forceSend();
      } catch (e) {
        console.warn('forceSend при остановке:', e);
      }

      await AsyncStorage.removeItem('is_tracking_active');

      cleanup();

      accelerometerBuffer.current = [];
      syncedDataBuffer.current = [];
      currentLocationRef.current = null;

      setIsTracking(false);
      isTrackingRef.current = false;
      setCurrentLocation(null);

      await restoreBrightness();

      showToast('info', '⏹️ Мониторинг остановлен', 'Приложение больше не отслеживает дорогу', 3000);
    } catch (error) {
      console.error('Error stopping tracking:', error);
    } finally {
      setIsLoading(false);
    }
  }, [cleanup, restoreBrightness]);

  const toggleTracking = useCallback(async () => {
    if (isTracking) {
      await stopTracking();
    } else {
      await startTracking();
    }
  }, [isTracking, startTracking, stopTracking]);

  const reportObstacle = useCallback(async () => {
    if (!currentLocation) {
      showToast('info', '⚠️ Нет GPS', 'Невозможно определить местоположение', 3000);
      return;
    }

    try {
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

      const response = await fetch(`${backendUrl}/api/raw-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: deviceIdRef.current || 'manual-report',
          data: [{
            deviceId: deviceIdRef.current || 'manual-report',
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
            eventType: 'pothole',
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
  }, [currentLocation]);

  return {
    isTracking,
    isLoading,
    currentLocation,
    currentSpeed,
    currentLocationRef,
    isTrackingRef,
    rawDataCollector,
    startTracking,
    stopTracking,
    toggleTracking,
    initializeServices,
    cleanup,
    reportObstacle,
  };
}
