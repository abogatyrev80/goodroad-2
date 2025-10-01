import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from 'react-native-slider';
import { router } from 'expo-router';

const SETTINGS_KEY = 'good_road_settings';

export interface HazardType {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  criticalDistance: number; // meters
}

export interface AppSettings {
  audioWarnings: boolean;
  vibrationWarnings: boolean;
  warningVolume: number;
  speedThreshold: number; // km/h - speed below which warnings are disabled
  minWarningDistance: number; // meters
  maxWarningDistance: number; // meters
  warningCooldown: number; // seconds
  hazardTypes: HazardType[];
}

const defaultHazardTypes: HazardType[] = [
  { id: 'pothole', name: 'Ямы', icon: 'alert-circle', enabled: true, criticalDistance: 50 },
  { id: 'speed_bump', name: 'Лежачие полицейские', icon: 'triangle', enabled: true, criticalDistance: 30 },
  { id: 'road_defect', name: 'Дефекты покрытия', icon: 'warning', enabled: true, criticalDistance: 40 },
  { id: 'pedestrian_crossing', name: 'Пешеходные переходы', icon: 'walk', enabled: true, criticalDistance: 60 },
  { id: 'railway_crossing', name: 'ЖД переезды', icon: 'train', enabled: true, criticalDistance: 100 },
  { id: 'unpaved_road', name: 'Грунтовое покрытие', icon: 'trail-sign', enabled: true, criticalDistance: 70 },
  { id: 'construction', name: 'Дорожные работы', icon: 'construct', enabled: true, criticalDistance: 80 },
  { id: 'sharp_turn', name: 'Крутые повороты', icon: 'arrow-undo', enabled: true, criticalDistance: 90 },
  { id: 'steep_slope', name: 'Крутые спуски/подъемы', icon: 'trending-up', enabled: false, criticalDistance: 60 },
  { id: 'narrow_road', name: 'Сужение дороги', icon: 'resize', enabled: false, criticalDistance: 50 },
];

const defaultSettings: AppSettings = {
  audioWarnings: true,
  vibrationWarnings: true,
  warningVolume: 0.8,
  speedThreshold: 15, // warnings disabled below 15 km/h
  minWarningDistance: 30,
  maxWarningDistance: 200,
  warningCooldown: 5,
  hazardTypes: defaultHazardTypes,
};

