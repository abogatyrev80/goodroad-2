import { useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function useBrightnessControl() {
  const savedBrightnessRef = useRef<number | null>(null);

  const applyMinBrightness = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      const keepScreenOn = await AsyncStorage.getItem('keep_screen_on');
      if (keepScreenOn !== 'true') return;

      await activateKeepAwakeAsync();

      const available = await Brightness.isAvailableAsync();
      if (!available) return;

      try {
        const { status } = await Brightness.requestPermissionsAsync();
        if (status !== 'granted') return;

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
      } catch (brightnessErr) {
        console.warn('Brightness error:', brightnessErr);
      }
    } catch (e) {
      console.warn('Keep awake error:', e);
    }
  }, []);

  const restoreBrightness = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      if (savedBrightnessRef.current != null) {
        const available = await Brightness.isAvailableAsync();
        if (available) {
          await Brightness.setBrightnessAsync(savedBrightnessRef.current);
        }
        savedBrightnessRef.current = null;
      }
      deactivateKeepAwake();
    } catch {
      savedBrightnessRef.current = null;
    }
  }, []);

  const forceRestoreOnUnmount = useCallback(() => {
    if (Platform.OS === 'web' || savedBrightnessRef.current == null) return;
    const brightnessToRestore = savedBrightnessRef.current;
    savedBrightnessRef.current = null;
    (async () => {
      try {
        const available = await Brightness.isAvailableAsync();
        if (available) {
          await Brightness.setBrightnessAsync(brightnessToRestore);
        }
      } catch {}
      try {
        deactivateKeepAwake();
      } catch {}
    })();
  }, []);

  return { applyMinBrightness, restoreBrightness, forceRestoreOnUnmount, savedBrightnessRef };
}
