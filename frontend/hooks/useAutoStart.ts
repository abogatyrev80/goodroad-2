import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus, Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import RNBluetoothClassic from 'react-native-bluetooth-classic';

interface UseAutoStartParams {
  startTracking: (options?: { silent?: boolean }) => Promise<void>;
  stopTracking: () => Promise<void>;
  isTracking: boolean;
}

export function useAutoStart({ startTracking, stopTracking, isTracking }: UseAutoStartParams) {
  const [autostartMode, setAutostartMode] = useState<string>('disabled');
  const [wasAutoStarted, setWasAutoStarted] = useState(false);

  const bluetoothCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const chargeCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const appsCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const autostopCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const appStateSubscription = useRef<any>(null);
  const lastBackgroundTimeRef = useRef<number | null>(null);

  const clearIntervals = useCallback(() => {
    [bluetoothCheckInterval, chargeCheckInterval, appsCheckInterval, autostopCheckInterval].forEach(ref => {
      if (ref.current) {
        clearInterval(ref.current);
        ref.current = null;
      }
    });
  }, []);

  const ensureBluetoothPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        'android.permission.BLUETOOTH_CONNECT' as any,
        { title: 'Bluetooth', message: 'Нужен доступ к Bluetooth', buttonPositive: 'OK' }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }, []);

  const checkBluetoothConnection = useCallback(async (): Promise<boolean> => {
    try {
      const savedDeviceJson = await AsyncStorage.getItem('autostart_bluetooth_device');
      if (!savedDeviceJson) return false;

      const savedDevice = JSON.parse(savedDeviceJson);
      const hasPermission = await ensureBluetoothPermission();
      if (!hasPermission) return false;

      const isEnabled = await RNBluetoothClassic.isBluetoothEnabled();
      if (!isEnabled) return false;

      try {
        const connectedDevices = await RNBluetoothClassic.getConnectedDevices();
        const isConnected = connectedDevices.some(
          (d: any) => d.address === savedDevice.address || d.name === savedDevice.name
        );
        if (isConnected) return true;
      } catch {}

      try {
        await RNBluetoothClassic.connectToDevice(savedDevice.address, { connectorType: 'rfcomm' });
        return true;
      } catch {}

      try {
        const connectedDevices = await RNBluetoothClassic.getConnectedDevices();
        const found = connectedDevices.some(
          (d: any) => d.name === savedDevice.name || d.address === savedDevice.address
        );
        return !!found;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }, [ensureBluetoothPermission]);

  const checkTriggerApps = useCallback(async (): Promise<boolean> => {
    try {
      const appsJson = await AsyncStorage.getItem('autostart_applications');
      if (!appsJson) return false;

      const apps = JSON.parse(appsJson);
      if (!apps || !Array.isArray(apps) || apps.length === 0) return false;

      const backgroundTime = lastBackgroundTimeRef.current;
      if (backgroundTime) {
        const timeInBackground = (Date.now() - backgroundTime) / 1000;
        return timeInBackground >= 3;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const checkAutostart = useCallback(async () => {
    try {
      const mode = await AsyncStorage.getItem('autostart_mode');
      setAutostartMode(mode || 'disabled');

      const alreadyTracking = await AsyncStorage.getItem('is_tracking_active') === 'true';
      if (alreadyTracking) return;

      if (mode === 'onCharge') {
        const batteryState = await Battery.getBatteryStateAsync();
        const isCharging = batteryState === Battery.BatteryState.CHARGING ||
                          batteryState === Battery.BatteryState.FULL;
        if (isCharging) {
          setTimeout(() => {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }, 1000);
        }
      }

      if (mode === 'onBluetooth') {
        const shouldStart = await checkBluetoothConnection();
        if (shouldStart) {
          setTimeout(() => {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }, 1000);
        }
      }

      if (mode === 'withApps') {
        const shouldStart = await checkTriggerApps();
        if (shouldStart) {
          setTimeout(() => {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Error checking autostart:', error);
    }
  }, [startTracking, checkBluetoothConnection, checkTriggerApps]);

  const setupAutostartMonitoring = useCallback(async () => {
    clearIntervals();

    appStateSubscription.current = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background') {
        lastBackgroundTimeRef.current = Date.now();
      }
    });

    if (autostartMode === 'onBluetooth') {
      bluetoothCheckInterval.current = setInterval(async () => {
        const shouldStart = await checkBluetoothConnection();
        if (shouldStart && !isTracking) {
          const alreadyTracking = await AsyncStorage.getItem('is_tracking_active') === 'true';
          if (!alreadyTracking) {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }
        }
      }, 5000);
    }

    if (autostartMode === 'onCharge') {
      chargeCheckInterval.current = setInterval(async () => {
        const batteryState = await Battery.getBatteryStateAsync();
        const isCharging = batteryState === Battery.BatteryState.CHARGING ||
                          batteryState === Battery.BatteryState.FULL;
        if (isCharging && !isTracking) {
          const alreadyTracking = await AsyncStorage.getItem('is_tracking_active') === 'true';
          if (!alreadyTracking) {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }
        }
      }, 5000);
    }

    if (autostartMode === 'withApps') {
      appsCheckInterval.current = setInterval(async () => {
        const shouldStart = await checkTriggerApps();
        if (shouldStart && !isTracking) {
          const alreadyTracking = await AsyncStorage.getItem('is_tracking_active') === 'true';
          if (!alreadyTracking) {
            startTracking({ silent: true });
            setWasAutoStarted(true);
          }
        }
      }, 5000);
    }

    autostopCheckInterval.current = setInterval(async () => {
      try {
        if (!isTracking) return;

        const autostopMode = await AsyncStorage.getItem('autostop_mode');
        if (!autostopMode || autostopMode === 'disabled') return;

        const alreadyAutoStopped = await AsyncStorage.getItem('was_auto_stopped');
        if (alreadyAutoStopped === 'true') return;

        if (autostopMode === 'onBluetoothDisconnect') {
          const isConnected = await checkBluetoothConnection();
          if (!isConnected) {
            await AsyncStorage.setItem('was_auto_stopped', 'true');
            stopTracking();
          }
        }
      } catch {}
    }, 5000);

    return () => {
      if (appStateSubscription.current) {
        appStateSubscription.current.remove();
        appStateSubscription.current = null;
      }
      clearIntervals();
    };
  }, [autostartMode, isTracking, startTracking, stopTracking, checkBluetoothConnection, checkTriggerApps, clearIntervals]);

  useEffect(() => {
    checkAutostart();
    const cleanup = setupAutostartMonitoring();
    return () => {
      cleanup.then(fn => fn());
      clearIntervals();
      if (appStateSubscription.current) {
        appStateSubscription.current.remove();
        appStateSubscription.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const loadMode = async () => {
      const mode = await AsyncStorage.getItem('autostart_mode');
      setAutostartMode(mode || 'disabled');
    };
    loadMode();
    setupAutostartMonitoring();
  }, [autostartMode, setupAutostartMonitoring]);

  return { autostartMode, wasAutoStarted };
}
