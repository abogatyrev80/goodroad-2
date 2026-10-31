import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getDeviceId } from './deviceId';
import { backendConfigService } from './BackendConfigService';

export const BG_LOCATION_TASK = 'goodroad-bg-location';
export const BG_SAMPLE_LAST_SENT_KEY = 'bg_sample_last_sent_at';

const BG_SAMPLE_INTERVAL_MS = 60000;

// Headless-задача: шлёт background-точки, когда основной JS-контекст заморожен (выключен экран).
// Дедупликация с AdaptiveCollector через общий ключ в AsyncStorage.
try {
  TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }: any) => {
    if (error) return;
    const locations = data?.locations;
    if (!Array.isArray(locations) || locations.length === 0) return;
    try {
      const lastSent = parseInt((await AsyncStorage.getItem(BG_SAMPLE_LAST_SENT_KEY)) || '0', 10);
      if (Date.now() - lastSent < BG_SAMPLE_INTERVAL_MS) return;

      const loc = locations[locations.length - 1];
      const url = await backendConfigService.getActiveUrlAsync();
      const deviceId = await getDeviceId();
      const resp = await fetch(`${url}/api/raw-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          events: [
            {
              kind: 'background',
              timestamp: Date.now(),
              gps: {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                speed: loc.coords.speed || 0,
                accuracy: loc.coords.accuracy || 0,
              },
              speed_kmh: (loc.coords.speed || 0) * 3.6,
            },
          ],
        }),
      });
      if (resp.ok) {
        await AsyncStorage.setItem(BG_SAMPLE_LAST_SENT_KEY, String(Date.now()));
      }
    } catch {}
  });
} catch {}

export async function startBackgroundLocationTask(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => false);
    if (started) return;
    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 30000,
      distanceInterval: 25,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'Good Road',
        notificationBody: 'Фоновый мониторинг дороги',
        notificationColor: '#0066ff',
      },
    });
  } catch (e) {
    console.warn('startBackgroundLocationTask error:', e);
  }
}

export async function stopBackgroundLocationTask(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => false);
    if (started) {
      await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
    }
  } catch (e) {
    console.warn('stopBackgroundLocationTask error:', e);
  }
}
