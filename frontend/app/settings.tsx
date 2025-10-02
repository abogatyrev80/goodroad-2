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
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';

const SETTINGS_KEY = 'good_road_settings';

export interface HazardType {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  criticalDistance: number;
}

export interface SoundOption {
  id: string;
  name: string;
  description: string;
  isCustom: boolean;
  uri?: string;
  previewText: string;
}

export interface AppSettings {
  audioWarnings: boolean;
  vibrationWarnings: boolean;
  warningVolume: number;
  selectedSoundId: string;
  customSounds: SoundOption[];
  speedThreshold: number;
  minWarningDistance: number;
  maxWarningDistance: number;
  warningCooldown: number;
  hazardTypes: HazardType[];
}

const defaultSoundOptions: SoundOption[] = [
  {
    id: 'beep_classic',
    name: 'Классический сигнал',
    description: 'Стандартный звуковой сигнал',
    isCustom: false,
    previewText: '🔊 БИП-БИП-БИП'
  },
  {
    id: 'voice_male',
    name: 'Мужской голос',
    description: 'Голосовое предупреждение (мужской)',
    isCustom: false,
    previewText: '🗣️ "Внимание! Препятствие впереди!"'
  },
  {
    id: 'voice_female',
    name: 'Женский голос', 
    description: 'Голосовое предупреждение (женский)',
    isCustom: false,
    previewText: '🗣️ "Осторожно! Впереди препятствие!"'
  },
  {
    id: 'chime_soft',
    name: 'Мягкий колокольчик',
    description: 'Приятный мелодичный сигнал',
    isCustom: false,
    previewText: '🔔 ДИНЬ-ДИНЬ-ДИНЬ'
  },
  {
    id: 'horn_urgent',
    name: 'Срочное предупреждение',
    description: 'Громкий сигнал для экстренных случаев',
    isCustom: false,
    previewText: '📯 УУУ-УУУ-УУУ'
  }
];

const defaultHazardTypes: HazardType[] = [
  { id: 'pothole', name: 'Ямы', icon: 'alert-circle', enabled: true, criticalDistance: 50 },
  { id: 'speed_bump', name: 'Лежачие полицейские', icon: 'triangle', enabled: true, criticalDistance: 30 },
  { id: 'road_defect', name: 'Дефекты покрытия', icon: 'warning', enabled: true, criticalDistance: 40 },
  { id: 'pedestrian_crossing', name: 'Пешеходные переходы', icon: 'walk', enabled: true, criticalDistance: 60 },
  { id: 'railway_crossing', name: 'ЖД переезды', icon: 'train', enabled: true, criticalDistance: 100 },
  { id: 'unpaved_road', name: 'Грунтовое покрытие', icon: 'trail-sign', enabled: true, criticalDistance: 70 },
  { id: 'construction', name: 'Дорожные работы', icon: 'construct', enabled: true, criticalDistance: 80 },
];

