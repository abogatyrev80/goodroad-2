/**
 * Экран настроек звука
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import dynamicAudioService, { DynamicAudioSettings, CustomSoundItem } from '../services/DynamicAudioAlertService';

import alertSettingsService, { AlertSettings } from '../services/AlertSettingsService';
import backendConfigService, { BackendMode } from '../services/BackendConfigService';

interface CustomSound extends CustomSoundItem {}

export default function AudioSettingsScreen() {
  const [settings, setSettings] = useState<DynamicAudioSettings>(dynamicAudioService.getSettings());
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(alertSettingsService.getSettings());
  const [hasChanges, setHasChanges] = useState(false);
  const [customSounds, setCustomSounds] = useState<CustomSound[]>([]);
  const [playingSound, setPlayingSound] = useState<Audio.Sound | null>(null);
  const [backendMode, setBackendMode] = useState<BackendMode>('auto');
  const [backendUrl, setBackendUrl] = useState<string>('');
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
    loadCustomSounds();
  }, []);

  const loadSettings = async () => {
    await alertSettingsService.initialize();
    await backendConfigService.initialize();
    setSettings(dynamicAudioService.getSettings());
    setAlertSettings(alertSettingsService.getSettings());
    setBackendMode(backendConfigService.getMode());
    setBackendUrl(backendConfigService.getActiveUrl());
  };

  const loadCustomSounds = async () => {
    try {
      const stored = await AsyncStorage.getItem('custom_sounds');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setCustomSounds(parsed);
        }
      }
    } catch (error) {
      console.error('Error loading custom sounds:', error);
    }
  };

  const setBackendModeAndRefresh = async (mode: BackendMode) => {
    await backendConfigService.setMode(mode);
    setBackendMode(mode);
    setBackendUrl(backendConfigService.getActiveUrl());
    setTestResult(null);
  };

  const testBackendConnection = async () => {
    setTestResult('Проверка...');
    const url = backendConfigService.getActiveUrl();
    const result = await backendConfigService.testConnection(url);
    if (result.ok) {
      setTestResult(`OK - ${url} (${result.latencyMs}мс)`);
    } else {
      setTestResult(`Ошибка: ${result.error || 'Нет ответа'}`);
    }
  };

  const updateSetting = (key: keyof DynamicAudioSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const updateAlertSetting = (key: keyof AlertSettings, value: any) => {
    setAlertSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const saveSettings = async () => {
    await dynamicAudioService.saveSettings(settings);
    await alertSettingsService.saveSettings(alertSettings);
    setHasChanges(false);
    alert('Настройки звука сохранены!');
  };

  const pickCustomSound = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const file = result.assets[0];
      const customSound: CustomSound = {
        id: Date.now().toString(),
        name: file.name,
        uri: file.uri,
      };

      const updated = [...customSounds, customSound];
      setCustomSounds(updated);
      await AsyncStorage.setItem('custom_sounds', JSON.stringify(updated));

      Alert.alert('Успешно', `Звук "${file.name}" добавлен!`);
    } catch (error) {
      console.error('Error picking sound:', error);
      Alert.alert('Ошибка', 'Не удалось загрузить звуковой файл');
    }
  };

  const playSound = async (uri: string) => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      if (playingSound) {
        await playingSound.stopAsync();
        await playingSound.unloadAsync();
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false }
      );

      setPlayingSound(sound);
      await sound.setVolumeAsync(settings.volume || 1.0);
      await sound.playAsync();

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
          setPlayingSound(null);
        }
      });
    } catch (error: any) {
      console.error('Error playing sound:', error);
      Alert.alert('Ошибка', `Не удалось воспроизвести звук: ${error?.message || 'Неизвестная ошибка'}`);
    }
  };

  const testBeepSound = async () => {
    try {
      const themeSounds: Record<string, string> = {
        'motion-tracker': require('../assets/sounds/motion-tracker.mp3'),
        'radar-detector': require('../assets/sounds/radar-detector.mp3'),
        'radar-emergency': require('../assets/sounds/radar-emergency.mp3'),
        'warning': require('../assets/sounds/warning.mp3'),
      };
      const soundUri = themeSounds[settings.soundTheme] || themeSounds['radar-emergency'];
      await playSound(soundUri);
    } catch (error) {
      console.error('Error playing beep:', error);
      Alert.alert('Ошибка', 'Не удалось воспроизвести звук beep');
    }
  };

  const testVoiceSound = async () => {
    try {
      await Speech.stop();
      const text = `${alertSettings.customTexts.pothole || 'Яма через'} 100 метров. Рекомендуемая скорость ${alertSettings.recommendedSpeeds.pothole || 40} километров в час.`;
      await Speech.speak(text, {
        language: settings.language === 'ru' ? 'ru-RU' : 'en-US',
        rate: 1.0,
        pitch: 1.0,
        volume: settings.volume || 1.0,
      });
    } catch (error) {
      console.error('Error playing voice:', error);
      Alert.alert('Ошибка', 'Не удалось воспроизвести речь');
    }
  };

  const testFullAlert = async () => {
    try {
      // Play beep first
      const themeSounds: Record<string, string> = {
        'motion-tracker': require('../assets/sounds/motion-tracker.mp3'),
        'radar-detector': require('../assets/sounds/radar-detector.mp3'),
        'radar-emergency': require('../assets/sounds/radar-emergency.mp3'),
        'warning': require('../assets/sounds/warning.mp3'),
      };
      const soundUri = themeSounds[settings.soundTheme] || themeSounds['radar-emergency'];
      
      const { Audio } = await import('expo-av');
      const { sound } = await Audio.Sound.createAsync({ uri: soundUri });
      await sound.setVolumeAsync(settings.volume || 1.0);
      await sound.playAsync();
      
      // Wait a bit then play voice
      setTimeout(async () => {
        try {
          await Speech.stop();
          const text = `${alertSettings.customTexts.pothole || 'Яма через'} 100 метров. Рекомендуемая скорость ${alertSettings.recommendedSpeeds.pothole || 40} километров в час.`;
          await Speech.speak(text, {
            language: settings.language === 'ru' ? 'ru-RU' : 'en-US',
            rate: 1.0,
            pitch: 1.0,
            volume: settings.volume || 1.0,
          });
        } catch (e) {
          console.error('Voice error:', e);
        }
      }, 300);
    } catch (error) {
      console.error('Error in full alert test:', error);
      Alert.alert('Ошибка', 'Не удалось воспроизвести полное предупреждение');
    }
  };

  const deleteCustomSound = async (id: string) => {
    Alert.alert(
      'Удалить звук?',
      'Вы уверены, что хотите удалить этот звук?',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            const updated = customSounds.filter(s => s.id !== id);
            setCustomSounds(updated);
            await AsyncStorage.setItem('custom_sounds', JSON.stringify(updated));
          },
        },
      ]
    );
  };

  const resetToDefaults = async () => {
    Alert.alert(
      'Сбросить настройки?',
      'Сбросить все настройки звука на значения по умолчанию?',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сбросить',
          style: 'destructive',
          onPress: async () => {
            await dynamicAudioService.saveSettings({
              voiceEnabled: true,
              beepEnabled: true,
              volume: 0.8,
              language: 'ru',
              soundTheme: 'motion-tracker',
              customThemeSoundId: undefined,
              minDistance: 50,
              maxDistance: 600,
              beepIntervalAtFar: 3000,
              beepIntervalAtNear: 500,
              speedWarningEnabled: true,
            });
            await alertSettingsService.saveSettings({
              speedThresholdExcess: 20,
              recommendedSpeeds: {
                pothole: 40,
                speed_bump: 20,
                bump: 50,
                vibration: 60,
                braking: 50,
              },
              customTexts: {
                pothole: 'Яма через',
                speed_bump: 'Лежачий полицейский через',
                bump: 'Неровность через',
                vibration: 'Плохое покрытие через',
                braking: 'Место торможения через',
              },
            });
            loadSettings();
            setHasChanges(false);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Настройки звука</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Основные настройки */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Основные настройки</Text>

          <View style={styles.switchRow}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchLabel}>Голосовые предупреждения</Text>
              <Text style={styles.switchDescription}>Произносить название препятствия</Text>
            </View>
            <Switch
              value={settings.voiceEnabled}
              onValueChange={(value) => updateSetting('voiceEnabled', value)}
              trackColor={{ false: '#3e3e3e', true: '#4ade80' }}
              thumbColor={settings.voiceEnabled ? '#22c55e' : '#9ca3af'}
            />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchLabel}>Звуковая сирена (Beep)</Text>
              <Text style={styles.switchDescription}>Динамические сигналы по расстоянию</Text>
            </View>
            <Switch
              value={settings.beepEnabled}
              onValueChange={(value) => updateSetting('beepEnabled', value)}
              trackColor={{ false: '#3e3e3e', true: '#4ade80' }}
              thumbColor={settings.beepEnabled ? '#22c55e' : '#9ca3af'}
            />
          </View>

          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>Громкость: {Math.round(settings.volume * 100)}%</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={1}
              step={0.1}
              value={settings.volume}
              onValueChange={(value) => updateSetting('volume', value)}
              minimumTrackTintColor="#22c55e"
              maximumTrackTintColor="#3e3e3e"
              thumbTintColor="#22c55e"
            />
          </View>

          <Text style={styles.subSectionTitle}>Язык озвучки:</Text>
          <View style={styles.themeButtons}>
            <Pressable
              style={[
                styles.themeButton,
                settings.language === 'ru' && styles.themeButtonActive,
              ]}
              onPress={() => updateSetting('language', 'ru')}
            >
              <Text style={[
                styles.themeButtonText,
                settings.language === 'ru' && styles.themeButtonTextActive,
              ]}>
                Русский
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.themeButton,
                settings.language === 'en' && styles.themeButtonActive,
              ]}
              onPress={() => updateSetting('language', 'en')}
            >
              <Text style={[
                styles.themeButtonText,
                settings.language === 'en' && styles.themeButtonTextActive,
              ]}>
                English
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Звуковая тема */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Звуковая тема зуммера</Text>
          <Text style={styles.sectionDescription}>
            Выберите звук для предупреждений о препятствиях
          </Text>
          <View style={styles.themeButtonsWrap}>
            <Pressable
              style={[
                styles.themeButton,
                settings.soundTheme === 'motion-tracker' && styles.themeButtonActive,
              ]}
              onPress={() => updateSetting('soundTheme', 'motion-tracker')}
            >
              <Text style={[
                styles.themeButtonText,
                settings.soundTheme === 'motion-tracker' && styles.themeButtonTextActive,
              ]}>
                Датчик движения
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.themeButton,
                settings.soundTheme === 'radar-detector' && styles.themeButtonActive,
              ]}
              onPress={() => updateSetting('soundTheme', 'radar-detector')}
            >
              <Text style={[
                styles.themeButtonText,
                settings.soundTheme === 'radar-detector' && styles.themeButtonTextActive,
              ]}>
                Автомобильный радар
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Ваши звуки */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ваши звуки</Text>

          <Pressable style={styles.addSoundButton} onPress={pickCustomSound}>
            <Ionicons name="add-circle-outline" size={22} color="#00d4ff" />
            <Text style={styles.addSoundButtonText}>Добавить звук</Text>
          </Pressable>

          {customSounds.length === 0 ? (
            <Text style={styles.emptyMessage}>Нет пользовательских звуков</Text>
          ) : (
            <View style={styles.soundsList}>
              {customSounds.map((sound) => (
                <View key={sound.id} style={styles.soundItem}>
                  <View style={styles.soundInfo}>
                    <Ionicons name="musical-note" size={20} color="#00d4ff" />
                    <View style={styles.soundInfoText}>
                      <Text style={styles.soundName}>{sound.name}</Text>
                    </View>
                  </View>
                  <View style={styles.soundActions}>
                    <Pressable
                      style={styles.soundActionButton}
                      onPress={() => playSound(sound.uri)}
                    >
                      <Ionicons name="play-circle" size={24} color="#22c55e" />
                    </Pressable>
                    <Pressable
                      style={styles.soundActionButton}
                      onPress={() => deleteCustomSound(sound.id)}
                    >
                      <Ionicons name="trash" size={22} color="#ef4444" />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Логика предупреждений */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Логика предупреждений</Text>
          <Text style={styles.sectionDescription}>
            Настройте когда будут срабатывать звуковые предупреждения
          </Text>

          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Порог превышения скорости:</Text>
            <TextInput
              style={styles.input}
              value={String(alertSettings.speedThresholdExcess)}
              onChangeText={(text) => updateAlertSetting('speedThresholdExcess', parseInt(text) || 20)}
              keyboardType="number-pad"
            />
            <Text style={styles.inputUnit}>км/ч</Text>
          </View>
          <Text style={styles.sliderDescription}>
            Если превышение меньше этого значения - предупреждение только визуальное
          </Text>

          <Text style={styles.subSectionTitle}>Рекомендованная скорость:</Text>
          {Object.entries(alertSettings.recommendedSpeeds).map(([key, value]) => (
            <View key={key} style={styles.inputRow}>
              <Text style={styles.inputLabel}>
                {key === 'pothole' && 'Яма:'}
                {key === 'speed_bump' && 'Лежачий:'}
                {key === 'bump' && 'Неровность:'}
                {key === 'vibration' && 'Вибрация:'}
                {key === 'braking' && 'Торможение:'}
              </Text>
              <TextInput
                style={styles.input}
                value={String(value)}
                onChangeText={(text) => {
                  setAlertSettings(prev => ({
                    ...prev,
                    recommendedSpeeds: { ...prev.recommendedSpeeds, [key]: parseInt(text) || 40 },
                  }));
                  setHasChanges(true);
                }}
                keyboardType="number-pad"
              />
              <Text style={styles.inputUnit}>км/ч</Text>
            </View>
          ))}
        </View>

        {/* Тексты озвучки */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Тексты озвучки</Text>
          <Text style={styles.sectionDescription}>
            Настройте фразы для голосовых предупреждений
          </Text>

          {Object.entries(alertSettings.customTexts).map(([key, value]) => (
            <View key={key} style={styles.textInputRow}>
              <Text style={styles.textInputLabel}>
                {key === 'pothole' && 'Яма:'}
                {key === 'speed_bump' && 'Лежачий:'}
                {key === 'bump' && 'Неровность:'}
                {key === 'vibration' && 'Вибрация:'}
                {key === 'braking' && 'Торможение:'}
              </Text>
              <TextInput
                style={styles.textInput}
                value={value}
                onChangeText={(text) => {
                  setAlertSettings(prev => ({
                    ...prev,
                    customTexts: { ...prev.customTexts, [key]: text },
                  }));
                  setHasChanges(true);
                }}
                placeholder="Текст предупреждения"
                placeholderTextColor="#666"
              />
            </View>
          ))}
        </View>

        {/* Динамические сигналы */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Динамические сигналы (Beep)</Text>
          <Text style={styles.sectionDescription}>
            Частота сигналов увеличивается при приближении к препятствию
          </Text>

          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>
              Мин. расстояние: {settings.minDistance}м
            </Text>
            <Text style={styles.sliderDescription}>
              Ближе этого расстояния сигналы не подаются
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={10}
              maximumValue={100}
              step={5}
              value={settings.minDistance}
              onValueChange={(value) => updateSetting('minDistance', value)}
              minimumTrackTintColor="#ff3b30"
              maximumTrackTintColor="#3e3e3e"
              thumbTintColor="#ff3b30"
            />
          </View>

          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>
              Макс. расстояние: {settings.maxDistance}м
            </Text>
            <Text style={styles.sliderDescription}>
              Дальше этого расстояния сигналы не подаются
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={100}
              maximumValue={1000}
              step={50}
              value={settings.maxDistance}
              onValueChange={(value) => updateSetting('maxDistance', value)}
              minimumTrackTintColor="#fbbf24"
              maximumTrackTintColor="#3e3e3e"
              thumbTintColor="#fbbf24"
            />
          </View>

          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>
              Интервал (далеко): {(settings.beepIntervalAtFar / 1000).toFixed(1)}с
            </Text>
            <Text style={styles.sliderDescription}>
              Частота сигналов на дальнем расстоянии
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={1000}
              maximumValue={5000}
              step={500}
              value={settings.beepIntervalAtFar}
              onValueChange={(value) => updateSetting('beepIntervalAtFar', value)}
              minimumTrackTintColor="#22c55e"
              maximumTrackTintColor="#3e3e3e"
              thumbTintColor="#22c55e"
            />
          </View>

          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>
              Интервал (близко): {(settings.beepIntervalAtNear / 1000).toFixed(1)}с
            </Text>
            <Text style={styles.sliderDescription}>
              Частота сигналов на близком расстоянии
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={100}
              maximumValue={2000}
              step={100}
              value={settings.beepIntervalAtNear}
              onValueChange={(value) => updateSetting('beepIntervalAtNear', value)}
              minimumTrackTintColor="#ef4444"
              maximumTrackTintColor="#3e3e3e"
              thumbTintColor="#ef4444"
            />
          </View>
        </View>

        {/* Тестовые кнопки */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Тестирование звука и речи</Text>
          <Text style={styles.sectionDescription}>
            Проверьте как звучат предупреждения при текущих настройках
          </Text>

          <View style={styles.testButtons}>
            <Pressable style={styles.testButton} onPress={testBeepSound}>
              <Ionicons name="radio" size={24} color="#fff" />
              <Text style={styles.testButtonText}>Тест Beep (звук)</Text>
            </Pressable>

            <Pressable style={styles.testButton} onPress={testVoiceSound}>
              <Ionicons name="volume-high" size={24} color="#fff" />
              <Text style={styles.testButtonText}>Тест речи (голос)</Text>
            </Pressable>

            <Pressable style={[styles.testButton, styles.testButtonFull]} onPress={testFullAlert}>
              <Ionicons name="alert-circle" size={24} color="#fff" />
              <Text style={styles.testButtonText}>Полное предупреждение</Text>
            </Pressable>
          </View>
        </View>

        {/* Бэкенд */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Бэкенд сервер</Text>
          <Text style={styles.sectionDescription}>
            Выберите сервер для отправки данных. Автоматический режим проверяет локальный сервер (192.168.8.213:8000) и переключается на production при недоступности.
          </Text>

          <View style={styles.themeButtons}>
            <Pressable
              style={[styles.themeButton, backendMode === 'auto' && styles.themeButtonActive]}
              onPress={() => setBackendModeAndRefresh('auto')}
            >
              <Text style={[styles.themeButtonText, backendMode === 'auto' && styles.themeButtonTextActive]}>
                Авто
              </Text>
            </Pressable>
            <Pressable
              style={[styles.themeButton, backendMode === 'local' && styles.themeButtonActive]}
              onPress={() => setBackendModeAndRefresh('local')}
            >
              <Text style={[styles.themeButtonText, backendMode === 'local' && styles.themeButtonTextActive]}>
                Локальный
              </Text>
            </Pressable>
            <Pressable
              style={[styles.themeButton, backendMode === 'prod' && styles.themeButtonActive]}
              onPress={() => setBackendModeAndRefresh('prod')}
            >
              <Text style={[styles.themeButtonText, backendMode === 'prod' && styles.themeButtonTextActive]}>
                Production
              </Text>
            </Pressable>
          </View>

          <Text style={[styles.sliderDescription, { marginTop: 12 }]}>
            Текущий URL: {backendUrl}
          </Text>

          {testResult && (
            <Text style={[styles.sliderDescription, { color: testResult.startsWith('OK') ? '#22c55e' : '#ef4444', marginTop: 4 }]}>
              {testResult}
            </Text>
          )}

          <Pressable
            style={[styles.testButton, { marginTop: 12 }]}
            onPress={testBackendConnection}
          >
            <Ionicons name="wifi" size={20} color="#fff" />
            <Text style={styles.testButtonText}>Проверить соединение</Text>
          </Pressable>
        </View>

        {/* Кнопки */}
        <View style={styles.buttonContainer}>
          <Pressable
            style={[styles.button, styles.resetButton]}
            onPress={resetToDefaults}
          >
            <Text style={styles.buttonText}>Сбросить</Text>
          </Pressable>

          <Pressable
            style={[styles.button, styles.saveButton, !hasChanges && styles.buttonDisabled]}
            onPress={saveSettings}
            disabled={!hasChanges}
          >
            <Text style={styles.buttonText}>
              {hasChanges ? 'Сохранить' : 'Сохранено'}
            </Text>
          </Pressable>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backButton: {
    marginRight: 16,
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  content: {
    flex: 1,
  },
  section: {
    padding: 20,
    backgroundColor: '#1a1a1a',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#888',
    marginBottom: 16,
    lineHeight: 20,
  },
  subSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
    marginBottom: 12,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  switchInfo: {
    flex: 1,
    marginRight: 16,
  },
  switchLabel: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
    marginBottom: 4,
  },
  switchDescription: {
    fontSize: 13,
    color: '#888',
  },
  sliderContainer: {
    marginBottom: 24,
  },
  sliderLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  sliderDescription: {
    fontSize: 13,
    color: '#888',
    marginBottom: 8,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  themeButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  themeButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#2a2a2a',
    alignItems: 'center',
  },
  themeButtonActive: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  themeButtonText: {
    fontSize: 14,
    color: '#ccc',
    fontWeight: '600',
  },
  themeButtonTextActive: {
    color: '#fff',
  },
  themeButtonsWrap: {
    flexDirection: 'row',
    gap: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  inputLabel: {
    flex: 1,
    fontSize: 14,
    color: '#ccc',
  },
  input: {
    width: 80,
    height: 40,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  inputUnit: {
    marginLeft: 8,
    fontSize: 14,
    color: '#888',
    width: 50,
  },
  textInputRow: {
    marginBottom: 16,
  },
  textInputLabel: {
    fontSize: 14,
    color: '#ccc',
    marginBottom: 8,
  },
  textInput: {
    height: 44,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 16,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  resetButton: {
    backgroundColor: '#ef4444',
  },
  saveButton: {
    backgroundColor: '#22c55e',
  },
  buttonDisabled: {
    backgroundColor: '#4a5568',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  addSoundButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e3a5f',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 10,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#00d4ff',
    borderStyle: 'dashed',
  },
  addSoundButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#00d4ff',
  },
  soundsList: {
    gap: 12,
  },
  soundItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2a2a2a',
    padding: 14,
    borderRadius: 12,
  },
  soundInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  soundInfoText: {
    flex: 1,
  },
  soundName: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '500',
  },
  soundActions: {
    flexDirection: 'row',
    gap: 12,
  },
  soundActionButton: {
    padding: 4,
  },
  emptyMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: 20,
  },
  testButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  testButton: {
    flex: 1,
    minWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1e3a5f',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#00d4ff',
  },
  testButtonFull: {
    minWidth: '100%',
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  testButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
