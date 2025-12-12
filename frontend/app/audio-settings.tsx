/**
 * Объединенный экран настроек звука
 * Включает: Аудио настройки + Динамические сигналы
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Slider from '@react-native-community/slider';
import dynamicAudioService, { DynamicAudioSettings } from '../services/DynamicAudioAlertService';

export default function AudioSettingsScreen() {
  const [settings, setSettings] = useState<DynamicAudioSettings>(dynamicAudioService.getSettings());
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const current = dynamicAudioService.getSettings();
    setSettings(current);
  };

  const updateSetting = (key: keyof DynamicAudioSettings, value: any) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    setHasChanges(true);
  };

  const saveSettings = async () => {
    await dynamicAudioService.saveSettings(settings);
    setHasChanges(false);
    alert('✅ Настройки звука сохранены!');
  };

  const resetToDefaults = async () => {
    if (confirm('Сбросить все настройки звука на значения по умолчанию?')) {
      await dynamicAudioService.saveSettings({
        voiceEnabled: true,
        beepEnabled: true,
        volume: 0.8,
        language: 'ru',
        soundTheme: 'motion-tracker',
        theme: 'moderate',
        minDistance: 30,
        maxDistance: 300,
        minSpeed: 5,
        beepStartDistance: 200,
        beepIntervalAtFar: 3000,
        beepIntervalAtNear: 500,
        speedWarningEnabled: true,
        recommendedSpeeds: {
          'pothole': 40,
          'speed_bump': 20,
          'bump': 50,
          'vibration': 60,
          'braking': 50,
        },
        speedThresholdExcess: 20,
        customTexts: {
          'pothole': 'Яма через',
          'speed_bump': 'Лежачий полицейский через',
          'bump': 'Неровность через',
          'vibration': 'Плохое покрытие через',
          'braking': 'Место торможения через',
        },
      });
      loadSettings();
      setHasChanges(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>🔊 Настройки звука</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* 🆕 Звуковая тема */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎵 Звуковая тема зуммера</Text>
          <Text style={styles.sectionDescription}>
            Выберите звук для предупреждений о препятствиях
          </Text>
          <View style={styles.themeButtons}>
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
                👽 "Чужие"
              </Text>
              <Text style={styles.themeButtonSubtext}>Датчик движения</Text>
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
                📡 "Радар детектор"
              </Text>
              <Text style={styles.themeButtonSubtext}>Автомобильный радар</Text>
            </Pressable>
          </View>
        </View>

        {/* Основные настройки */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎙️ Основные настройки</Text>
          
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

          {/* Громкость */}
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

          {/* Язык */}
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
                🇷🇺 Русский
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
                🇬🇧 English
              </Text>
            </Pressable>
          </View>

          {/* Тема звука */}
          <Text style={styles.subSectionTitle}>Тема звуковых сигналов:</Text>
          <Text style={styles.sliderDescription}>
            Выберите стиль звуковых сигналов для предупреждений
          </Text>
          <View style={styles.themeButtons}>
            <Pressable
              style={[
                styles.themeButton,
                settings.theme === 'gentle' && styles.themeButtonActive,
              ]}
              onPress={() => updateSetting('theme', 'gentle')}
            >
              <Text style={[
                styles.themeButtonText,
                settings.theme === 'gentle' && styles.themeButtonTextActive,
              ]}>
                🌸 Мягкая
              </Text>
            </Pressable>
            
            <Pressable
              style={[
                styles.themeButton,
                settings.theme === 'moderate' && styles.themeButtonActive,
              ]}
              onPress={() => updateSetting('theme', 'moderate')}
            >
              <Text style={[
                styles.themeButtonText,
                settings.theme === 'moderate' && styles.themeButtonTextActive,
              ]}>
                🔔 Средняя
              </Text>
            </Pressable>
            
            <Pressable
              style={[
                styles.themeButton,
                settings.theme === 'urgent' && styles.themeButtonActive,
              ]}
              onPress={() => updateSetting('theme', 'urgent')}
            >
              <Text style={[
                styles.themeButtonText,
                settings.theme === 'urgent' && styles.themeButtonTextActive,
              ]}>
                🚨 Срочная
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Динамические сигналы */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📡 Динамические сигналы (Beep)</Text>
          <Text style={styles.sectionDescription}>
            Частота сигналов увеличивается при приближении к препятствию
          </Text>

          {/* Минимальное расстояние */}
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

          {/* Максимальное расстояние */}
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

          {/* Минимальная скорость */}
          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>
              Мин. скорость: {settings.minSpeed} м/с ({Math.round(settings.minSpeed * 3.6)} км/ч)
            </Text>
            <Text style={styles.sliderDescription}>
              Ниже этой скорости сигналы не подаются
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={20}
              step={1}
              value={settings.minSpeed}
              onValueChange={(value) => updateSetting('minSpeed', value)}
              minimumTrackTintColor="#60a5fa"
              maximumTrackTintColor="#3e3e3e"
              thumbTintColor="#60a5fa"
            />
          </View>

          {/* Расстояние начала сигналов */}
          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>
              Начало сигналов: {settings.beepStartDistance}м
            </Text>
            <Text style={styles.sliderDescription}>
              На каком расстоянии начинать подавать сигналы
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={50}
              maximumValue={500}
              step={25}
              value={settings.beepStartDistance}
              onValueChange={(value) => updateSetting('beepStartDistance', value)}
              minimumTrackTintColor="#a855f7"
              maximumTrackTintColor="#3e3e3e"
              thumbTintColor="#a855f7"
            />
          </View>

          {/* Интервал на дальнем расстоянии */}
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

          {/* Интервал на близком расстоянии */}
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

        {/* Кнопки */}
        <View style={styles.buttonContainer}>
          <Pressable
            style={[styles.button, styles.resetButton]}
            onPress={resetToDefaults}
          >
            <Text style={styles.buttonText}>🔄 Сбросить</Text>
          </Pressable>

          <Pressable
            style={[styles.button, styles.saveButton, !hasChanges && styles.buttonDisabled]}
            onPress={saveSettings}
            disabled={!hasChanges}
          >
            <Text style={styles.buttonText}>
              {hasChanges ? '💾 Сохранить' : '✅ Сохранено'}
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
});
