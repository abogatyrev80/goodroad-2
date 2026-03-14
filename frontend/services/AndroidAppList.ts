/**
 * Обёртка над expo-android-app-list.
 * В Expo Go нативный модуль недоступен — используем заглушку.
 * require выполняется только при вызове getAll(), чтобы не падать при загрузке маршрутов.
 */

async function getAllInstalledApps(): Promise<Array<{ packageName: string; appName?: string }>> {
  try {
    const mod = require('expo-android-app-list');
    const api = mod.ExpoAndroidAppList ?? mod;
    return await api.getAll();
  } catch {
    if (__DEV__) {
      console.warn('expo-android-app-list недоступен (Expo Go). Список приложений пуст.');
    }
    return [];
  }
}

export const AndroidAppList = { getAll: getAllInstalledApps };
