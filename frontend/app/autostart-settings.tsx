/**
 * AutostartSettings V3 - Продвинутые настройки с выбором любых приложений
 * Пользователь может выбрать из популярных приложений или добавить свое
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  StatusBar,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { ExpoAndroidAppList } from 'expo-android-app-list';
import RNBluetoothClassic from 'react-native-bluetooth-classic';

type AutostartMode = 'disabled' | 'onCharge' | 'withApps' | 'onBluetooth';

interface TriggerApp {
  id: string;
  name: string;
  packageName: string;
  icon: string;
  category: string;
  isCustom?: boolean;
}

interface BluetoothDevice {
  id: string;
  name: string;
  address?: string;
}

// Популярные приложения с предзаполненными package names
const POPULAR_APPS: TriggerApp[] = [
  // Навигация
  { id: 'google-maps', name: 'Google Maps', packageName: 'com.google.android.apps.maps', icon: '🗺️', category: 'Навигация' },
  { id: 'yandex-maps', name: 'Яндекс.Карты', packageName: 'ru.yandex.yandexmaps', icon: '🗺️', category: 'Навигация' },
  { id: 'yandex-navi', name: 'Яндекс.Навигатор', packageName: 'ru.yandex.yandexnavi', icon: '🧭', category: 'Навигация' },
  { id: 'waze', name: 'Waze', packageName: 'com.waze', icon: '🗺️', category: 'Навигация' },
  { id: '2gis', name: '2ГИС', packageName: 'ru.dublgis.dgismobile', icon: '🗺️', category: 'Навигация' },
  // Такси
  { id: 'yandex-taxi', name: 'Яндекс.Такси', packageName: 'ru.yandex.taxi', icon: '🚕', category: 'Такси' },
  { id: 'uber', name: 'Uber', packageName: 'com.ubercab', icon: '🚗', category: 'Такси' },
  { id: 'gett', name: 'Gett', packageName: 'com.gettaxi.android', icon: '🚖', category: 'Такси' },
  // Музыка
  { id: 'yandex-music', name: 'Яндекс.Музыка', packageName: 'ru.yandex.music', icon: '🎵', category: 'Музыка' },
  { id: 'spotify', name: 'Spotify', packageName: 'com.spotify.music', icon: '🎵', category: 'Музыка' },
  { id: 'apple-music', name: 'Apple Music', packageName: 'com.apple.android.music', icon: '🎵', category: 'Музыка' },
];

export default function AutostartSettingsScreen() {
  const [autostartMode, setAutostartMode] = useState<AutostartMode>('disabled');
  const [customApps, setCustomApps] = useState<TriggerApp[]>([]);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [selectedBluetoothDevice, setSelectedBluetoothDevice] = useState<BluetoothDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoStop, setAutoStop] = useState(false);
  
  // Модальные окна для добавления
  const [showAppModal, setShowAppModal] = useState(false);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showPopularAppsModal, setShowPopularAppsModal] = useState(false);
  const [showInstalledAppsModal, setShowInstalledAppsModal] = useState(false);
  const [showBluetoothDevicesModal, setShowBluetoothDevicesModal] = useState(false);
  const [appName, setAppName] = useState('');
  const [packageName, setPackageName] = useState('');
  const [deviceName, setDeviceName] = useState('');
  
  // Списки реальных устройств и приложений
  const [installedApps, setInstalledApps] = useState<TriggerApp[]>([]);
  const [bluetoothDevices, setBluetoothDevices] = useState<BluetoothDevice[]>([]);
  const [loadingInstalledApps, setLoadingInstalledApps] = useState(false);
  const [loadingBluetoothDevices, setLoadingBluetoothDevices] = useState(false);
  
  // Все доступные приложения (популярные + пользовательские)
  // Используем useMemo для пересчета при изменении customApps
  const allApps = React.useMemo(() => {
    // Объединяем популярные приложения с пользовательскими
    // Если популярное приложение уже добавлено пользователем, используем пользовательскую версию
    const popularAppsNotAdded = POPULAR_APPS.filter(
      popular => !customApps.some(custom => custom.packageName === popular.packageName)
    );
    return [...popularAppsNotAdded, ...customApps];
  }, [customApps]);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem('autostart_mode');
      if (saved) {
        setAutostartMode(saved as AutostartMode);
      }

      const savedApps = await AsyncStorage.getItem('autostart_trigger_apps');
      if (savedApps) {
        setSelectedApps(JSON.parse(savedApps));
      }

      const savedCustomApps = await AsyncStorage.getItem('autostart_custom_apps');
      if (savedCustomApps) {
        setCustomApps(JSON.parse(savedCustomApps));
      }

      const savedBtDevice = await AsyncStorage.getItem('autostart_bluetooth_device');
      if (savedBtDevice) {
        setSelectedBluetoothDevice(JSON.parse(savedBtDevice));
      }

      const savedAutoStop = await AsyncStorage.getItem('autostart_auto_stop');
      if (savedAutoStop) {
        setAutoStop(JSON.parse(savedAutoStop));
      }
    } catch (error) {
      console.error('Error loading autostart settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (mode: AutostartMode) => {
    try {
      await AsyncStorage.setItem('autostart_mode', mode);
      setAutostartMode(mode);
      Alert.alert('Сохранено ✅', `Автозапуск: ${getModeText(mode)}`);
    } catch (error) {
      console.error('Error saving autostart settings:', error);
      Alert.alert('Ошибка', 'Не удалось сохранить настройки');
    }
  };

  const toggleApp = async (appId: string) => {
    const newSelection = selectedApps.includes(appId)
      ? selectedApps.filter(id => id !== appId)
      : [...selectedApps, appId];
    
    setSelectedApps(newSelection);
    await AsyncStorage.setItem('autostart_trigger_apps', JSON.stringify(newSelection));
  };

  const addCustomApp = () => {
    setAppName('');
    setPackageName('');
    setShowAppModal(true);
  };

  const detectCurrentApp = async () => {
    try {
      const appId = Application.applicationId;
      const appName = Application.applicationName;
      
      if (appId && appName) {
        setAppName(appName);
        setPackageName(appId);
        Alert.alert(
          'Приложение определено ✅',
          `Название: ${appName}\nPackage: ${appId}\n\nТеперь вы можете добавить его в список.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Ошибка', 'Не удалось определить текущее приложение');
      }
    } catch (error) {
      console.error('Error detecting current app:', error);
      Alert.alert('Ошибка', 'Не удалось определить текущее приложение');
    }
  };

  const addPopularApp = async (app: TriggerApp) => {
    // Проверяем, не добавлено ли уже это приложение
    const exists = customApps.find(a => a.packageName === app.packageName);
    if (exists) {
      Alert.alert('Внимание', 'Это приложение уже добавлено');
      return;
    }

    // Добавляем популярное приложение в пользовательские (но помечаем что оно из популярных)
    const newCustomApps = [...customApps, { ...app, isCustom: true }];
    setCustomApps(newCustomApps);
    await AsyncStorage.setItem('autostart_custom_apps', JSON.stringify(newCustomApps));
    
    // Автоматически выбираем добавленное приложение
    await toggleApp(app.id);
    
    setShowPopularAppsModal(false);
    Alert.alert('Успех ✅', `Приложение "${app.name}" добавлено и выбрано`);
  };
  
  const saveCustomApp = async () => {
    if (!appName.trim() || !packageName.trim()) {
      Alert.alert('Ошибка', 'Заполните все поля');
      return;
    }
    
    const customApp: TriggerApp = {
      id: `custom-${Date.now()}`,
      name: appName.trim(),
      packageName: packageName.trim(),
      icon: '📱',
      category: 'Пользовательские',
      isCustom: true,
    };
    
    const newCustomApps = [...customApps, customApp];
    setCustomApps(newCustomApps);
    await AsyncStorage.setItem('autostart_custom_apps', JSON.stringify(newCustomApps));
    
    // Автоматически выбираем добавленное приложение
    await toggleApp(customApp.id);
    
    setShowAppModal(false);
    Alert.alert('Успех ✅', `Приложение "${appName}" добавлено`);
  };

  const removeCustomApp = async (appId: string) => {
    const app = customApps.find(a => a.id === appId);
    if (!app) return;

    Alert.alert(
      'Удалить приложение?',
      `Вы уверены что хотите удалить "${app.name}"?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            const newCustomApps = customApps.filter(a => a.id !== appId);
            setCustomApps(newCustomApps);
            await AsyncStorage.setItem('autostart_custom_apps', JSON.stringify(newCustomApps));
            
            // Убираем из выбранных
            const newSelection = selectedApps.filter(id => id !== appId);
            setSelectedApps(newSelection);
            await AsyncStorage.setItem('autostart_trigger_apps', JSON.stringify(newSelection));
          },
        },
      ]
    );
  };

  // Получение списка установленных приложений
  const getInstalledApps = async (): Promise<TriggerApp[]> => {
    try {
      setLoadingInstalledApps(true);
      
      const apps = await ExpoAndroidAppList.getAll();
      
      return apps.map(app => ({
        id: app.packageName,
        name: app.appName || app.packageName,
        packageName: app.packageName,
        icon: '📱',
        category: 'Установленные',
      }));
    } catch (error) {
      console.error('Error getting installed apps:', error);
      Alert.alert('Ошибка', 'Не удалось получить список приложений. Убедитесь, что разрешение QUERY_ALL_PACKAGES предоставлено.');
      return [];
    } finally {
      setLoadingInstalledApps(false);
    }
  };

  // Получение списка Bluetooth устройств
  const getBluetoothDevices = async (): Promise<BluetoothDevice[]> => {
    try {
      setLoadingBluetoothDevices(true);
      
      // Проверяем, включен ли Bluetooth
      const isEnabled = await RNBluetoothClassic.isBluetoothEnabled();
      if (!isEnabled) {
        Alert.alert(
          'Bluetooth выключен',
          'Пожалуйста, включите Bluetooth в настройках устройства.',
          [{ text: 'OK' }]
        );
        return [];
      }
      
      const devices = await RNBluetoothClassic.getBondedDevices();
      
      return devices.map(device => ({
        id: device.address,
        name: device.name || 'Неизвестное устройство',
        address: device.address,
      }));
    } catch (error: any) {
      console.error('Error getting Bluetooth devices:', error);
      const errorMessage = error?.message || 'Не удалось получить список устройств';
      Alert.alert('Ошибка', `Не удалось получить список Bluetooth устройств: ${errorMessage}`);
      return [];
    } finally {
      setLoadingBluetoothDevices(false);
    }
  };

  const scanBluetoothDevices = async () => {
    const devices = await getBluetoothDevices();
    if (devices.length > 0) {
      setBluetoothDevices(devices);
      setShowBluetoothDevicesModal(true);
    } else {
      // Если список пуст, показываем модальное окно для ввода вручную
      setDeviceName('');
      setShowDeviceModal(true);
    }
  };

  const scanInstalledApps = async () => {
    const apps = await getInstalledApps();
    if (apps.length > 0) {
      setInstalledApps(apps);
      setShowInstalledAppsModal(true);
    }
  };
  
  const saveBluetoothDevice = async () => {
    if (!deviceName.trim()) {
      Alert.alert('Ошибка', 'Введите имя устройства');
      return;
    }
    
    const device: BluetoothDevice = {
      id: `bt-${Date.now()}`,
      name: deviceName.trim(),
    };
    
    setSelectedBluetoothDevice(device);
    await AsyncStorage.setItem('autostart_bluetooth_device', JSON.stringify(device));
    setShowDeviceModal(false);
    Alert.alert('Успех ✅', `Устройство "${deviceName}" добавлено`);
  };

  const clearBluetoothDevice = async () => {
    Alert.alert(
      'Удалить устройство?',
      `Вы уверены что хотите удалить "${selectedBluetoothDevice?.name}"?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            setSelectedBluetoothDevice(null);
            await AsyncStorage.removeItem('autostart_bluetooth_device');
          },
        },
      ]
    );
  };

  const selectBluetoothDevice = async (device: BluetoothDevice) => {
    setSelectedBluetoothDevice(device);
    await AsyncStorage.setItem('autostart_bluetooth_device', JSON.stringify(device));
    setShowBluetoothDevicesModal(false);
    Alert.alert('Успех ✅', `Устройство "${device.name}" выбрано`);
  };

  const selectInstalledApp = async (app: TriggerApp) => {
    // Проверяем, не добавлено ли уже это приложение
    const exists = customApps.find(a => a.packageName === app.packageName);
    if (exists) {
      Alert.alert('Внимание', 'Это приложение уже добавлено');
      return;
    }

    // Добавляем приложение в пользовательские
    const newCustomApps = [...customApps, { ...app, isCustom: true }];
    setCustomApps(newCustomApps);
    await AsyncStorage.setItem('autostart_custom_apps', JSON.stringify(newCustomApps));
    
    // Автоматически выбираем добавленное приложение
    await toggleApp(app.id);
    
    setShowInstalledAppsModal(false);
    Alert.alert('Успех ✅', `Приложение "${app.name}" добавлено и выбрано`);
  };

  const toggleAutoStop = async () => {
    const newValue = !autoStop;
    setAutoStop(newValue);
    await AsyncStorage.setItem('autostart_auto_stop', JSON.stringify(newValue));
  };

  const getModeText = (mode: AutostartMode): string => {
    switch (mode) {
      case 'disabled':
        return 'Выключен';
      case 'onCharge':
        return 'При зарядке';
      case 'withApps':
        return 'С приложениями';
      case 'onBluetooth':
        return 'Bluetooth';
    }
  };

  const getModeDescription = (mode: AutostartMode): string => {
    switch (mode) {
      case 'disabled':
        return 'Запуск только вручную';
      case 'onCharge':
        return 'Автозапуск при подключении к зарядке';
      case 'withApps':
        return 'Автозапуск при открытии выбранных приложений';
      case 'onBluetooth':
        return 'Автозапуск при подключении к Bluetooth устройству';
    }
  };

  // Только пользовательские приложения

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00d4ff" />
          <Text style={styles.loadingText}>Загрузка...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#00d4ff" />
        </Pressable>
        <Text style={styles.headerTitle}>Автозапуск</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content}>
        {/* Информация */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color="#00d4ff" />
          <Text style={styles.infoText}>
            Выберите когда мониторинг должен запускаться автоматически.
            Можете выбрать популярные приложения или добавить свое.
          </Text>
        </View>

        {/* Режимы */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Режим автозапуска</Text>

          {/* Выключен */}
          <Pressable
            style={[styles.modeOption, autostartMode === 'disabled' && styles.modeOptionActive]}
            onPress={() => saveSettings('disabled')}
          >
            <Ionicons
              name="close-circle"
              size={32}
              color={autostartMode === 'disabled' ? '#00d4ff' : '#8b94a8'}
            />
            <View style={styles.modeInfo}>
              <Text style={[styles.modeTitle, autostartMode === 'disabled' && styles.modeTitleActive]}>
                Выключен
              </Text>
              <Text style={styles.modeDescription}>{getModeDescription('disabled')}</Text>
            </View>
            {autostartMode === 'disabled' && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
          </Pressable>

          {/* При зарядке */}
          <Pressable
            style={[styles.modeOption, autostartMode === 'onCharge' && styles.modeOptionActive]}
            onPress={() => saveSettings('onCharge')}
          >
            <Ionicons
              name="flash"
              size={32}
              color={autostartMode === 'onCharge' ? '#00d4ff' : '#8b94a8'}
            />
            <View style={styles.modeInfo}>
              <Text style={[styles.modeTitle, autostartMode === 'onCharge' && styles.modeTitleActive]}>
                При зарядке
              </Text>
              <Text style={styles.modeDescription}>{getModeDescription('onCharge')}</Text>
            </View>
            {autostartMode === 'onCharge' && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
          </Pressable>

          {/* С приложениями */}
          <Pressable
            style={[styles.modeOption, autostartMode === 'withApps' && styles.modeOptionActive]}
            onPress={() => saveSettings('withApps')}
          >
            <Ionicons
              name="apps"
              size={32}
              color={autostartMode === 'withApps' ? '#00d4ff' : '#8b94a8'}
            />
            <View style={styles.modeInfo}>
              <Text style={[styles.modeTitle, autostartMode === 'withApps' && styles.modeTitleActive]}>
                С приложениями
              </Text>
              <Text style={styles.modeDescription}>{getModeDescription('withApps')}</Text>
            </View>
            {autostartMode === 'withApps' && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
          </Pressable>

          {/* Выбор приложений */}
          {autostartMode === 'withApps' && (
            <View style={styles.subSettings}>
              <View style={styles.subSettingsHeader}>
                <Text style={styles.subSettingsTitle}>Ваши приложения:</Text>
                <Text style={styles.selectedCount}>
                  {selectedApps.length} выбрано
                </Text>
              </View>

              {/* Список добавленных приложений */}
              {allApps.length > 0 ? (
                allApps.map((app) => (
                  <Pressable
                    key={app.id}
                    style={[styles.appOption, selectedApps.includes(app.id) && styles.appOptionActive]}
                    onPress={() => toggleApp(app.id)}
                  >
                    <Text style={styles.appIcon}>{app.icon}</Text>
                    <View style={styles.appInfo}>
                      <View style={styles.appNameRow}>
                        <Text style={styles.appName}>{app.name}</Text>
                        {POPULAR_APPS.some(pop => pop.packageName === app.packageName) && (
                          <View style={styles.popularBadge}>
                            <Text style={styles.popularBadgeText}>Популярное</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.packageName}>{app.packageName}</Text>
                    </View>
                    {customApps.some(ca => ca.id === app.id) && (
                      <Pressable onPress={() => removeCustomApp(app.id)} style={styles.removeAppButton}>
                        <Ionicons name="close-circle" size={20} color="#ff3b30" />
                      </Pressable>
                    )}
                    {selectedApps.includes(app.id) && <Ionicons name="checkmark-circle" size={20} color="#00ff88" />}
                  </Pressable>
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="apps-outline" size={48} color="#2d2d5f" />
                  <Text style={styles.emptyText}>Нет добавленных приложений</Text>
                  <Text style={styles.emptyHint}>Выберите из популярных или добавьте свое</Text>
                </View>
              )}

              {/* Кнопки добавления приложений */}
              <View style={styles.addAppButtonsContainer}>
                <Pressable style={[styles.addAppButton, styles.addAppButtonPrimary]} onPress={() => setShowPopularAppsModal(true)}>
                  <Ionicons name="star" size={24} color="#fbbf24" />
                  <Text style={[styles.addAppText, styles.addAppTextPrimary]}>Выбрать из популярных</Text>
                </Pressable>
                <Pressable style={[styles.addAppButton, { borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.1)' }]} onPress={scanInstalledApps}>
                  <Ionicons name="phone-portrait" size={24} color="#8b5cf6" />
                  <Text style={[styles.addAppText, { color: '#8b5cf6' }]}>Выбрать из установленных</Text>
                </Pressable>
                <Pressable style={styles.addAppButton} onPress={addCustomApp}>
                  <Ionicons name="add-circle" size={24} color="#00d4ff" />
                  <Text style={styles.addAppText}>Добавить вручную</Text>
                </Pressable>
                <Pressable style={[styles.addAppButton, styles.addAppButtonSecondary]} onPress={detectCurrentApp}>
                  <Ionicons name="scan" size={24} color="#00ff88" />
                  <Text style={[styles.addAppText, styles.addAppTextSecondary]}>Определить текущее</Text>
                </Pressable>
              </View>

              {customApps.length > 0 && selectedApps.length === 0 && (
                <Text style={styles.warningText}>⚠️ Выберите хотя бы одно приложение</Text>
              )}
            </View>
          )}

          {/* При Bluetooth */}
          <Pressable
            style={[styles.modeOption, autostartMode === 'onBluetooth' && styles.modeOptionActive]}
            onPress={() => saveSettings('onBluetooth')}
          >
            <Ionicons
              name="bluetooth"
              size={32}
              color={autostartMode === 'onBluetooth' ? '#00d4ff' : '#8b94a8'}
            />
            <View style={styles.modeInfo}>
              <Text style={[styles.modeTitle, autostartMode === 'onBluetooth' && styles.modeTitleActive]}>
                Bluetooth устройство
              </Text>
              <Text style={styles.modeDescription}>{getModeDescription('onBluetooth')}</Text>
            </View>
            {autostartMode === 'onBluetooth' && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
          </Pressable>

          {/* Выбор Bluetooth устройства */}
          {autostartMode === 'onBluetooth' && (
            <View style={styles.subSettings}>
              <Text style={styles.subSettingsTitle}>Устройство:</Text>
              {selectedBluetoothDevice ? (
                <View style={styles.deviceCard}>
                  <Ionicons name="bluetooth" size={24} color="#00d4ff" />
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{selectedBluetoothDevice.name}</Text>
                    {selectedBluetoothDevice.address && (
                      <Text style={styles.deviceAddress}>{selectedBluetoothDevice.address}</Text>
                    )}
                  </View>
                  <Pressable onPress={clearBluetoothDevice} style={styles.removeButton}>
                    <Ionicons name="close-circle" size={24} color="#ff3b30" />
                  </Pressable>
                </View>
              ) : (
                <View>
                  <View style={styles.addDeviceButtonsContainer}>
                    <Pressable style={[styles.addDeviceButton, { borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.1)' }]} onPress={scanBluetoothDevices}>
                      <Ionicons name="bluetooth" size={24} color="#8b5cf6" />
                      <Text style={[styles.addDeviceText, { color: '#8b5cf6' }]}>Выбрать из устройств</Text>
                    </Pressable>
                    <Pressable style={styles.addDeviceButton} onPress={() => {
                      setDeviceName('');
                      setShowDeviceModal(true);
                    }}>
                      <Ionicons name="add-circle" size={24} color="#00d4ff" />
                      <Text style={styles.addDeviceText}>Добавить по имени</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.deviceHint}>
                    💡 Подсказка: Выберите устройство из списка или введите имя вручную (например: "Car Audio", "Toyota Camry").
                    Приложение будет запускать мониторинг при подключении к этому устройству.
                  </Text>
                </View>
              )}
              {!selectedBluetoothDevice && (
                <Text style={styles.warningText}>⚠️ Добавьте Bluetooth устройство</Text>
              )}
            </View>
          )}
        </View>

        {/* Автоматическая остановка */}
        {(autostartMode === 'onBluetooth' || autostartMode === 'withApps' || autostartMode === 'onCharge') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Автоматическая остановка</Text>
            <Pressable
              style={[styles.modeOption, autoStop && styles.modeOptionActive]}
              onPress={toggleAutoStop}
            >
              <Ionicons
                name={autoStop ? "stop-circle" : "stop-circle-outline"}
                size={32}
                color={autoStop ? '#00d4ff' : '#8b94a8'}
              />
              <View style={styles.modeInfo}>
                <Text style={[styles.modeTitle, autoStop && styles.modeTitleActive]}>
                  Автоматическая остановка
                </Text>
                <Text style={styles.modeDescription}>
                  {autoStop 
                    ? 'Мониторинг будет автоматически останавливаться при отключении триггера'
                    : 'Мониторинг будет работать до ручной остановки'}
                </Text>
              </View>
              {autoStop && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
            </Pressable>
          </View>
        )}

        {/* Советы */}
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>💡 Советы</Text>
          
          <View style={styles.tipItem}>
            <Ionicons name="star" size={16} color="#fbbf24" />
            <Text style={styles.tipText}>
              Выберите из популярных приложений - Google Maps, Яндекс.Карты, Spotify и другие
            </Text>
          </View>

          <View style={styles.tipItem}>
            <Ionicons name="scan" size={16} color="#00ff88" />
            <Text style={styles.tipText}>
              Используйте "Определить текущее" чтобы автоматически заполнить package name
            </Text>
          </View>

          <View style={styles.tipItem}>
            <Ionicons name="add-circle" size={16} color="#00d4ff" />
            <Text style={styles.tipText}>
              Или добавьте приложение вручную - введите название и package name
            </Text>
          </View>

          <View style={styles.tipItem}>
            <Ionicons name="battery-charging" size={16} color="#f59e0b" />
            <Text style={styles.tipText}>
              Мониторинг потребляет больше энергии из-за GPS и акселерометра
            </Text>
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Modal для добавления приложения */}
      <Modal
        visible={showAppModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowAppModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Добавить приложение</Text>
            <Text style={styles.modalSubtitle}>
              Введите название приложения и имя пакета
            </Text>
            
            <TextInput
              style={styles.modalInput}
              placeholder="Название приложения"
              placeholderTextColor="#8b94a8"
              value={appName}
              onChangeText={setAppName}
              autoFocus={true}
            />
            
            <TextInput
              style={styles.modalInput}
              placeholder="Имя пакета (Package Name)"
              placeholderTextColor="#8b94a8"
              value={packageName}
              onChangeText={setPackageName}
            />
            
            <Pressable style={styles.detectButton} onPress={detectCurrentApp}>
              <Ionicons name="scan" size={20} color="#00ff88" />
              <Text style={styles.detectButtonText}>Определить текущее приложение</Text>
            </Pressable>
            
            <Text style={styles.modalHint}>
              Например:{'\n'}
              com.google.android.apps.maps{'\n'}
              ru.yandex.yandexnavi
            </Text>
            
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setShowAppModal(false)}
              >
                <Text style={styles.modalButtonTextCancel}>Отмена</Text>
              </Pressable>
              
              <Pressable
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={saveCustomApp}
              >
                <Text style={styles.modalButtonTextSave}>Добавить</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal для выбора популярных приложений */}
      <Modal
        visible={showPopularAppsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowPopularAppsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Популярные приложения</Text>
            <Text style={styles.modalSubtitle}>
              Выберите приложение из списка. Package name будет заполнен автоматически.
            </Text>
            
            <ScrollView style={styles.popularAppsList} showsVerticalScrollIndicator={false}>
              {POPULAR_APPS.map((app) => {
                const isAdded = customApps.some(a => a.packageName === app.packageName);
                return (
                  <Pressable
                    key={app.id}
                    style={[styles.popularAppItem, isAdded && styles.popularAppItemAdded]}
                    onPress={() => !isAdded && addPopularApp(app)}
                    disabled={isAdded}
                  >
                    <Text style={styles.popularAppIcon}>{app.icon}</Text>
                    <View style={styles.popularAppInfo}>
                      <Text style={styles.popularAppName}>{app.name}</Text>
                      <Text style={styles.popularAppCategory}>{app.category}</Text>
                      <Text style={styles.popularAppPackage}>{app.packageName}</Text>
                    </View>
                    {isAdded ? (
                      <Ionicons name="checkmark-circle" size={24} color="#00ff88" />
                    ) : (
                      <Ionicons name="add-circle" size={24} color="#00d4ff" />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
            
            <Pressable
              style={[styles.modalButton, styles.modalButtonCancel]}
              onPress={() => setShowPopularAppsModal(false)}
            >
              <Text style={styles.modalButtonTextCancel}>Закрыть</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Modal для добавления Bluetooth устройства */}
      <Modal
        visible={showDeviceModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowDeviceModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Добавить Bluetooth устройство</Text>
            <Text style={styles.modalSubtitle}>
              Введите имя вашего Bluetooth устройства{'\n'}
              (например: "Car Audio", "Toyota Camry")
            </Text>
            
            <TextInput
              style={styles.modalInput}
              placeholder="Имя устройства"
              placeholderTextColor="#8b94a8"
              value={deviceName}
              onChangeText={setDeviceName}
              autoFocus={true}
            />
            
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setShowDeviceModal(false)}
              >
                <Text style={styles.modalButtonTextCancel}>Отмена</Text>
              </Pressable>
              
              <Pressable
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={saveBluetoothDevice}
              >
                <Text style={styles.modalButtonTextSave}>Добавить</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal для выбора из установленных приложений */}
      <Modal
        visible={showInstalledAppsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowInstalledAppsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Установленные приложения</Text>
            <Text style={styles.modalSubtitle}>
              Выберите приложение из списка установленных на устройстве
            </Text>
            
            {loadingInstalledApps ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#00d4ff" />
                <Text style={styles.loadingText}>Загрузка приложений...</Text>
              </View>
            ) : installedApps.length > 0 ? (
              <ScrollView style={styles.popularAppsList} showsVerticalScrollIndicator={false}>
                {installedApps.map((app) => {
                  const isAdded = customApps.some(a => a.packageName === app.packageName);
                  return (
                    <Pressable
                      key={app.id}
                      style={[styles.popularAppItem, isAdded && styles.popularAppItemAdded]}
                      onPress={() => !isAdded && selectInstalledApp(app)}
                      disabled={isAdded}
                    >
                      <Text style={styles.popularAppIcon}>{app.icon}</Text>
                      <View style={styles.popularAppInfo}>
                        <Text style={styles.popularAppName}>{app.name}</Text>
                        <Text style={styles.popularAppCategory}>{app.category}</Text>
                        <Text style={styles.popularAppPackage}>{app.packageName}</Text>
                      </View>
                      {isAdded ? (
                        <Ionicons name="checkmark-circle" size={24} color="#00ff88" />
                      ) : (
                        <Ionicons name="add-circle" size={24} color="#00d4ff" />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="apps-outline" size={48} color="#2d2d5f" />
                <Text style={styles.emptyText}>Список приложений пуст</Text>
                <Text style={styles.emptyHint}>Для получения списка требуется нативный модуль</Text>
              </View>
            )}
            
            <Pressable
              style={[styles.modalButton, styles.modalButtonCancel]}
              onPress={() => setShowInstalledAppsModal(false)}
            >
              <Text style={styles.modalButtonTextCancel}>Закрыть</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Modal для выбора из Bluetooth устройств */}
      <Modal
        visible={showBluetoothDevicesModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowBluetoothDevicesModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Bluetooth устройства</Text>
            <Text style={styles.modalSubtitle}>
              Выберите устройство из списка сопряженных устройств
            </Text>
            
            {loadingBluetoothDevices ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#00d4ff" />
                <Text style={styles.loadingText}>Загрузка устройств...</Text>
              </View>
            ) : bluetoothDevices.length > 0 ? (
              <ScrollView style={styles.popularAppsList} showsVerticalScrollIndicator={false}>
                {bluetoothDevices.map((device) => {
                  const isSelected = selectedBluetoothDevice?.address === device.address;
                  return (
                    <Pressable
                      key={device.id}
                      style={[styles.popularAppItem, isSelected && styles.popularAppItemAdded]}
                      onPress={() => selectBluetoothDevice(device)}
                    >
                      <Ionicons name="bluetooth" size={32} color={isSelected ? "#00ff88" : "#00d4ff"} />
                      <View style={styles.popularAppInfo}>
                        <Text style={styles.popularAppName}>{device.name}</Text>
                        {device.address && (
                          <Text style={styles.popularAppPackage}>{device.address}</Text>
                        )}
                      </View>
                      {isSelected && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="bluetooth-outline" size={48} color="#2d2d5f" />
                <Text style={styles.emptyText}>Список устройств пуст</Text>
                <Text style={styles.emptyHint}>Для получения списка требуется нативный модуль</Text>
              </View>
            )}
            
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setShowBluetoothDevicesModal(false)}
              >
                <Text style={styles.modalButtonTextCancel}>Закрыть</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, { backgroundColor: '#2d2d5f' }]}
                onPress={() => {
                  setShowBluetoothDevicesModal(false);
                  setDeviceName('');
                  setShowDeviceModal(true);
                }}
              >
                <Text style={styles.modalButtonTextCancel}>Добавить вручную</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#1a1a3e',
    borderBottomWidth: 2,
    borderBottomColor: '#2d2d5f',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#00d4ff',
  },
  placeholder: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#8b94a8',
  },
  content: {
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    margin: 16,
    padding: 16,
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#2d2d5f',
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#c7cad9',
    lineHeight: 20,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#00d4ff',
    marginBottom: 16,
  },
  modeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#2d2d5f',
    gap: 12,
  },
  modeOptionActive: {
    borderColor: '#00d4ff',
    backgroundColor: '#1e2547',
  },
  modeInfo: {
    flex: 1,
  },
  modeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#c7cad9',
    marginBottom: 4,
  },
  modeTitleActive: {
    color: '#00d4ff',
  },
  modeDescription: {
    fontSize: 14,
    color: '#8b94a8',
    lineHeight: 20,
  },
  subSettings: {
    marginLeft: 16,
    marginTop: 8,
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#0f0f23',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d2d5f',
  },
  subSettingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  subSettingsTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#c7cad9',
  },
  selectedCount: {
    fontSize: 13,
    color: '#00d4ff',
    fontWeight: '600',
  },
  appOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#1a1a3e',
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2d2d5f',
    gap: 12,
  },
  appOptionActive: {
    borderColor: '#00ff88',
    backgroundColor: '#1e3a2f',
  },
  appIcon: {
    fontSize: 24,
  },
  appInfo: {
    flex: 1,
  },
  appName: {
    fontSize: 16,
    color: '#c7cad9',
    fontWeight: '500',
  },
  packageName: {
    fontSize: 12,
    color: '#8b94a8',
    marginTop: 2,
  },
  removeAppButton: {
    padding: 4,
  },
  addAppButtonsContainer: {
    gap: 8,
    marginTop: 8,
  },
  addAppButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#00d4ff',
    gap: 12,
  },
  addAppButtonPrimary: {
    borderColor: '#fbbf24',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
  },
  addAppButtonSecondary: {
    borderColor: '#00ff88',
    backgroundColor: 'rgba(0, 255, 136, 0.1)',
  },
  addAppText: {
    fontSize: 16,
    color: '#00d4ff',
    fontWeight: '600',
  },
  addAppTextPrimary: {
    color: '#fbbf24',
  },
  addAppTextSecondary: {
    color: '#00ff88',
  },
  appNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  popularBadge: {
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  popularBadgeText: {
    fontSize: 10,
    color: '#fbbf24',
    fontWeight: '600',
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#00d4ff',
    gap: 12,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#00d4ff',
  },
  deviceAddress: {
    fontSize: 12,
    color: '#8b94a8',
    marginTop: 4,
  },
  deviceHint: {
    fontSize: 12,
    color: '#8b94a8',
    marginTop: 8,
    lineHeight: 18,
    padding: 12,
    backgroundColor: '#0f0f23',
    borderRadius: 8,
  },
  removeButton: {
    padding: 4,
  },
  addDeviceButtonsContainer: {
    gap: 8,
    marginBottom: 8,
  },
  addDeviceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#2d2d5f',
    gap: 12,
  },
  addDeviceText: {
    fontSize: 16,
    color: '#00d4ff',
    fontWeight: '600',
  },
  warningText: {
    fontSize: 13,
    color: '#ff9500',
    marginTop: 8,
    fontWeight: '600',
  },
  tipsSection: {
    margin: 16,
    padding: 16,
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d2d5f',
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#c7cad9',
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: '#8b94a8',
    lineHeight: 20,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8b94a8',
    marginTop: 8,
  },
  emptyHint: {
    fontSize: 14,
    color: '#5a5f73',
    textAlign: 'center',
  },
  bottomSpacer: {
    height: 32,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1a1a3e',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 2,
    borderColor: '#2d2d5f',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#00d4ff',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#8b94a8',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  modalInput: {
    backgroundColor: '#0f0f23',
    borderWidth: 2,
    borderColor: '#2d2d5f',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#c7cad9',
    marginBottom: 12,
  },
  modalHint: {
    fontSize: 12,
    color: '#5a5f73',
    marginBottom: 20,
    lineHeight: 18,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#2d2d5f',
  },
  modalButtonSave: {
    backgroundColor: '#00d4ff',
  },
  modalButtonTextCancel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#c7cad9',
  },
  modalButtonTextSave: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f0f23',
  },
  detectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: 'rgba(0, 255, 136, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#00ff88',
    gap: 8,
    marginBottom: 12,
  },
  detectButtonText: {
    fontSize: 14,
    color: '#00ff88',
    fontWeight: '600',
  },
  popularAppsList: {
    maxHeight: 400,
    marginBottom: 16,
  },
  popularAppItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d2d5f',
    marginBottom: 8,
    gap: 12,
  },
  popularAppItemAdded: {
    borderColor: '#00ff88',
    backgroundColor: 'rgba(0, 255, 136, 0.1)',
    opacity: 0.7,
  },
  popularAppIcon: {
    fontSize: 32,
  },
  popularAppInfo: {
    flex: 1,
  },
  popularAppName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#c7cad9',
    marginBottom: 4,
  },
  popularAppCategory: {
    fontSize: 12,
    color: '#8b94a8',
    marginBottom: 2,
  },
  popularAppPackage: {
    fontSize: 11,
    color: '#5a5f73',
    fontFamily: 'monospace',
  },
});
