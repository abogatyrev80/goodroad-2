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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Предустановленных приложений больше нет - пользователь добавляет сам

export default function AutostartSettingsScreen() {
  const [autostartMode, setAutostartMode] = useState<AutostartMode>('disabled');
  const [customApps, setCustomApps] = useState<TriggerApp[]>([]);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [selectedBluetoothDevice, setSelectedBluetoothDevice] = useState<BluetoothDevice | null>(null);
  const [loading, setLoading] = useState(true);

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
    Alert.prompt(
      'Добавить приложение',
      'Введите название приложения:',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Далее',
          onPress: (appName) => {
            if (!appName || !appName.trim()) return;
            
            Alert.prompt(
              'Имя пакета',
              'Введите имя пакета (Package Name):\n\nНапример:\ncom.google.android.apps.maps\nru.yandex.yandexnavi',
              [
                { text: 'Отмена', style: 'cancel' },
                {
                  text: 'Добавить',
                  onPress: async (packageName) => {
                    if (!packageName || !packageName.trim()) return;
                    
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
                    
                    Alert.alert('Успех ✅', `Приложение "${appName}" добавлено`);
                  },
                },
              ]
            );
          },
        },
      ]
    );
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

  const scanBluetoothDevices = () => {
    Alert.prompt(
      'Добавить Bluetooth устройство',
      'Введите имя вашего Bluetooth устройства\n(например: "Car Audio", "Toyota Camry")',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Добавить',
          onPress: async (deviceName) => {
            if (deviceName && deviceName.trim()) {
              const device: BluetoothDevice = {
                id: Date.now().toString(),
                name: deviceName.trim(),
              };
              setSelectedBluetoothDevice(device);
              await AsyncStorage.setItem('autostart_bluetooth_device', JSON.stringify(device));
              Alert.alert('Успех ✅', `Устройство "${deviceName}" добавлено`);
            }
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

  const allApps = [...POPULAR_APPS, ...customApps];
  const appsByCategory = allApps.filter(app => app.category === selectedCategory);

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
                <Text style={styles.subSettingsTitle}>Выберите приложения:</Text>
                <Text style={styles.selectedCount}>
                  {selectedApps.length} выбрано
                </Text>
              </View>

              {/* Табы категорий */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categories}>
                {[...CATEGORIES, ...(customApps.length > 0 ? ['Пользовательские'] : [])].map((category) => (
                  <Pressable
                    key={category}
                    style={[styles.categoryTab, selectedCategory === category && styles.categoryTabActive]}
                    onPress={() => setSelectedCategory(category)}
                  >
                    <Text style={[styles.categoryText, selectedCategory === category && styles.categoryTextActive]}>
                      {category}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {/* Список приложений */}
              {appsByCategory.map((app) => (
                <Pressable
                  key={app.id}
                  style={[styles.appOption, selectedApps.includes(app.id) && styles.appOptionActive]}
                  onPress={() => toggleApp(app.id)}
                >
                  <Text style={styles.appIcon}>{app.icon}</Text>
                  <View style={styles.appInfo}>
                    <Text style={styles.appName}>{app.name}</Text>
                    {app.isCustom && (
                      <Text style={styles.packageName}>{app.packageName}</Text>
                    )}
                  </View>
                  {app.isCustom && (
                    <Pressable onPress={() => removeCustomApp(app.id)} style={styles.removeAppButton}>
                      <Ionicons name="close-circle" size={20} color="#ff3b30" />
                    </Pressable>
                  )}
                  {selectedApps.includes(app.id) && <Ionicons name="checkmark-circle" size={20} color="#00ff88" />}
                </Pressable>
              ))}

              {/* Кнопка добавления пользовательского приложения */}
              <Pressable style={styles.addAppButton} onPress={addCustomApp}>
                <Ionicons name="add-circle" size={24} color="#00d4ff" />
                <Text style={styles.addAppText}>Добавить свое приложение</Text>
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
              Режим "С приложениями" - можете выбрать навигацию, такси или любые другие приложения
            </Text>
          </View>

          <View style={styles.tipItem}>
            <Ionicons name="add-circle" size={16} color="#00d4ff" />
            <Text style={styles.tipText}>
              Не нашли свое приложение? Добавьте его вручную через кнопку "Добавить свое приложение"
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
  categories: {
    marginBottom: 16,
  },
  categoryTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: '#1a1a3e',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2d2d5f',
  },
  categoryTabActive: {
    backgroundColor: '#00d4ff',
    borderColor: '#00d4ff',
  },
  categoryText: {
    fontSize: 14,
    color: '#8b94a8',
    fontWeight: '600',
  },
  categoryTextActive: {
    color: '#0f0f23',
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
    marginTop: 8,
  },
  addAppText: {
    fontSize: 16,
    color: '#00d4ff',
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
