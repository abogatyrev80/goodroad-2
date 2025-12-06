/**
 * AutostartSettings - Продвинутые настройки автозапуска мониторинга
 * Поддержка запуска с навигацией и при подключении Bluetooth устройств
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  Pressable,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

type AutostartMode = 'disabled' | 'onCharge' | 'withNavigation' | 'onBluetooth';

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

// Популярные приложения по категориям
const POPULAR_APPS: TriggerApp[] = [
  // Навигация
  { id: 'google-maps', name: 'Google Maps', packageName: 'com.google.android.apps.maps', icon: '🗺️', category: 'Навигация' },
  { id: 'yandex-maps', name: 'Яндекс.Карты', packageName: 'ru.yandex.yandexmaps', icon: '🗺️', category: 'Навигация' },
  { id: 'yandex-navi', name: 'Яндекс.Навигатор', packageName: 'ru.yandex.yandexnavi', icon: '🧭', category: 'Навигация' },
  { id: 'waze', name: 'Waze', packageName: 'com.waze', icon: '🚗', category: 'Навигация' },
  { id: '2gis', name: '2GIS', packageName: 'ru.dublgis.dgismobile', icon: '🗺️', category: 'Навигация' },
  { id: 'apple-maps', name: 'Apple Maps', packageName: 'com.apple.Maps', icon: '🗺️', category: 'Навигация' },
  { id: 'here-maps', name: 'HERE WeGo', packageName: 'com.here.app.maps', icon: '🗺️', category: 'Навигация' },
  { id: 'sygic', name: 'Sygic GPS Navigation', packageName: 'com.sygic.aura', icon: '🧭', category: 'Навигация' },
  
  // Такси и каршеринг
  { id: 'yandex-taxi', name: 'Яндекс Go', packageName: 'ru.yandex.taxi', icon: '🚕', category: 'Такси' },
  { id: 'uber', name: 'Uber', packageName: 'com.ubercab', icon: '🚕', category: 'Такси' },
  { id: 'bolt', name: 'Bolt', packageName: 'ee.mtakso.client', icon: '🚕', category: 'Такси' },
  { id: 'citymobil', name: 'Ситимобил', packageName: 'com.citymobil', icon: '🚕', category: 'Такси' },
  { id: 'yandex-drive', name: 'Яндекс Драйв', packageName: 'ru.yandex.drive', icon: '🚗', category: 'Каршеринг' },
  { id: 'delimobil', name: 'Делимобиль', packageName: 'com.carsharing.delimobil', icon: '🚗', category: 'Каршеринг' },
  
  // Музыка (часто используется в машине)
  { id: 'spotify', name: 'Spotify', packageName: 'com.spotify.music', icon: '🎵', category: 'Музыка' },
  { id: 'yandex-music', name: 'Яндекс Музыка', packageName: 'ru.yandex.music', icon: '🎵', category: 'Музыка' },
  { id: 'apple-music', name: 'Apple Music', packageName: 'com.apple.android.music', icon: '🎵', category: 'Музыка' },
];

export default function AutostartSettingsScreen() {
  const [autostartMode, setAutostartMode] = useState<AutostartMode>('disabled');
  const [selectedNavApps, setSelectedNavApps] = useState<string[]>([]);
  const [selectedBluetoothDevice, setSelectedBluetoothDevice] = useState<BluetoothDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanningBluetooth, setScanningBluetooth] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem('autostart_mode');
      if (saved) {
        setAutostartMode(saved as AutostartMode);
      }

      const savedNavApps = await AsyncStorage.getItem('autostart_nav_apps');
      if (savedNavApps) {
        setSelectedNavApps(JSON.parse(savedNavApps));
      }

      const savedBtDevice = await AsyncStorage.getItem('autostart_bluetooth_device');
      if (savedBtDevice) {
        setSelectedBluetoothDevice(JSON.parse(savedBtDevice));
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

  const toggleNavigationApp = async (appId: string) => {
    const newSelection = selectedNavApps.includes(appId)
      ? selectedNavApps.filter(id => id !== appId)
      : [...selectedNavApps, appId];
    
    setSelectedNavApps(newSelection);
    await AsyncStorage.setItem('autostart_nav_apps', JSON.stringify(newSelection));
  };

  const scanBluetoothDevices = async () => {
    Alert.alert(
      'Добавить Bluetooth устройство',
      'Введите имя вашего Bluetooth устройства (например: "Car Audio", "Toyota Camry", "My Headset")',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Добавить',
          onPress: () => {
            Alert.prompt(
              'Имя устройства',
              'Введите имя устройства:',
              async (deviceName) => {
                if (deviceName && deviceName.trim()) {
                  const device: BluetoothDevice = {
                    id: Date.now().toString(),
                    name: deviceName.trim(),
                  };
                  setSelectedBluetoothDevice(device);
                  await AsyncStorage.setItem('autostart_bluetooth_device', JSON.stringify(device));
                  Alert.alert('Успех ✅', `Устройство "${deviceName}" добавлено`);
                }
              }
            );
          },
        },
      ]
    );
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

  const getModeText = (mode: AutostartMode): string => {
    switch (mode) {
      case 'disabled':
        return 'Выключен';
      case 'onCharge':
        return 'При зарядке';
      case 'withNavigation':
        return 'С навигацией';
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
      case 'withNavigation':
        return 'Автозапуск с выбранными навигационными приложениями';
      case 'onBluetooth':
        return 'Автозапуск при подключении к выбранному Bluetooth устройству';
    }
  };

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
            Выберите когда мониторинг дороги должен запускаться автоматически. 
            Вы всегда можете запустить или остановить его вручную.
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
              <Text
                style={[
                  styles.modeTitle,
                  autostartMode === 'disabled' && styles.modeTitleActive,
                ]}
              >
                Выключен
              </Text>
              <Text style={styles.modeDescription}>{getModeDescription('disabled')}</Text>
            </View>
            {autostartMode === 'disabled' && (
              <Ionicons name="checkmark-circle" size={24} color="#00ff88" />
            )}
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
              <Text
                style={[
                  styles.modeTitle,
                  autostartMode === 'onCharge' && styles.modeTitleActive,
                ]}
              >
                При зарядке
              </Text>
              <Text style={styles.modeDescription}>{getModeDescription('onCharge')}</Text>
            </View>
            {autostartMode === 'onCharge' && (
              <Ionicons name="checkmark-circle" size={24} color="#00ff88" />
            )}
          </Pressable>

          {/* С навигацией */}
          <Pressable
            style={[
              styles.modeOption,
              autostartMode === 'withNavigation' && styles.modeOptionActive,
            ]}
            onPress={() => saveSettings('withNavigation')}
          >
            <Ionicons
              name="navigate"
              size={32}
              color={autostartMode === 'withNavigation' ? '#00d4ff' : '#8b94a8'}
            />
            <View style={styles.modeInfo}>
              <Text
                style={[
                  styles.modeTitle,
                  autostartMode === 'withNavigation' && styles.modeTitleActive,
                ]}
              >
                С навигацией
              </Text>
              <Text style={styles.modeDescription}>{getModeDescription('withNavigation')}</Text>
            </View>
            {autostartMode === 'withNavigation' && (
              <Ionicons name="checkmark-circle" size={24} color="#00ff88" />
            )}
          </Pressable>

          {/* Выбор навигационных приложений */}
          {autostartMode === 'withNavigation' && (
            <View style={styles.subSettings}>
              <Text style={styles.subSettingsTitle}>Выберите приложения:</Text>
              {NAVIGATION_APPS.map((app) => (
                <Pressable
                  key={app.id}
                  style={[
                    styles.appOption,
                    selectedNavApps.includes(app.id) && styles.appOptionActive,
                  ]}
                  onPress={() => toggleNavigationApp(app.id)}
                >
                  <Text style={styles.appIcon}>{app.icon}</Text>
                  <Text style={styles.appName}>{app.name}</Text>
                  {selectedNavApps.includes(app.id) && (
                    <Ionicons name="checkmark-circle" size={20} color="#00ff88" />
                  )}
                </Pressable>
              ))}
              {selectedNavApps.length === 0 && (
                <Text style={styles.warningText}>⚠️ Выберите хотя бы одно приложение</Text>
              )}
            </View>
          )}

          {/* При Bluetooth */}
          <Pressable
            style={[
              styles.modeOption,
              autostartMode === 'onBluetooth' && styles.modeOptionActive,
            ]}
            onPress={() => saveSettings('onBluetooth')}
          >
            <Ionicons
              name="bluetooth"
              size={32}
              color={autostartMode === 'onBluetooth' ? '#00d4ff' : '#8b94a8'}
            />
            <View style={styles.modeInfo}>
              <Text
                style={[
                  styles.modeTitle,
                  autostartMode === 'onBluetooth' && styles.modeTitleActive,
                ]}
              >
                Bluetooth устройство
              </Text>
              <Text style={styles.modeDescription}>{getModeDescription('onBluetooth')}</Text>
            </View>
            {autostartMode === 'onBluetooth' && (
              <Ionicons name="checkmark-circle" size={24} color="#00ff88" />
            )}
          </Pressable>

          {/* Выбор Bluetooth устройства */}
          {autostartMode === 'onBluetooth' && (
            <View style={styles.subSettings}>
              <Text style={styles.subSettingsTitle}>Устройство:</Text>
              {selectedBluetoothDevice ? (
                <View style={styles.deviceCard}>
                  <Ionicons name="bluetooth" size={24} color="#00d4ff" />
                  <Text style={styles.deviceName}>{selectedBluetoothDevice.name}</Text>
                  <Pressable onPress={clearBluetoothDevice} style={styles.removeButton}>
                    <Ionicons name="close-circle" size={24} color="#ff3b30" />
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.addDeviceButton} onPress={scanBluetoothDevices}>
                  <Ionicons name="add-circle" size={24} color="#00d4ff" />
                  <Text style={styles.addDeviceText}>Добавить устройство</Text>
                </Pressable>
              )}
              {!selectedBluetoothDevice && (
                <Text style={styles.warningText}>⚠️ Добавьте Bluetooth устройство</Text>
              )}
            </View>
          )}
        </View>

        {/* Советы */}
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>💡 Советы</Text>
          
          <View style={styles.tipItem}>
            <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
            <Text style={styles.tipText}>
              Режим "С навигацией" идеален для постоянного использования - мониторинг запустится только когда вы начнете навигацию
            </Text>
          </View>

          <View style={styles.tipItem}>
            <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
            <Text style={styles.tipText}>
              Режим "Bluetooth" удобен если ваш телефон автоматически подключается к аудиосистеме автомобиля
            </Text>
          </View>

          <View style={styles.tipItem}>
            <Ionicons name="battery-charging" size={16} color="#f59e0b" />
            <Text style={styles.tipText}>
              Мониторинг потребляет больше энергии из-за постоянного использования GPS и акселерометра
            </Text>
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
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
  subSettingsTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#c7cad9',
    marginBottom: 12,
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
  appName: {
    flex: 1,
    fontSize: 16,
    color: '#c7cad9',
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
  deviceName: {
    flex: 1,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#00d4ff',
  },
  removeButton: {
    padding: 4,
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
  bottomSpacer: {
    height: 32,
  },
});