export default function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const storedSettings = await AsyncStorage.getItem(SETTINGS_KEY);
      if (storedSettings) {
        const parsed = JSON.parse(storedSettings);
        setSettings({ ...defaultSettings, ...parsed });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      setHasUnsavedChanges(false);
      Alert.alert('Настройки сохранены', 'Все изменения применены успешно');
    } catch (error) {
      console.error('Error saving settings:', error);
      Alert.alert('Ошибка', 'Не удалось сохранить настройки');
    }
  };

  const updateSetting = (key: keyof AppSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasUnsavedChanges(true);
  };

  const toggleHazardType = (hazardId: string) => {
    const updatedHazards = settings.hazardTypes.map(hazard =>
      hazard.id === hazardId ? { ...hazard, enabled: !hazard.enabled } : hazard
    );
    updateSetting('hazardTypes', updatedHazards);
  };

  const updateHazardDistance = (hazardId: string, distance: number) => {
    const updatedHazards = settings.hazardTypes.map(hazard =>
      hazard.id === hazardId ? { ...hazard, criticalDistance: distance } : hazard
    );
    updateSetting('hazardTypes', updatedHazards);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Настройки предупреждений</Text>
        <TouchableOpacity 
          onPress={saveSettings}
          style={[styles.saveButton, { opacity: hasUnsavedChanges ? 1 : 0.5 }]}
          disabled={!hasUnsavedChanges}
        >
          <Ionicons name="checkmark" size={24} color="#4CAF50" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Audio Settings */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>🔊 Звуковые настройки</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Звуковые предупреждения</Text>
            <Switch
              value={settings.audioWarnings}
              onValueChange={(value) => updateSetting('audioWarnings', value)}
              thumbColor={settings.audioWarnings ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Вибрация</Text>
            <Switch
              value={settings.vibrationWarnings}
              onValueChange={(value) => updateSetting('vibrationWarnings', value)}
              thumbColor={settings.vibrationWarnings ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>

          <View style={styles.sliderContainer}>
            <Text style={styles.settingLabel}>Громкость: {Math.round(settings.warningVolume * 100)}%</Text>
            <Slider
              style={styles.slider}
              value={settings.warningVolume}
              onValueChange={(value) => updateSetting('warningVolume', value)}
              minimumValue={0}
              maximumValue={1}
              thumbStyle={styles.sliderThumb}
              trackStyle={styles.sliderTrack}
              minimumTrackTintColor="#4CAF50"
              maximumTrackTintColor="#333"
            />
          </View>
        </View>

        {/* Speed Settings */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>🚗 Настройки скорости</Text>
          
          <View style={styles.sliderContainer}>
            <Text style={styles.settingLabel}>
              Отключение при скорости ниже: {settings.speedThreshold} км/ч
            </Text>
            <Text style={styles.settingDescription}>
              Предупреждения отключаются при низкой скорости
            </Text>
            <Slider
              style={styles.slider}
              value={settings.speedThreshold}
              onValueChange={(value) => updateSetting('speedThreshold', Math.round(value))}
              minimumValue={0}
              maximumValue={60}
              thumbStyle={styles.sliderThumb}
              trackStyle={styles.sliderTrack}
              minimumTrackTintColor="#2196F3"
              maximumTrackTintColor="#333"
            />
          </View>
        </View>

        {/* Distance Settings */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📏 Настройки дистанции</Text>
          
          <View style={styles.sliderContainer}>
            <Text style={styles.settingLabel}>
              Минимальная дистанция: {settings.minWarningDistance} м
            </Text>
            <Slider
              style={styles.slider}
              value={settings.minWarningDistance}
              onValueChange={(value) => updateSetting('minWarningDistance', Math.round(value))}
              minimumValue={10}
              maximumValue={100}
              thumbStyle={styles.sliderThumb}
              trackStyle={styles.sliderTrack}
              minimumTrackTintColor="#FF9800"
              maximumTrackTintColor="#333"
            />
          </View>

          <View style={styles.sliderContainer}>
            <Text style={styles.settingLabel}>
              Максимальная дистанция: {settings.maxWarningDistance} м
            </Text>
            <Slider
              style={styles.slider}
              value={settings.maxWarningDistance}
              onValueChange={(value) => updateSetting('maxWarningDistance', Math.round(value))}
              minimumValue={50}
              maximumValue={500}
              thumbStyle={styles.sliderThumb}
              trackStyle={styles.sliderTrack}
              minimumTrackTintColor="#FF9800"
              maximumTrackTintColor="#333"
            />
          </View>

          <View style={styles.sliderContainer}>
            <Text style={styles.settingLabel}>
              Пауза между предупреждениями: {settings.warningCooldown} сек
            </Text>
            <Slider
              style={styles.slider}
              value={settings.warningCooldown}
              onValueChange={(value) => updateSetting('warningCooldown', Math.round(value))}
              minimumValue={1}
              maximumValue={30}
              thumbStyle={styles.sliderThumb}
              trackStyle={styles.sliderTrack}
              minimumTrackTintColor="#9C27B0"
              maximumTrackTintColor="#333"
            />
          </View>
        </View>

        {/* Hazard Types */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>⚠️ Типы препятствий</Text>
          
          {settings.hazardTypes.map((hazard) => (
            <View key={hazard.id} style={styles.hazardContainer}>
              <View style={styles.hazardHeader}>
                <View style={styles.hazardTitleRow}>
                  <Ionicons name={hazard.icon as any} size={20} color="#4CAF50" />
                  <Text style={styles.hazardName}>{hazard.name}</Text>
                </View>
                <Switch
                  value={hazard.enabled}
                  onValueChange={() => toggleHazardType(hazard.id)}
                  thumbColor={hazard.enabled ? '#4CAF50' : '#888'}
                  trackColor={{ false: '#333', true: '#4CAF5050' }}
                />
              </View>
              
              {hazard.enabled && (
                <View style={styles.hazardSettings}>
                  <Text style={styles.hazardDistance}>
                    Критическая дистанция: {hazard.criticalDistance} м
                  </Text>
                  <Slider
                    style={styles.hazardSlider}
                    value={hazard.criticalDistance}
                    onValueChange={(value) => updateHazardDistance(hazard.id, Math.round(value))}
                    minimumValue={10}
                    maximumValue={200}
                    thumbStyle={styles.smallSliderThumb}
                    trackStyle={styles.smallSliderTrack}
                    minimumTrackTintColor="#F44336"
                    maximumTrackTintColor="#333"
                  />
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Test Button */}
        <TouchableOpacity 
          style={styles.testButton}
          onPress={() => Alert.alert('Тест', 'Предупреждение: впереди препятствие!')}
        >
          <Ionicons name="volume-high" size={20} color="white" />
          <Text style={styles.testButtonText}>Тестовое предупреждение</Text>
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 16,
  },
  saveButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  settingLabel: {
    fontSize: 14,
    color: '#ffffff',
    flex: 1,
  },
  settingDescription: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
    marginBottom: 8,
  },
  sliderContainer: {
    marginVertical: 8,
  },
  slider: {
    height: 40,
    marginTop: 8,
  },
  sliderThumb: {
    backgroundColor: '#4CAF50',
    width: 20,
    height: 20,
  },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
  },
  hazardContainer: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  hazardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hazardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  hazardName: {
    fontSize: 14,
    color: '#ffffff',
    marginLeft: 8,
  },
  hazardSettings: {
    marginTop: 12,
    paddingLeft: 28,
  },
  hazardDistance: {
    fontSize: 12,
    color: '#888',
  },
  hazardSlider: {
    height: 30,
    marginTop: 4,
  },
  smallSliderThumb: {
    backgroundColor: '#F44336',
    width: 16,
    height: 16,
  },
  smallSliderTrack: {
    height: 3,
    borderRadius: 1.5,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2196F3',
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
  },
  testButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  bottomPadding: {
    height: 40,
  },
});