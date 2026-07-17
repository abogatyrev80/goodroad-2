import { Platform } from 'react-native';
import ReactNativeForegroundService from '@supersami/rn-foreground-service';

let isInitialized = false;

const NOTIFICATION_ID = 101;

function ensureRegistered() {
  if (isInitialized) return;
  try {
    ReactNativeForegroundService.register({
      config: {
        alert: true,
        onServiceErrorCallBack: () => {
          console.warn('Foreground service error callback triggered');
        },
      },
    });
    isInitialized = true;
  } catch (e) {
    console.warn('ForegroundService register error:', e);
  }
}

async function start() {
  if (Platform.OS !== 'android') return;

  ensureRegistered();

  const alreadyRunning = await ReactNativeForegroundService.isRunning();
  if (alreadyRunning > 0) return;

  try {
    await ReactNativeForegroundService.start({
      id: NOTIFICATION_ID,
      title: 'Good Road',
      message: 'Мониторинг дороги работает',
      icon: 'ic_notification',
      color: '#0066ff',
      importance: 'low',
      visibility: 'public',
      vibration: false,
      ServiceType: 'location',
    });
  } catch (e) {
    console.warn('ForegroundService start error:', e);
  }
}

async function stop() {
  if (Platform.OS !== 'android') return;

  try {
    await ReactNativeForegroundService.stopAll();
    isInitialized = false;
  } catch (e) {
    console.warn('ForegroundService stop error:', e);
  }
}

async function isRunning(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const count = await ReactNativeForegroundService.isRunning();
    return count > 0;
  } catch {
    return false;
  }
}

export default { start, stop, isRunning };