const defaultSettings: AppSettings = {
  audioWarnings: true,
  vibrationWarnings: true,
  warningVolume: 0.8,
  selectedSoundId: 'beep_classic',
  customSounds: [],
  speedThreshold: 15,
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

  const adjustValue = (key: keyof AppSettings, increment: number, min: number, max: number) => {
    const currentValue = settings[key] as number;
    const newValue = Math.max(min, Math.min(max, currentValue + increment));
    updateSetting(key, newValue);
  };

  const getAllSoundOptions = () => {
    return [...defaultSoundOptions, ...settings.customSounds];
  };

  const selectSound = (soundId: string) => {
    updateSetting('selectedSoundId', soundId);
  };

  const addCustomSound = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        
        // Создаем новый звуковой объект
        const newSound: SoundOption = {
          id: `custom_${Date.now()}`,
          name: asset.name.replace(/\.[^/.]+$/, ''), // Убираем расширение
          description: 'Пользовательский звук',
          isCustom: true,
          uri: asset.uri,
          previewText: '🎵 Пользовательский звук'
        };

        // Добавляем в список пользовательских звуков
        const updatedCustomSounds = [...settings.customSounds, newSound];
        updateSetting('customSounds', updatedCustomSounds);
        
        Alert.alert('Успешно!', `Звук "${newSound.name}" добавлен`);
      }
    } catch (error) {
      console.error('Error picking audio file:', error);
      Alert.alert('Ошибка', 'Не удалось добавить аудиофайл');
    }
  };

  const deleteCustomSound = (soundId: string) => {
    Alert.alert(
      'Удалить звук?',
      'Этот звук будет удален без возможности восстановления',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            const updatedCustomSounds = settings.customSounds.filter(s => s.id !== soundId);
            updateSetting('customSounds', updatedCustomSounds);
            
            // Если удаляемый звук был выбран, переключаемся на стандартный
            if (settings.selectedSoundId === soundId) {
              updateSetting('selectedSoundId', 'beep_classic');
            }
          }
        }
      ]
    );
  };

  const testSound = async (soundOption: SoundOption) => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
      });

      let sound: Audio.Sound;
      
      if (soundOption.isCustom && soundOption.uri) {
        // Воспроизводим пользовательский файл
        const { sound: customSound } = await Audio.Sound.createAsync(
          { uri: soundOption.uri },
          { shouldPlay: true, volume: settings.warningVolume }
        );
        sound = customSound;
      } else {
        // Воспроизводим стандартные звуки (пока что простой beep)
        const { sound: defaultSound } = await Audio.Sound.createAsync(
          {
            uri: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvGUgBSuG0O/AaykEK4nS8LljIAUug8rz0LljIAUiiM7t2o0zCQ=='
          },
          { shouldPlay: true, volume: settings.warningVolume }
        );
        sound = defaultSound;
      }

      // Автоматически выгружаем звук после воспроизведения
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          sound.unloadAsync();
        }
      });

      console.log(`🔊 Testing sound: ${soundOption.name}`);
      
    } catch (error) {
      console.error('Error testing sound:', error);
      Alert.alert('Ошибка', 'Не удалось воспроизвести звук');
    }
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

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Громкость: {Math.round(settings.warningVolume * 100)}%</Text>
            <View style={styles.adjustButtons}>
              <TouchableOpacity 
                style={styles.adjustButton}
                onPress={() => adjustValue('warningVolume', -0.2, 0, 1)}
              >
                <Text style={styles.adjustButtonText}>-</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.adjustButton}
                onPress={() => adjustValue('warningVolume', 0.2, 0, 1)}
              >
                <Text style={styles.adjustButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Speed Settings */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>🚗 Настройки скорости</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>
              Отключение при скорости ниже: {settings.speedThreshold} км/ч
            </Text>
            <View style={styles.adjustButtons}>
              <TouchableOpacity 
                style={styles.adjustButton}
                onPress={() => adjustValue('speedThreshold', -5, 0, 60)}
              >
                <Text style={styles.adjustButtonText}>-5</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.adjustButton}
                onPress={() => adjustValue('speedThreshold', 5, 0, 60)}
              >
                <Text style={styles.adjustButtonText}>+5</Text>
              </TouchableOpacity>
            </View>
          </View>
          
          <Text style={styles.settingDescription}>
            Предупреждения отключаются при низкой скорости
          </Text>
        </View>

        {/* Distance Settings */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📏 Настройки дистанции</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>
              Минимальная дистанция: {settings.minWarningDistance} м
            </Text>
            <View style={styles.adjustButtons}>
              <TouchableOpacity 
                style={styles.adjustButton}
                onPress={() => adjustValue('minWarningDistance', -10, 10, 100)}
              >
                <Text style={styles.adjustButtonText}>-10</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.adjustButton}
                onPress={() => adjustValue('minWarningDistance', 10, 10, 100)}
              >
                <Text style={styles.adjustButtonText}>+10</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>
              Максимальная дистанция: {settings.maxWarningDistance} м
            </Text>
            <View style={styles.adjustButtons}>
              <TouchableOpacity 
                style={styles.adjustButton}
                onPress={() => adjustValue('maxWarningDistance', -50, 50, 500)}
              >
                <Text style={styles.adjustButtonText}>-50</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.adjustButton}
                onPress={() => adjustValue('maxWarningDistance', 50, 50, 500)}
              >
                <Text style={styles.adjustButtonText}>+50</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>
              Пауза между предупреждениями: {settings.warningCooldown} сек
            </Text>
            <View style={styles.adjustButtons}>
              <TouchableOpacity 
                style={styles.adjustButton}
                onPress={() => adjustValue('warningCooldown', -1, 1, 30)}
              >
                <Text style={styles.adjustButtonText}>-1</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.adjustButton}
                onPress={() => adjustValue('warningCooldown', 1, 1, 30)}
              >
                <Text style={styles.adjustButtonText}>+1</Text>
              </TouchableOpacity>
            </View>
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
                  <View style={styles.settingRow}>
                    <Text style={styles.hazardDistance}>
                      Критическая дистанция: {hazard.criticalDistance} м
                    </Text>
                    <View style={styles.adjustButtons}>
                      <TouchableOpacity 
                        style={styles.smallAdjustButton}
                        onPress={() => {
                          const updatedHazards = settings.hazardTypes.map(h =>
                            h.id === hazard.id 
                              ? { ...h, criticalDistance: Math.max(10, h.criticalDistance - 10) }
                              : h
                          );
                          updateSetting('hazardTypes', updatedHazards);
                        }}
                      >
                        <Text style={styles.adjustButtonText}>-10</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={styles.smallAdjustButton}
                        onPress={() => {
                          const updatedHazards = settings.hazardTypes.map(h =>
                            h.id === hazard.id 
                              ? { ...h, criticalDistance: Math.min(200, h.criticalDistance + 10) }
                              : h
                          );
                          updateSetting('hazardTypes', updatedHazards);
                        }}
                      >
                        <Text style={styles.adjustButtonText}>+10</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Test Button */}
        <TouchableOpacity 
          style={styles.testButton}
          onPress={() => Alert.alert('🚨 ТЕСТ', 'Предупреждение: впереди препятствие!')}
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
  },
  adjustButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  adjustButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 40,
    alignItems: 'center',
  },
  smallAdjustButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 36,
    alignItems: 'center',
  },
  adjustButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
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
    flex: 1,
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