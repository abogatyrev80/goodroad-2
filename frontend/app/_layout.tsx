/**
 * Корневой layout для Expo Router — обязателен для маршрутизации.
 * Заставка не скрывается автоматически; скрываем только когда главный экран отрисован.
 */

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

// Держим заставку до явного hideAsync — иначе может показаться экран «Loading» надолго
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
