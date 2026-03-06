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
  AppState,
  AppStateStatus,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import * as Application from 'expo-application';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Brightness from 'expo-brightness';
import * as Device from 'expo-device';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import SimpleToast, { showToast } from '../components/SimpleToast';

// Сервисы
import RawDataCollector from '../services/RawDataCollector';
import { useObstacleAlerts } from '../hooks/useObstacleAlerts';
import ObstacleWarningOverlay, { WarningSize, WarningPosition } from '../components/ObstacleWarningOverlay';
import alertSettingsService from '../services/AlertSettingsService';

// Константы
const LOCATION_TASK_NAME = 'background-location-task';
// Для сбора логов: эмулятор Android → 10.0.2.2, симулятор iOS / устройство → укажите IP ПК в DEBUG_LOG_HOST
const DEBUG_LOG_HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
const DEBUG_LOG_URL = `http://${DEBUG_LOG_HOST}:7242/ingest/2d55966e-6eaf-4e5e-a957-213921ca07de`;

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
  const bluetoothCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const chargeCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const appsCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const autostopCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const appStateSubscription = useRef<any>(null);
  
  // Буферы для сбора данных
  const accelerometerBuffer = useRef<Array<{ x: number; y: number; z: number; timestamp: number }>>([]);
  const syncedDataBuffer = useRef<Array<{
    timestamp: number;
    gps: any;
    accelerometerData: Array<{ x: number; y: number; z: number; timestamp: number }>;
  }>>([]);
  const currentLocationRef = useRef<any>(null);
  const isTrackingRef = useRef(false);
  const savedBrightnessRef = useRef<number | null>(null);

  // Хук для препятствий
  const { obstacles, closestObstacle, obstaclesCount, refetchObstacles } = useObstacleAlerts(
    isTracking,
    currentLocation,
    currentSpeed,
    currentLocationRef
  );

  // Инициализация при загрузке
  useEffect(() => {
    initializeServices();
    alertSettingsService.initialize(); // 🆕 Инициализация настроек предупреждений
    return () => {
      cleanup();
    };
  }, []);

  // Держим ref в актуальном состоянии, чтобы интервалы не использовали устаревшее значение
  useEffect(() => {
    isTrackingRef.current = isTracking;
  }, [isTracking]);

  // Проверка автозапуска при загрузке и настройка фонового мониторинга
  useEffect(() => {
    checkAutostart();
    setupAutostartMonitoring();
    
    return () => {
      if (bluetoothCheckInterval.current) {
        clearInterval(bluetoothCheckInterval.current);
        bluetoothCheckInterval.current = null;
      }
      if (chargeCheckInterval.current) {
        clearInterval(chargeCheckInterval.current);
        chargeCheckInterval.current = null;
      }
      if (appsCheckInterval.current) {
        clearInterval(appsCheckInterval.current);
        appsCheckInterval.current = null;
      }
      if (autostopCheckInterval.current) {
        clearInterval(autostopCheckInterval.current);
        autostopCheckInterval.current = null;
      }
      if (appStateSubscription.current) {
        appStateSubscription.current.remove();
        appStateSubscription.current = null;
      }
    };
  }, []);

  // Синхронизация настроек при возврате на экран (из настроек автозапуска, предупреждений и др.)
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      (async () => {
        const mode = await AsyncStorage.getItem('autostart_mode');
        if (!cancelled && mode !== null) {
          setAutostartMode(mode);
        }
        if (!cancelled) {
          await loadWarningSettings();
        }
        if (!cancelled) {
          await setupAutostartMonitoring();
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  // Убрано предупреждение о зарядке - пользователь сам контролирует мониторинг

  const checkAutostart = async () => {
    try {
      const mode = await AsyncStorage.getItem('autostart_mode');
      setAutostartMode(mode || 'disabled');
      console.log('🚀 Autostart mode:', mode);

      const alreadyTracking = await AsyncStorage.getItem('is_tracking_active') === 'true';
      if (alreadyTracking) return;

      if (mode === 'onCharge') {
        const batteryState = await Battery.getBatteryStateAsync();
        const isCharging = batteryState === Battery.BatteryState.CHARGING || 
                          batteryState === Battery.BatteryState.FULL;
        if (isCharging) {
          console.log('🚀 Auto-starting monitoring - device is charging...');
          setTimeout(() => {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }, 1000);
        }
      }

      // Проверка Bluetooth
      if (mode === 'onBluetooth') {
        const shouldStart = await checkBluetoothConnection();
        if (shouldStart) {
          console.log('🚀 Auto-starting monitoring - Bluetooth device connected...');
          setTimeout(() => {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }, 1000);
        }
      }

      // Проверка приложений (при запуске приложения)
      if (mode === 'withApps') {
        const shouldStart = await checkTriggerApps();
        if (shouldStart) {
          console.log('🚀 Auto-starting monitoring - trigger app detected...');
          setTimeout(() => {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Error checking autostart:', error);
    }
  };

  // Настройка постоянного мониторинга для автозапуска
  const setupAutostartMonitoring = async () => {
    // Очищаем старые интервалы перед настройкой новых
    if (bluetoothCheckInterval.current) {
      clearInterval(bluetoothCheckInterval.current);
      bluetoothCheckInterval.current = null;
    }
    if (chargeCheckInterval.current) {
      clearInterval(chargeCheckInterval.current);
      chargeCheckInterval.current = null;
    }
    if (appsCheckInterval.current) {
      clearInterval(appsCheckInterval.current);
      appsCheckInterval.current = null;
    }
    
    const mode = await AsyncStorage.getItem('autostart_mode');
    
    // Общий слушатель для всех режимов - проверяем при возврате приложения на передний план
    if (appStateSubscription.current) {
      appStateSubscription.current.remove();
    }
    
    appStateSubscription.current = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        lastBackgroundTimeRef.current = Date.now();
      }
      if (nextAppState !== 'active') return;
      // Используем ref и AsyncStorage, чтобы не полагаться на устаревший closure
      if (isTrackingRef.current) return;
      const active = await AsyncStorage.getItem('is_tracking_active');
      if (active === 'true') return;

      const currentMode = await AsyncStorage.getItem('autostart_mode');
      
      if (currentMode === 'onBluetooth') {
        const shouldStart = await checkBluetoothConnection();
        if (shouldStart) {
          console.log('🚀 Auto-starting monitoring - Bluetooth device connected...');
          setTimeout(() => {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }, 500);
        }
      } else if (currentMode === 'withApps') {
        const shouldStart = await checkTriggerApps();
        if (shouldStart) {
          console.log('🚀 Auto-starting monitoring - trigger app detected on app resume...');
          setTimeout(() => {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }, 500);
        }
      } else if (currentMode === 'onCharge') {
        const batteryState = await Battery.getBatteryStateAsync();
        const isCharging = batteryState === Battery.BatteryState.CHARGING || 
                          batteryState === Battery.BatteryState.FULL;
        if (isCharging) {
          console.log('🚀 Auto-starting monitoring - device is charging...');
          setTimeout(() => {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }, 500);
        }
      }
    });

    // Для Bluetooth проверяем периодически (каждые 5 секунд) — используем ref и AsyncStorage
    if (mode === 'onBluetooth') {
      bluetoothCheckInterval.current = setInterval(async () => {
        if (isTrackingRef.current) return;
        if (await AsyncStorage.getItem('is_tracking_active') === 'true') return;
        const shouldStart = await checkBluetoothConnection();
        if (shouldStart) {
          console.log('🚀 Auto-starting monitoring - Bluetooth device connected (periodic check)...');
          startTracking({ silent: true });
          setWasAutoStarted(true);
        }
      }, 5000);
    }

    // Для зарядки проверяем периодически (каждые 5 секунд) — используем ref и AsyncStorage
    if (mode === 'onCharge') {
      chargeCheckInterval.current = setInterval(async () => {
        if (isTrackingRef.current) return;
        if (await AsyncStorage.getItem('is_tracking_active') === 'true') return;
        const batteryState = await Battery.getBatteryStateAsync();
        const isCharging = batteryState === Battery.BatteryState.CHARGING || 
                          batteryState === Battery.BatteryState.FULL;
        if (isCharging) {
          console.log('🚀 Auto-starting monitoring - device is charging (periodic check)...');
          startTracking({ silent: true });
          setWasAutoStarted(true);
        }
      }, 5000);
    }

    // Для приложений проверяем периодически (каждые 5 секунд) — используем ref и AsyncStorage
    if (mode === 'withApps') {
      appsCheckInterval.current = setInterval(async () => {
        if (isTrackingRef.current) return;
        if (await AsyncStorage.getItem('is_tracking_active') === 'true') return;
        const shouldStart = await checkTriggerApps();
        if (shouldStart) {
          console.log('🚀 Auto-starting monitoring - trigger app detected (periodic check)...');
          startTracking({ silent: true });
          setWasAutoStarted(true);
        }
      }, 5000);
    }

    // Проверка автоматической остановки (каждые 5 секунд)
    autostopCheckInterval.current = setInterval(async () => {
      if (isTracking && wasAutoStarted) {
        const currentMode = await AsyncStorage.getItem('autostart_mode');
        let shouldStop = false;
        let autoStopEnabled = false;

        if (currentMode === 'onBluetooth') {
          autoStopEnabled = await AsyncStorage.getItem('autostop_on_bluetooth_disconnect');
          // Для обратной совместимости проверяем старое значение
          if (autoStopEnabled !== 'true') {
            const oldAutoStop = await AsyncStorage.getItem('autostart_auto_stop');
            autoStopEnabled = oldAutoStop === 'true' ? 'true' : 'false';
          }
          
          if (autoStopEnabled === 'true') {
            const isConnected = await checkBluetoothConnection();
            if (!isConnected) {
              shouldStop = true;
              console.log('⏹️ Auto-stopping monitoring - Bluetooth device disconnected...');
            }
          }
        } else if (currentMode === 'withApps') {
          autoStopEnabled = await AsyncStorage.getItem('autostop_on_app_close');
          // Для обратной совместимости проверяем старое значение
          if (autoStopEnabled !== 'true') {
            const oldAutoStop = await AsyncStorage.getItem('autostart_auto_stop');
            autoStopEnabled = oldAutoStop === 'true' ? 'true' : 'false';
          }
          
          if (autoStopEnabled === 'true') {
            const isAppActive = await checkTriggerApps();
            if (!isAppActive) {
              shouldStop = true;
              console.log('⏹️ Auto-stopping monitoring - trigger app closed...');
            }
          }
        } else if (currentMode === 'onCharge') {
          autoStopEnabled = await AsyncStorage.getItem('autostop_on_charge_disconnect');
          // Для обратной совместимости проверяем старое значение
          if (autoStopEnabled !== 'true') {
            const oldAutoStop = await AsyncStorage.getItem('autostart_auto_stop');
            autoStopEnabled = oldAutoStop === 'true' ? 'true' : 'false';
          }
          
          if (autoStopEnabled === 'true') {
            const batteryState = await Battery.getBatteryStateAsync();
            const isCharging = batteryState === Battery.BatteryState.CHARGING || 
                              batteryState === Battery.BatteryState.FULL;
            if (!isCharging) {
              shouldStop = true;
              console.log('⏹️ Auto-stopping monitoring - device unplugged...');
            }
          }
        }

        if (shouldStop) {
          stopTracking();
        }
      }
    }, 5000); // Проверяем каждые 5 секунд
  };

  // Проверка и при необходимости запрос разрешения Bluetooth (Android 12+)
  const ensureBluetoothPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      return true;
    }
    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : 31;
    if (apiLevel >= 31) {
      try {
        const status = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
        );
        if (status) return true;
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          {
            title: 'Разрешение Bluetooth',
            message: 'Нужен доступ к Bluetooth для автозапуска при подключении к устройству.',
            buttonNeutral: 'Позже',
            buttonNegative: 'Отмена',
            buttonPositive: 'Разрешить',
          }
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      } catch (error) {
        console.error('Error requesting BLUETOOTH_CONNECT:', error);
        return false;
      }
    }
    return true;
  };

  // Проверка подключения Bluetooth устройства
  const checkBluetoothConnection = async (): Promise<boolean> => {
    try {
      const savedDevice = await AsyncStorage.getItem('autostart_bluetooth_device');
      if (!savedDevice) {
        console.log('📱 No Bluetooth device configured');
        return false;
      }

      // Проверяем/запрашиваем разрешение для Android 12+
      const hasPermission = await ensureBluetoothPermission();
      if (!hasPermission) {
        console.log('📱 BLUETOOTH_CONNECT permission not granted');
        return false;
      }

      const device: { name: string; address?: string } = JSON.parse(savedDevice);
      console.log('📱 Checking Bluetooth connection for device:', device.name);
      
      // Проверяем, включен ли Bluetooth
      const isEnabled = await RNBluetoothClassic.isBluetoothEnabled();
      if (!isEnabled) {
        console.log('📱 Bluetooth is disabled');
        return false;
      }
      
      // Если есть адрес устройства, используем более точную проверку
      if (device.address) {
        try {
          // 1) Проверяем, есть ли уже активное соединение (сокет) от нашего приложения
          try {
            const connectedDevice = await RNBluetoothClassic.getConnectedDevice(device.address);
            if (connectedDevice && connectedDevice.isConnected()) {
              console.log('📱 Bluetooth device is connected:', device.name);
              return true;
            }
          } catch {
            // Устройство не подключено через наше приложение
          }

          const connectedDevices = await RNBluetoothClassic.getConnectedDevices();
          const isConnected = connectedDevices.some(
            (d: { address: string }) => d.address === device.address
          );
          if (isConnected) {
            console.log('📱 Bluetooth device is connected (from list):', device.name);
            return true;
          }

          // 2) Пытаемся подключиться к устройству (если оно в зоне и сопряжено)
          try {
            await RNBluetoothClassic.connectToDevice(device.address, {});
            console.log('📱 Bluetooth device connected (just connected):', device.name);
            return true;
          } catch (connectError) {
            // Устройство недоступно или не принимает соединение (например, только A2DP)
            console.log('📱 Bluetooth connect attempt failed:', (connectError as Error)?.message || connectError);
          }

          console.log('📱 Bluetooth device is not connected:', device.name);
          return false;
        } catch (error) {
          console.error('Error checking Bluetooth connection by address:', error);
          return false;
        }
      }
      
      // Если адреса нет, проверяем по имени среди подключенных устройств
      try {
        const connectedDevices = await RNBluetoothClassic.getConnectedDevices();
        const isConnected = connectedDevices.some(
          connectedDevice => connectedDevice.name === device.name
        );
        
        if (isConnected) {
          console.log('📱 Bluetooth device is connected (by name):', device.name);
          return true;
        }
        
        console.log('📱 Bluetooth device is not connected (by name):', device.name);
        return false;
      } catch (error) {
        console.error('Error checking Bluetooth connection by name:', error);
        return false;
      }
    } catch (error) {
      console.error('Error checking Bluetooth connection:', error);
      return false;
    }
  };

  // Время ухода приложения в фон (для эвристики "вернулись из другого приложения")
  const lastBackgroundTimeRef = useRef<number | null>(null);

  // Проверка: нужно ли запустить мониторинг по триггерным приложениям.
  // expo-android-app-list не даёт список запущенных приложений, только установленных (getAll).
  // Используем эвристику: при возврате в приложение после 3+ сек в фоне считаем, что пользователь
  // мог быть в одном из выбранных приложений — запускаем мониторинг.
  const checkTriggerApps = async (): Promise<boolean> => {
    try {
      const savedApps = await AsyncStorage.getItem('autostart_trigger_apps');
      if (!savedApps) {
        console.log('📱 No trigger apps configured');
        return false;
      }
      const selectedPackageNames: string[] = JSON.parse(savedApps);
      if (selectedPackageNames.length === 0) {
        console.log('📱 No apps selected');
        return false;
      }
      console.log('📱 Selected trigger apps (package names):', selectedPackageNames.join(', '));

      if (Platform.OS !== 'android') {
        console.log('📱 Trigger apps mode is Android-only');
        return false;
      }

      // Эвристика: только что вернулись из фона после 3+ секунд — вероятно переключались на другое приложение
      const now = Date.now();
      const lastBg = lastBackgroundTimeRef.current;
      if (lastBg != null && (now - lastBg) >= 3000) {
        lastBackgroundTimeRef.current = null;
        console.log('📱 User returned from background after', Math.round((now - lastBg) / 1000), 's — starting monitoring (trigger apps heuristic)');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error checking trigger apps:', error);
      return false;
    }
  };

  const initializeServices = async () => {
    try {
      // Проверяем разрешения
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      let bgStatus: string = 'granted';
      if (Platform.OS !== 'web') {
        const { status } = await Location.requestBackgroundPermissionsAsync();
        bgStatus = status;
      }
      if (locationStatus !== 'granted' || bgStatus !== 'granted') {
        showToast('error', '⚠️ Разрешения необходимы', 'Для работы приложения нужны разрешения на GPS и фоновую работу', 5000);
      }

      // Инициализируем коллектор данных
      if (!rawDataCollector.current) {
        const deviceId = 'mobile-app-' + Date.now();
        const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://goodroad.su';
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
    if (bluetoothCheckInterval.current) {
      clearInterval(bluetoothCheckInterval.current);
      bluetoothCheckInterval.current = null;
    }
    if (chargeCheckInterval.current) {
      clearInterval(chargeCheckInterval.current);
      chargeCheckInterval.current = null;
    }
    if (appsCheckInterval.current) {
      clearInterval(appsCheckInterval.current);
      appsCheckInterval.current = null;
    }
    if (autostopCheckInterval.current) {
      clearInterval(autostopCheckInterval.current);
      autostopCheckInterval.current = null;
    }
    if (appStateSubscription.current) {
      appStateSubscription.current.remove();
      appStateSubscription.current = null;
    }

    // Восстановить яркость и keep-awake при размонтировании (если закрыли приложение во время мониторинга)
    if (Platform.OS !== 'web' && savedBrightnessRef.current != null) {
      const brightnessToRestore = savedBrightnessRef.current;
      savedBrightnessRef.current = null;
      (async () => {
        try {
          const available = await Brightness.isAvailableAsync();
          if (available) {
            await Brightness.setBrightnessAsync(brightnessToRestore);
          }
        } catch {
          // Игнорируем ошибки при размонтировании
        }
        try {
          deactivateKeepAwake();
        } catch {
          // Игнорируем
        }
      })();
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

  const startTracking = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    setIsLoading(true);
    try {
      // Не запускаем повторно, если уже идёт мониторинг
      if (isTrackingRef.current) {
        setIsLoading(false);
        return;
      }
      const alreadyActive = await AsyncStorage.getItem('is_tracking_active');
      if (alreadyActive === 'true') {
        // Если нет активной подписки — флаг устарел (краш/закрытие приложения)
        if (!locationSubscription.current) {
          await AsyncStorage.removeItem('is_tracking_active');
          // продолжаем запуск
        } else {
          setIsLoading(false);
          return;
        }
      }
      // Сохраняем флаг активного мониторинга для фоновой задачи
      await AsyncStorage.setItem('is_tracking_active', 'true');
      // Запускаем GPS
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 500,
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

      // Запускаем акселерометр (10 Hz) — на web expo-sensors не поддерживается
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
        console.log('✅ Accelerometer started (10 Hz)');
      } else {
        console.log('⚠️ Accelerometer skipped on web');
      }

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
      isTrackingRef.current = true;

      // Не выключать экран и минимальная яркость во время мониторинга
      if (Platform.OS !== 'web') {
        try {
          const keepScreenOn = await AsyncStorage.getItem('keep_screen_on');
          if (keepScreenOn === 'true') {
            await activateKeepAwakeAsync();
            console.log('✅ Keep screen on enabled');

            // Установить минимальную яркость (сохраняем текущую и восстанавливаем при остановке)
            const available = await Brightness.isAvailableAsync();
            if (available) {
              try {
                const { status } = await Brightness.requestPermissionsAsync();
                if (status === 'granted') {
                  const current = await Brightness.getBrightnessAsync();
                  savedBrightnessRef.current = current;
                  const minBrightnessStr = await AsyncStorage.getItem('min_brightness');
                  let minBrightness = 0.1;
                  if (minBrightnessStr != null) {
                    const parsed = parseFloat(minBrightnessStr);
                    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
                      minBrightness = parsed;
                    }
                  }
                  await Brightness.setBrightnessAsync(minBrightness);
                  console.log('✅ Min brightness set to', Math.round(minBrightness * 100), '%');
                }
              } catch (brightnessErr) {
                console.warn('Brightness error:', brightnessErr);
              }
            }
          }
        } catch (e) {
          console.warn('Keep awake error:', e);
        }
      }

      if (!silent) {
        showToast('success', '✅ Мониторинг запущен', 'Приложение отслеживает состояние дороги', 3000);
      }
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
      // Пытаемся отправить накопленные и офлайн-данные при остановке (если появилась сеть)
      try {
        await rawDataCollector.current?.forceSend();
      } catch (e) {
        console.warn('forceSend при остановке:', e);
      }

      await AsyncStorage.removeItem('is_tracking_active');
      
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
      isTrackingRef.current = false;
      setCurrentLocation(null);
      setWasAutoStarted(false); // Сбрасываем флаг автозапуска

      // Восстанавливаем яркость и отключаем keep screen on
      if (Platform.OS !== 'web') {
        try {
          if (savedBrightnessRef.current != null) {
            const available = await Brightness.isAvailableAsync();
            if (available) {
              await Brightness.setBrightnessAsync(savedBrightnessRef.current);
              console.log('✅ Brightness restored');
            }
            savedBrightnessRef.current = null;
          }
          deactivateKeepAwake();
          console.log('✅ Keep screen on disabled');
        } catch {
          savedBrightnessRef.current = null;
        }
      }

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
      {/* #region agent log */}
      {(()=>{
        const overlayVisible = isTracking && closestObstacle !== null && closestObstacle.distance < 1000 && closestObstacle.distance >= 50 && currentSpeed > 1;
        if (closestObstacle !== null || overlayVisible) (()=>{const p={sessionId:'c27951',location:'index.tsx:ObstacleWarningOverlay-props',message:'Overlay props',data:{isTracking,hasClosestObstacle:!!closestObstacle,distance:closestObstacle?.distance,speed:currentSpeed,overlayVisible,containerBg:'#0f0f23'},hypothesisId:'H-B,H-E',timestamp:Date.now()};fetch(DEBUG_LOG_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c27951'},body:JSON.stringify(p)}).catch(()=>{});if (typeof __DEV__!=='undefined'&&__DEV__) console.log('[DEBUG c27951]',p);})();
        return null;
      })()}
      {/* #endregion */}
      <ObstacleWarningOverlay
        obstacle={closestObstacle}
        visible={
          isTracking &&
          closestObstacle !== null &&
          closestObstacle.distance < 1000 &&
          closestObstacle.distance >= 50 &&
          currentSpeed > 1
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

        {/* Статистика отправки данных */}
        <Pressable
          style={styles.compactButton}
          onPress={() => router.push('/data-stats')}
        >
          <Ionicons name="stats-chart" size={24} color="#00d4ff" />
          <Text style={styles.compactButtonText}>ОТПРАВКА ДАННЫХ</Text>
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

        {/* Админ-панель — только для разработчиков (скрыта в production) */}
        {__DEV__ && (
          <Pressable
            style={styles.button}
            onPress={() => router.push('/admin-simple')}
          >
            <Ionicons name="analytics" size={34} color="#00d4ff" />
            <Text style={styles.buttonText}>АДМИН-ПАНЕЛЬ</Text>
          </Pressable>
        )}

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
