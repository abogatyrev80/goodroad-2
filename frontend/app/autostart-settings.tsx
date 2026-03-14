/**
 * AutostartSettings V4 - Выбор любых установленных приложений
 * Пользователь может выбрать любое приложение из установленных на устройстве
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
  Platform,
  PermissionsAndroid,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { AndroidAppList } from '../services/AndroidAppList';
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


export default function AutostartSettingsScreen() {
  const insets = useSafeAreaInsets();
  const [autostartMode, setAutostartMode] = useState<AutostartMode>('disabled');
  const [selectedApps, setSelectedApps] = useState<string[]>([]); // Теперь храним packageName вместо id
  const [selectedBluetoothDevice, setSelectedBluetoothDevice] = useState<BluetoothDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoStopBluetooth, setAutoStopBluetooth] = useState(false);
  const [autoStopApps, setAutoStopApps] = useState(false);
  const [autoStopCharge, setAutoStopCharge] = useState(false);
  const [keepScreenOn, setKeepScreenOn] = useState(false);
  const [minBrightness, setMinBrightness] = useState(0.1); // 0–1, по умолчанию 10%
  
  // Модальные окна
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showAppsPickerModal, setShowAppsPickerModal] = useState(false);
  const [showBluetoothDevicesModal, setShowBluetoothDevicesModal] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [bluetoothSearchQuery, setBluetoothSearchQuery] = useState('');
  
  // Списки реальных устройств и приложений
  const [allInstalledApps, setAllInstalledApps] = useState<TriggerApp[]>([]);
  const [filteredApps, setFilteredApps] = useState<TriggerApp[]>([]);
  const [allBluetoothDevices, setAllBluetoothDevices] = useState<BluetoothDevice[]>([]);
  const [filteredBluetoothDevices, setFilteredBluetoothDevices] = useState<BluetoothDevice[]>([]);
  const [loadingInstalledApps, setLoadingInstalledApps] = useState(false);
  const [loadingBluetoothDevices, setLoadingBluetoothDevices] = useState(false);
  
  // Выбранные приложения (для отображения)
  const selectedAppsList = React.useMemo(() => {
    return allInstalledApps.filter(app => selectedApps.includes(app.packageName));
  }, [allInstalledApps, selectedApps]);

  useEffect(() => {
    loadSettings();
    // Автоматически загружаем установленные приложения при загрузке
    if (autostartMode === 'withApps') {
      loadInstalledApps();
    }
    // Автоматически загружаем Bluetooth устройства при загрузке
    if (autostartMode === 'onBluetooth') {
      loadBluetoothDevices();
    }
  }, []);

  // Загружаем приложения при выборе режима "с приложениями"
  useEffect(() => {
    if (autostartMode === 'withApps' && allInstalledApps.length === 0) {
      loadInstalledApps();
    }
  }, [autostartMode]);

  // Загружаем Bluetooth устройства при выборе режима "Bluetooth"
  useEffect(() => {
    if (autostartMode === 'onBluetooth' && allBluetoothDevices.length === 0) {
      loadBluetoothDevices();
    }
  }, [autostartMode]);

  // Фильтрация приложений по поисковому запросу
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredApps(allInstalledApps);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredApps(
        allInstalledApps.filter(app => 
          app.name.toLowerCase().includes(query) || 
          app.packageName.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, allInstalledApps]);

  // Фильтрация Bluetooth устройств по поисковому запросу
  useEffect(() => {
    if (bluetoothSearchQuery.trim() === '') {
      setFilteredBluetoothDevices(allBluetoothDevices);
    } else {
      const query = bluetoothSearchQuery.toLowerCase();
      setFilteredBluetoothDevices(
        allBluetoothDevices.filter(device => 
          device.name.toLowerCase().includes(query) || 
          (device.address && device.address.toLowerCase().includes(query))
        )
      );
    }
  }, [bluetoothSearchQuery, allBluetoothDevices]);

  const safeParseJson = <T,>(value: string | null, fallback: T): T => {
    if (value == null) return fallback;
    try {
      const parsed = JSON.parse(value);
      return parsed != null ? (parsed as T) : fallback;
    } catch {
      return fallback;
    }
  };

  const loadSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem('autostart_mode');
      if (saved) {
        setAutostartMode(saved as AutostartMode);
      }

      const savedApps = await AsyncStorage.getItem('autostart_trigger_apps');
      const savedPackageNames = safeParseJson<string[]>(savedApps, []);
      if (Array.isArray(savedPackageNames)) {
        setSelectedApps(savedPackageNames);
      }

      const savedBtDevice = await AsyncStorage.getItem('autostart_bluetooth_device');
      const btDevice = safeParseJson<{ name: string; address: string } | null>(savedBtDevice, null);
      if (btDevice && typeof btDevice.name === 'string') {
        setSelectedBluetoothDevice(btDevice);
      }

      const savedAutoStopBluetooth = await AsyncStorage.getItem('autostop_on_bluetooth_disconnect');
      setAutoStopBluetooth(safeParseJson<boolean>(savedAutoStopBluetooth, false));

      const savedAutoStopApps = await AsyncStorage.getItem('autostop_on_app_close');
      setAutoStopApps(safeParseJson<boolean>(savedAutoStopApps, false));

      const savedAutoStopCharge = await AsyncStorage.getItem('autostop_on_charge_disconnect');
      setAutoStopCharge(safeParseJson<boolean>(savedAutoStopCharge, false));
      
      const savedAutoStop = await AsyncStorage.getItem('autostart_auto_stop');
      if (savedAutoStop === 'true') {
        setAutoStopBluetooth(true);
        setAutoStopApps(true);
        setAutoStopCharge(true);
      }

      // Не выключать экран во время мониторинга
      const savedKeepScreenOn = await AsyncStorage.getItem('keep_screen_on');
      if (savedKeepScreenOn === 'true') {
        setKeepScreenOn(true);
      }

      // Минимальная яркость при мониторинге (0–1)
      const savedMinBrightness = await AsyncStorage.getItem('min_brightness');
      if (savedMinBrightness != null) {
        const value = parseFloat(savedMinBrightness);
        if (!Number.isNaN(value) && value >= 0 && value <= 1) {
          setMinBrightness(value);
        }
      }
    } catch (error) {
      console.error('Error loading autostart settings:', error);
    } finally {
      setLoading(false);
    }
  };

  // Загрузка всех установленных приложений
  const loadInstalledApps = async () => {
    try {
      setLoadingInstalledApps(true);
      const apps = await AndroidAppList.getAll();
      
      const appsList: TriggerApp[] = apps.map(app => ({
        id: app.packageName,
        name: app.appName || app.packageName,
        packageName: app.packageName,
        icon: '📱',
        category: 'Установленные',
      }));
      
      // Сортируем по имени
      appsList.sort((a, b) => a.name.localeCompare(b.name));
      
      setAllInstalledApps(appsList);
      setFilteredApps(appsList);
      console.log(`✅ Loaded ${appsList.length} installed apps`);
    } catch (error) {
      console.error('Error loading installed apps:', error);
      Alert.alert(
        'Ошибка', 
        'Не удалось загрузить список приложений. Убедитесь, что разрешение QUERY_ALL_PACKAGES предоставлено в настройках приложения.'
      );
    } finally {
      setLoadingInstalledApps(false);
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

  const toggleApp = async (packageName: string) => {
    const newSelection = selectedApps.includes(packageName)
      ? selectedApps.filter(pkg => pkg !== packageName)
      : [...selectedApps, packageName];
    
    setSelectedApps(newSelection);
    await AsyncStorage.setItem('autostart_trigger_apps', JSON.stringify(newSelection));
  };

  const removeSelectedApp = async (packageName: string) => {
    const app = allInstalledApps.find(a => a.packageName === packageName);
    if (!app) return;

    Alert.alert(
      'Удалить приложение?',
      `Вы уверены что хотите убрать "${app.name}" из списка триггеров?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            await toggleApp(packageName);
          },
        },
      ]
    );
  };


  // Запрос разрешений Bluetooth для Android 12+
  const requestBluetoothPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      return true; // iOS не требует runtime разрешений для Bluetooth
    }

    // Для Android 12+ (API 31+) требуется BLUETOOTH_CONNECT
    if (Platform.Version >= 31) {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          {
            title: 'Разрешение Bluetooth',
            message: 'Приложению требуется разрешение на доступ к Bluetooth устройствам для автозапуска.',
            buttonNeutral: 'Спросить позже',
            buttonNegative: 'Отмена',
            buttonPositive: 'OK',
          }
        );

        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          console.log('✅ BLUETOOTH_CONNECT permission granted');
          return true;
        } else {
          console.warn('⚠️ BLUETOOTH_CONNECT permission denied');
          Alert.alert(
            'Разрешение отклонено',
            'Для загрузки списка Bluetooth устройств необходимо предоставить разрешение BLUETOOTH_CONNECT. Вы можете добавить устройство вручную по имени.',
            [{ text: 'OK' }]
          );
          return false;
        }
      } catch (error) {
        console.error('Error requesting BLUETOOTH_CONNECT permission:', error);
        return false;
      }
    }

    return true; // Для старых версий Android разрешения не требуются
  };

  // Загрузка всех сопряженных Bluetooth устройств
  const loadBluetoothDevices = async () => {
    try {
      setLoadingBluetoothDevices(true);
      
      // Запрашиваем разрешения для Android 12+
      const hasPermission = await requestBluetoothPermissions();
      if (!hasPermission) {
        setAllBluetoothDevices([]);
        setFilteredBluetoothDevices([]);
        return;
      }
      
      // Проверяем, включен ли Bluetooth
      const isEnabled = await RNBluetoothClassic.isBluetoothEnabled();
      if (!isEnabled) {
        Alert.alert(
          'Bluetooth выключен',
          'Пожалуйста, включите Bluetooth в настройках устройства для загрузки списка устройств.',
          [{ text: 'OK' }]
        );
        setAllBluetoothDevices([]);
        setFilteredBluetoothDevices([]);
        return;
      }
      
      const devices = await RNBluetoothClassic.getBondedDevices();
      
      const devicesList: BluetoothDevice[] = devices.map(device => ({
        id: device.address,
        name: device.name || 'Неизвестное устройство',
        address: device.address,
      }));
      
      // Сортируем по имени
      devicesList.sort((a, b) => a.name.localeCompare(b.name));
      
      setAllBluetoothDevices(devicesList);
      setFilteredBluetoothDevices(devicesList);
      console.log(`✅ Loaded ${devicesList.length} Bluetooth devices`);
    } catch (error: any) {
      console.error('Error loading Bluetooth devices:', error);
      const errorMessage = error?.message || 'Не удалось получить список устройств';
      Alert.alert(
        'Ошибка', 
        `Не удалось загрузить список Bluetooth устройств: ${errorMessage}\n\nВы можете добавить устройство вручную по имени.`
      );
      setAllBluetoothDevices([]);
      setFilteredBluetoothDevices([]);
    } finally {
      setLoadingBluetoothDevices(false);
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
    setBluetoothSearchQuery('');
  };

  const selectAppFromPicker = async (app: TriggerApp) => {
    await toggleApp(app.packageName);
    // Не закрываем модальное окно, чтобы можно было выбрать несколько приложений
  };

  const toggleAutoStopBluetooth = async () => {
    const newValue = !autoStopBluetooth;
    setAutoStopBluetooth(newValue);
    await AsyncStorage.setItem('autostop_on_bluetooth_disconnect', JSON.stringify(newValue));
  };

  const toggleAutoStopApps = async () => {
    const newValue = !autoStopApps;
    setAutoStopApps(newValue);
    await AsyncStorage.setItem('autostop_on_app_close', JSON.stringify(newValue));
  };

  const toggleAutoStopCharge = async () => {
    const newValue = !autoStopCharge;
    setAutoStopCharge(newValue);
    await AsyncStorage.setItem('autostop_on_charge_disconnect', JSON.stringify(newValue));
  };

  const toggleKeepScreenOn = async () => {
    const newValue = !keepScreenOn;
    setKeepScreenOn(newValue);
    await AsyncStorage.setItem('keep_screen_on', JSON.stringify(newValue));
  };

  const saveMinBrightness = async (value: number) => {
    setMinBrightness(value);
    await AsyncStorage.setItem('min_brightness', String(value));
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
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00d4ff" />
          <Text style={styles.loadingText}>Загрузка...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#00d4ff" />
        </Pressable>
        <Text style={styles.headerTitle}>Автозапуск</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={true}
      >
        {/* Информация */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color="#00d4ff" />
          <Text style={styles.infoText}>
            Выберите когда мониторинг должен запускаться автоматически.
            Вы можете выбрать любое установленное приложение или Bluetooth устройство.
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
                <Text style={styles.subSettingsTitle}>Выбранные приложения:</Text>
                <Text style={styles.selectedCount}>
                  {selectedApps.length} выбрано
                </Text>
              </View>

              {/* Список выбранных приложений */}
              {selectedAppsList.length > 0 ? (
                selectedAppsList.map((app) => (
                  <Pressable
                    key={app.packageName}
                    style={styles.appOption}
                  >
                    <Text style={styles.appIcon}>{app.icon}</Text>
                    <View style={styles.appInfo}>
                      <Text style={styles.appName}>{app.name}</Text>
                      <Text style={styles.packageName}>{app.packageName}</Text>
                    </View>
                    <Pressable onPress={() => removeSelectedApp(app.packageName)} style={styles.removeAppButton}>
                      <Ionicons name="close-circle" size={20} color="#ff3b30" />
                    </Pressable>
                    <Ionicons name="checkmark-circle" size={20} color="#00ff88" />
                  </Pressable>
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="apps-outline" size={48} color="#2d2d5f" />
                  <Text style={styles.emptyText}>Нет выбранных приложений</Text>
                  <Text style={styles.emptyHint}>Нажмите кнопку ниже для выбора</Text>
                </View>
              )}

              {/* Кнопка выбора приложений */}
              <Pressable 
                style={[styles.addAppButton, styles.addAppButtonPrimary]} 
                onPress={() => {
                  if (allInstalledApps.length === 0) {
                    loadInstalledApps();
                  }
                  setShowAppsPickerModal(true);
                }}
              >
                <Ionicons name="add-circle" size={24} color="#00d4ff" />
                <Text style={styles.addAppText}>
                  {selectedApps.length > 0 ? 'Добавить еще приложения' : 'Выбрать приложения'}
                </Text>
              </Pressable>

              {selectedApps.length === 0 && (
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
              <Text style={styles.subSettingsTitle}>Выбранное устройство:</Text>
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
                <View style={styles.emptyState}>
                  <Ionicons name="bluetooth-outline" size={48} color="#2d2d5f" />
                  <Text style={styles.emptyText}>Устройство не выбрано</Text>
                  <Text style={styles.emptyHint}>Нажмите кнопку ниже для выбора</Text>
                </View>
              )}

              {/* Кнопка выбора устройства */}
              <Pressable 
                style={[styles.addAppButton, styles.addAppButtonPrimary]} 
                onPress={() => {
                  if (allBluetoothDevices.length === 0) {
                    loadBluetoothDevices();
                  }
                  setShowBluetoothDevicesModal(true);
                }}
              >
                <Ionicons name="bluetooth" size={24} color="#00d4ff" />
                <Text style={styles.addAppText}>
                  {selectedBluetoothDevice ? 'Изменить устройство' : 'Выбрать устройство'}
                </Text>
              </Pressable>

              {/* Кнопка добавления вручную (fallback) */}
              {allBluetoothDevices.length === 0 && (
                <Pressable 
                  style={styles.addAppButton} 
                  onPress={() => {
                    setDeviceName('');
                    setShowDeviceModal(true);
                  }}
                >
                  <Ionicons name="add-circle" size={24} color="#00d4ff" />
                  <Text style={styles.addAppText}>Добавить по имени вручную</Text>
                </Pressable>
              )}

              {!selectedBluetoothDevice && (
                <Text style={styles.warningText}>⚠️ Выберите Bluetooth устройство</Text>
              )}
            </View>
          )}
        </View>

        {/* Автоматическая остановка для Bluetooth */}
        {autostartMode === 'onBluetooth' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Автоматическая остановка</Text>
            <Pressable
              style={[styles.modeOption, autoStopBluetooth && styles.modeOptionActive]}
              onPress={toggleAutoStopBluetooth}
            >
              <Ionicons
                name={autoStopBluetooth ? "stop-circle" : "stop-circle-outline"}
                size={32}
                color={autoStopBluetooth ? '#00d4ff' : '#8b94a8'}
              />
              <View style={styles.modeInfo}>
                <Text style={[styles.modeTitle, autoStopBluetooth && styles.modeTitleActive]}>
                  Остановка при отключении Bluetooth
                </Text>
                <Text style={styles.modeDescription}>
                  {autoStopBluetooth 
                    ? 'Мониторинг будет автоматически останавливаться при разрыве Bluetooth соединения'
                    : 'Мониторинг будет работать до ручной остановки'}
                </Text>
              </View>
              {autoStopBluetooth && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
            </Pressable>
          </View>
        )}

        {/* Автоматическая остановка для приложений */}
        {autostartMode === 'withApps' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Автоматическая остановка</Text>
            <Pressable
              style={[styles.modeOption, autoStopApps && styles.modeOptionActive]}
              onPress={toggleAutoStopApps}
            >
              <Ionicons
                name={autoStopApps ? "stop-circle" : "stop-circle-outline"}
                size={32}
                color={autoStopApps ? '#00d4ff' : '#8b94a8'}
              />
              <View style={styles.modeInfo}>
                <Text style={[styles.modeTitle, autoStopApps && styles.modeTitleActive]}>
                  Остановка при закрытии приложения
                </Text>
                <Text style={styles.modeDescription}>
                  {autoStopApps 
                    ? 'Мониторинг будет автоматически останавливаться при закрытии всех триггерных приложений'
                    : 'Мониторинг будет работать до ручной остановки'}
                </Text>
              </View>
              {autoStopApps && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
            </Pressable>
          </View>
        )}

        {/* Автоматическая остановка для зарядки */}
        {autostartMode === 'onCharge' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Автоматическая остановка</Text>
            <Pressable
              style={[styles.modeOption, autoStopCharge && styles.modeOptionActive]}
              onPress={toggleAutoStopCharge}
            >
              <Ionicons
                name={autoStopCharge ? "stop-circle" : "stop-circle-outline"}
                size={32}
                color={autoStopCharge ? '#00d4ff' : '#8b94a8'}
              />
              <View style={styles.modeInfo}>
                <Text style={[styles.modeTitle, autoStopCharge && styles.modeTitleActive]}>
                  Остановка при отключении зарядки
                </Text>
                <Text style={styles.modeDescription}>
                  {autoStopCharge 
                    ? 'Мониторинг будет автоматически останавливаться при отключении устройства от зарядки'
                    : 'Мониторинг будет работать до ручной остановки'}
                </Text>
              </View>
              {autoStopCharge && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
            </Pressable>
          </View>
        )}

        {/* Не выключать экран во время мониторинга */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Во время мониторинга</Text>
          <Pressable
            style={[styles.modeOption, keepScreenOn && styles.modeOptionActive]}
            onPress={toggleKeepScreenOn}
          >
            <Ionicons
              name={keepScreenOn ? 'sunny' : 'sunny-outline'}
              size={32}
              color={keepScreenOn ? '#00d4ff' : '#8b94a8'}
            />
            <View style={styles.modeInfo}>
              <Text style={[styles.modeTitle, keepScreenOn && styles.modeTitleActive]}>
                Не выключать экран
              </Text>
              <Text style={styles.modeDescription}>
                {keepScreenOn
                  ? 'Экран остаётся включённым — акселерометр работает при Android Auto'
                  : 'Экран может гаснуть — акселерометр не работает при выключенном экране'}
              </Text>
            </View>
            {keepScreenOn && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
          </Pressable>

          {/* Минимальная яркость при мониторинге */}
          <View style={styles.brightnessRow}>
            <Ionicons name="sunny" size={20} color="#8b94a8" />
            <Text style={styles.brightnessLabel}>
              Минимальная яркость: {Math.round(minBrightness * 100)}%
            </Text>
          </View>
          <Slider
            style={styles.brightnessSlider}
            minimumValue={0}
            maximumValue={1}
            step={0.05}
            value={minBrightness}
            onValueChange={saveMinBrightness}
            minimumTrackTintColor="#00d4ff"
            maximumTrackTintColor="#2d2d5f"
            thumbTintColor="#00d4ff"
          />
          <Text style={styles.brightnessHint}>
            При включённом «Не выключать экран» яркость снизится до этого значения во время мониторинга
          </Text>
        </View>

        {/* Советы */}
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>💡 Советы</Text>
          
          <View style={styles.tipItem}>
            <Ionicons name="apps" size={16} color="#00d4ff" />
            <Text style={styles.tipText}>
              Выберите любое установленное приложение из списка - навигация, музыка, такси и другие
            </Text>
          </View>

          <View style={styles.tipItem}>
            <Ionicons name="bluetooth" size={16} color="#00d4ff" />
            <Text style={styles.tipText}>
              Для Bluetooth выберите устройство из списка сопряженных устройств или добавьте по имени
            </Text>
          </View>

          <View style={styles.tipItem}>
            <Ionicons name="search" size={16} color="#00ff88" />
            <Text style={styles.tipText}>
              Используйте поиск для быстрого нахождения нужного приложения или устройства
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

      {/* Modal для выбора приложений из установленных */}
      <Modal
        visible={showAppsPickerModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowAppsPickerModal(false);
          setSearchQuery('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Выберите приложения</Text>
            <Text style={styles.modalSubtitle}>
              Выберите приложения из списка установленных на устройстве
            </Text>
            
            {/* Поиск */}
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={20} color="#8b94a8" />
              <TextInput
                style={styles.searchInput}
                placeholder="Поиск приложений..."
                placeholderTextColor="#8b94a8"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={20} color="#8b94a8" />
                </Pressable>
              )}
            </View>
            
            {loadingInstalledApps ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#00d4ff" />
                <Text style={styles.loadingText}>Загрузка приложений...</Text>
              </View>
            ) : filteredApps.length > 0 ? (
              <ScrollView style={styles.popularAppsList} showsVerticalScrollIndicator={false}>
                {filteredApps.map((app) => {
                  const isSelected = selectedApps.includes(app.packageName);
                  return (
                    <Pressable
                      key={app.packageName}
                      style={[styles.popularAppItem, isSelected && styles.popularAppItemAdded]}
                      onPress={() => selectAppFromPicker(app)}
                    >
                      <Text style={styles.popularAppIcon}>{app.icon}</Text>
                      <View style={styles.popularAppInfo}>
                        <Text style={styles.popularAppName}>{app.name}</Text>
                        <Text style={styles.popularAppPackage}>{app.packageName}</Text>
                      </View>
                      {isSelected ? (
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
                <Text style={styles.emptyText}>
                  {searchQuery ? 'Ничего не найдено' : 'Список приложений пуст'}
                </Text>
                {!searchQuery && (
                  <Text style={styles.emptyHint}>
                    Нажмите кнопку "Обновить" для загрузки списка
                  </Text>
                )}
              </View>
            )}
            
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  setShowAppsPickerModal(false);
                  setSearchQuery('');
                }}
              >
                <Text style={styles.modalButtonTextCancel}>Закрыть</Text>
              </Pressable>
              {allInstalledApps.length === 0 && (
                <Pressable
                  style={[styles.modalButton, styles.modalButtonSave]}
                  onPress={loadInstalledApps}
                >
                  <Text style={styles.modalButtonTextSave}>Обновить</Text>
                </Pressable>
              )}
            </View>
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


      {/* Modal для выбора Bluetooth устройств */}
      <Modal
        visible={showBluetoothDevicesModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowBluetoothDevicesModal(false);
          setBluetoothSearchQuery('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Выберите Bluetooth устройство</Text>
            <Text style={styles.modalSubtitle}>
              Выберите устройство из списка сопряженных устройств
            </Text>
            
            {/* Поиск */}
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={20} color="#8b94a8" />
              <TextInput
                style={styles.searchInput}
                placeholder="Поиск устройств..."
                placeholderTextColor="#8b94a8"
                value={bluetoothSearchQuery}
                onChangeText={setBluetoothSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {bluetoothSearchQuery.length > 0 && (
                <Pressable onPress={() => setBluetoothSearchQuery('')}>
                  <Ionicons name="close-circle" size={20} color="#8b94a8" />
                </Pressable>
              )}
            </View>
            
            {loadingBluetoothDevices ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#00d4ff" />
                <Text style={styles.loadingText}>Загрузка устройств...</Text>
              </View>
            ) : filteredBluetoothDevices.length > 0 ? (
              <ScrollView style={styles.popularAppsList} showsVerticalScrollIndicator={false}>
                {filteredBluetoothDevices.map((device) => {
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
                <Text style={styles.emptyText}>
                  {bluetoothSearchQuery ? 'Ничего не найдено' : 'Список устройств пуст'}
                </Text>
                {!bluetoothSearchQuery && (
                  <Text style={styles.emptyHint}>
                    Убедитесь, что Bluetooth включен и устройства сопряжены. Нажмите "Обновить" для повторной загрузки.
                  </Text>
                )}
              </View>
            )}
            
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  setShowBluetoothDevicesModal(false);
                  setBluetoothSearchQuery('');
                }}
              >
                <Text style={styles.modalButtonTextCancel}>Закрыть</Text>
              </Pressable>
              {allBluetoothDevices.length === 0 && (
                <Pressable
                  style={[styles.modalButton, styles.modalButtonSave]}
                  onPress={loadBluetoothDevices}
                >
                  <Text style={styles.modalButtonTextSave}>Обновить</Text>
                </Pressable>
              )}
              {allBluetoothDevices.length > 0 && (
                <Pressable
                  style={[styles.modalButton, { backgroundColor: '#2d2d5f' }]}
                  onPress={() => {
                    setShowBluetoothDevicesModal(false);
                    setBluetoothSearchQuery('');
                    setDeviceName('');
                    setShowDeviceModal(true);
                  }}
                >
                  <Text style={styles.modalButtonTextCancel}>Добавить вручную</Text>
                </Pressable>
              )}
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
  brightnessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 4,
  },
  brightnessLabel: {
    fontSize: 14,
    color: '#c7cad9',
    flex: 1,
  },
  brightnessSlider: {
    width: '100%',
    height: 40,
  },
  brightnessHint: {
    fontSize: 12,
    color: '#8b94a8',
    marginTop: 4,
    marginBottom: 8,
    lineHeight: 18,
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
    height: 24,
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f0f23',
    borderWidth: 2,
    borderColor: '#2d2d5f',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#c7cad9',
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
