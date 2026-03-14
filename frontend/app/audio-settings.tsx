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
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import dynamicAudioService, { DynamicAudioSettings, CustomSoundItem, ObstacleSoundSettings } from '../services/DynamicAudioAlertService';
import SoundManager from '../components/SoundManager';

interface CustomSound extends CustomSoundItem {}

export default function AudioSettingsScreen() {
  const [settings, setSettings] = useState<DynamicAudioSettings>(dynamicAudioService.getSettings());
  const [hasChanges, setHasChanges] = useState(false);
  const [customSounds, setCustomSounds] = useState<CustomSound[]>([]);
  const [playingSound, setPlayingSound] = useState<Audio.Sound | null>(null);

  useEffect(() => {
    loadSettings();
    loadCustomSounds();
  }, []);

  const loadSettings = async () => {
    const current = dynamicAudioService.getSettings();
    setSettings(current);
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
      
      Alert.alert('✅ Успешно', `Звук "${file.name}" добавлен!`);
    } catch (error) {
      console.error('Error picking sound:', error);
      Alert.alert('❌ Ошибка', 'Не удалось загрузить звуковой файл');
    }
  };

  const playSound = async (uri: string) => {
    try {
      // Инициализируем аудио режим
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
      
      // Останавливаем предыдущий звук если играет
      if (playingSound) {
        await playingSound.stopAsync();
        await playingSound.unloadAsync();
      }

      const { sound } = await Audio.Sound.createAsync({ 
        uri,
        volume: settings.volume || 1.0,
        shouldPlay: false 
      });
      
      setPlayingSound(sound);
      
      // Устанавливаем громкость перед воспроизведением
      await sound.setVolumeAsync(settings.volume || 1.0);
      
      await sound.playAsync();

      // Автоматически останавливаем после воспроизведения
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
          setPlayingSound(null);
        }
      });
    } catch (error: any) {
      console.error('Error playing sound:', error);
      Alert.alert('❌ Ошибка', `Не удалось воспроизвести звук: ${error?.message || 'Неизвестная ошибка'}`);
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
              obstacleSounds: {
                'pothole': { useCustom: false },
                'speed_bump': { useCustom: false },
                'bump': { useCustom: false },
                'vibration': { useCustom: false },
                'braking': { useCustom: false },
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
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>🔊 Настройки звука</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Тест звуковых оповещений */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔊 Тест звуковых оповещений</Text>
          <Text style={styles.sectionDescription}>
            Протестируйте звуки для разных типов событий. Выберите тип события, чтобы настроить и протестировать звук.
          </Text>
          <View style={styles.usageHint}>
            <Ionicons name="bulb" size={16} color="#fbbf24" />
            <Text style={styles.usageHintText}>
              Настройки из SoundManager используются в компоненте SoundManager для тестирования звуков
            </Text>
          </View>
          <View style={styles.soundManagerWrapper}>
            <SoundManager 
              hideTitle={true}
              onSave={() => {
                Alert.alert('✅ Успешно', 'Настройки звуков сохранены');
              }} 
            />
          </View>
        </View>

        {/* 🆕 Информация о звуках */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ℹ️ Где используются звуки</Text>
          
          {/* Список стандартных звуков */}
          <View style={styles.standardSoundsBox}>
            <Text style={styles.standardSoundsTitle}>📚 Стандартные звуки в приложении:</Text>
            <View style={styles.standardSoundList}>
              <View style={styles.standardSoundItem}>
                <Text style={styles.standardSoundName}>info.mp3 / radar-info.mp3</Text>
                <Text style={styles.standardSoundUsage}>Информационные предупреждения (низкая опасность)</Text>
              </View>
              <View style={styles.standardSoundItem}>
                <Text style={styles.standardSoundName}>warning.mp3 / radar-warning.mp3</Text>
                <Text style={styles.standardSoundUsage}>Обычные предупреждения (средняя опасность)</Text>
              </View>
              <View style={styles.standardSoundItem}>
                <Text style={styles.standardSoundName}>critical.mp3 / radar-critical.mp3</Text>
                <Text style={styles.standardSoundUsage}>Критические предупреждения (высокая опасность)</Text>
              </View>
              <View style={styles.standardSoundItem}>
                <Text style={styles.standardSoundName}>emergency.mp3 / radar-emergency.mp3</Text>
                <Text style={styles.standardSoundUsage}>Экстренные предупреждения (критическая опасность) + Beep-сигналы</Text>
              </View>
              <View style={styles.standardSoundItem}>
                <Text style={styles.standardSoundName}>motion-tracker.mp3</Text>
                <Text style={styles.standardSoundUsage}>Основной звук темы "Чужие" (датчик движения)</Text>
              </View>
            </View>
          </View>
          <View style={styles.infoBox}>
            <View style={styles.infoItem}>
              <Ionicons name="information-circle" size={20} color="#00d4ff" />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>🔊 Звуковая тема (Beep-сигналы)</Text>
                <Text style={styles.infoText}>
                  Используется для динамических сигналов при приближении к препятствию. Частота сигналов увеличивается по мере приближения.
                </Text>
                <Text style={styles.infoLocation}>📍 DynamicAudioAlertService → playBeep()</Text>
              </View>
            </View>
            
            <View style={styles.infoItem}>
              <Ionicons name="information-circle" size={20} color="#fbbf24" />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>🎯 Уровни срочности (AudioAlertService)</Text>
                <Text style={styles.infoText}>
                  <Text style={styles.infoBold}>info.mp3 / radar-info.mp3</Text> - Информационные предупреждения{'\n'}
                  <Text style={styles.infoBold}>warning.mp3 / radar-warning.mp3</Text> - Обычные предупреждения{'\n'}
                  <Text style={styles.infoBold}>critical.mp3 / radar-critical.mp3</Text> - Критические предупреждения{'\n'}
                  <Text style={styles.infoBold}>emergency.mp3 / radar-emergency.mp3</Text> - Экстренные предупреждения
                </Text>
                <Text style={styles.infoLocation}>📍 AudioAlertService → getSoundUri()</Text>
              </View>
            </View>
            
            <View style={styles.infoItem}>
              <Ionicons name="information-circle" size={20} color="#22c55e" />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>⚠️ Карточки предупреждений (WarningAlert)</Text>
                <Text style={styles.infoText}>
                  Используются звуки в зависимости от уровня опасности:{'\n'}
                  • Критическое (severity ≤ 1): <Text style={styles.infoBold}>emergency.mp3</Text>{'\n'}
                  • Высокое (severity ≤ 2): <Text style={styles.infoBold}>critical.mp3</Text>{'\n'}
                  • Среднее (severity ≤ 3): <Text style={styles.infoBold}>warning.mp3</Text>{'\n'}
                  • Низкое: <Text style={styles.infoBold}>info.mp3</Text>
                </Text>
                <Text style={styles.infoLocation}>📍 WarningAlert.tsx → playWarningSound()</Text>
              </View>
            </View>
            
            <View style={styles.infoItem}>
              <Ionicons name="information-circle" size={20} color="#a855f7" />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>🎵 Индивидуальные звуки препятствий</Text>
                <Text style={styles.infoText}>
                  Можно назначить свой звук для каждого типа препятствия. Если не назначен - используется общая тема.
                </Text>
                <Text style={styles.infoLocation}>📍 DynamicAudioAlertService → obstacleSounds</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 🆕 Звуковая тема */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎵 Звуковая тема зуммера</Text>
          <Text style={styles.sectionDescription}>
            Выберите звук для предупреждений о препятствиях (применяется ко всем типам препятствий, если не настроено индивидуально)
          </Text>
          <View style={styles.usageHint}>
            <Ionicons name="bulb" size={16} color="#fbbf24" />
            <Text style={styles.usageHintText}>
              Используется для динамических beep-сигналов, частота которых увеличивается при приближении к препятствию
            </Text>
          </View>
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

          {/* Свой звук как тема */}
          {customSounds.length > 0 && (
            <View style={styles.customThemeSection}>
              <Pressable
                style={[
                  styles.customThemeButton,
                  settings.soundTheme === 'custom' && styles.customThemeButtonActive,
                ]}
                onPress={() => updateSetting('soundTheme', 'custom')}
              >
                <Ionicons 
                  name="musical-notes" 
                  size={24} 
                  color={settings.soundTheme === 'custom' ? '#fff' : '#00d4ff'} 
                />
                <Text style={[
                  styles.customThemeButtonText,
                  settings.soundTheme === 'custom' && styles.customThemeButtonTextActive,
                ]}>
                  🎧 Свой звук
                </Text>
              </Pressable>

              {settings.soundTheme === 'custom' && (
                <View style={styles.customThemePicker}>
                  <Text style={styles.pickerLabel}>Выберите звук для темы:</Text>
                  {customSounds.map((sound) => (
                    <Pressable
                      key={sound.id}
                      style={[
                        styles.soundPickerItem,
                        settings.customThemeSoundId === sound.id && styles.soundPickerItemActive,
                      ]}
                      onPress={() => updateSetting('customThemeSoundId', sound.id)}
                    >
                      <View style={styles.soundPickerInfo}>
                        <Ionicons 
                          name={settings.customThemeSoundId === sound.id ? "checkmark-circle" : "musical-note"} 
                          size={20} 
                          color={settings.customThemeSoundId === sound.id ? '#22c55e' : '#00d4ff'} 
                        />
                        <Text style={[
                          styles.soundPickerName,
                          settings.customThemeSoundId === sound.id && styles.soundPickerNameActive,
                        ]} numberOfLines={1}>
                          {sound.name}
                        </Text>
                      </View>
                      <Pressable onPress={() => playSound(sound.uri)}>
                        <Ionicons name="play-circle" size={28} color="#22c55e" />
                      </Pressable>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>

        {/* 🆕 Пользовательские звуки */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📁 Ваши звуки</Text>
          <Text style={styles.sectionDescription}>
            Добавьте свои звуковые файлы для предупреждений
          </Text>

          {/* Кнопка добавления звука */}
          <Pressable style={styles.addSoundButton} onPress={pickCustomSound}>
            <Ionicons name="add-circle" size={24} color="#00d4ff" />
            <Text style={styles.addSoundButtonText}>Добавить звуковой файл</Text>
          </Pressable>

          {/* Список пользовательских звуков */}
          {customSounds.length > 0 ? (
            <View style={styles.soundsList}>
              {customSounds.map((sound) => {
                // Проверяем где используется звук
                const isThemeSound = settings.soundTheme === 'custom' && settings.customThemeSoundId === sound.id;
                const usedInObstacles = Object.entries(settings.obstacleSounds || {})
                  .filter(([_, config]) => config.useCustom && config.customSoundId === sound.id)
                  .map(([key]) => {
                    const names: Record<string, string> = {
                      'pothole': 'Яма',
                      'speed_bump': 'Лежачий полицейский',
                      'bump': 'Неровность',
                      'vibration': 'Вибрация',
                      'braking': 'Торможение',
                    };
                    return names[key] || key;
                  });
                
                return (
                  <View key={sound.id} style={styles.soundItem}>
                    <View style={styles.soundInfo}>
                      <Ionicons name="musical-note" size={20} color="#00d4ff" />
                      <View style={styles.soundInfoText}>
                        <Text style={styles.soundName} numberOfLines={1}>
                          {sound.name}
                        </Text>
                        {/* Индикаторы использования */}
                        {(isThemeSound || usedInObstacles.length > 0) && (
                          <View style={styles.soundUsageBadges}>
                            {isThemeSound && (
                              <View style={styles.usageBadge}>
                                <Ionicons name="checkmark-circle" size={12} color="#22c55e" />
                                <Text style={styles.usageBadgeText}>Тема</Text>
                              </View>
                            )}
                            {usedInObstacles.map((name, idx) => (
                              <View key={idx} style={styles.usageBadge}>
                                <Ionicons name="checkmark-circle" size={12} color="#fbbf24" />
                                <Text style={styles.usageBadgeText}>{name}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={styles.soundActions}>
                      <Pressable
                        style={styles.soundActionButton}
                        onPress={() => playSound(sound.uri)}
                      >
                        <Ionicons name="play-circle" size={28} color="#22c55e" />
                      </Pressable>
                      <Pressable
                        style={styles.soundActionButton}
                        onPress={() => deleteCustomSound(sound.id)}
                      >
                        <Ionicons name="trash" size={24} color="#ef4444" />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyMessage}>
              Пока нет пользовательских звуков. Нажмите кнопку выше, чтобы добавить свой звук.
            </Text>
          )}
        </View>

        {/* 🆕 Индивидуальные звуки для типов препятствий */}
        {customSounds.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🎯 Звуки для типов препятствий</Text>
            <Text style={styles.sectionDescription}>
              Назначьте разные звуки для каждого типа препятствия. Если не выбран свой звук - используется общая тема.
            </Text>
            <View style={styles.usageHint}>
              <Ionicons name="bulb" size={16} color="#fbbf24" />
              <Text style={styles.usageHintText}>
                Эти звуки используются в DynamicAudioAlertService при обнаружении препятствий конкретного типа
              </Text>
            </View>

            {[
              { key: 'pothole', icon: '🕳️', name: 'Яма' },
              { key: 'speed_bump', icon: '🚧', name: 'Лежачий полицейский' },
              { key: 'bump', icon: '〰️', name: 'Неровность' },
              { key: 'vibration', icon: '〰️〰️', name: 'Вибрация / Плохое покрытие' },
              { key: 'braking', icon: '🚗', name: 'Место торможения' },
            ].map((obstacle) => {
              const obstacleSound = settings.obstacleSounds?.[obstacle.key] || { useCustom: false };
              const selectedSound = obstacleSound.useCustom 
                ? customSounds.find(s => s.id === obstacleSound.customSoundId) 
                : null;

              return (
                <View key={obstacle.key} style={styles.obstacleSoundRow}>
                  <View style={styles.obstacleSoundHeader}>
                    <Text style={styles.obstacleSoundLabel}>
                      {obstacle.icon} {obstacle.name}
                    </Text>
                    <Switch
                      value={obstacleSound.useCustom}
                      onValueChange={(value) => {
                        const updated = {
                          ...settings,
                          obstacleSounds: {
                            ...settings.obstacleSounds,
                            [obstacle.key]: {
                              useCustom: value,
                              customSoundId: value ? customSounds[0]?.id : undefined,
                            },
                          },
                        };
                        setSettings(updated);
                        setHasChanges(true);
                      }}
                      trackColor={{ false: '#3e3e3e', true: '#4ade80' }}
                      thumbColor={obstacleSound.useCustom ? '#22c55e' : '#9ca3af'}
                    />
                  </View>
                  
                  {obstacleSound.useCustom ? (
                    <View style={styles.obstacleSoundPicker}>
                      {customSounds.map((sound) => (
                        <Pressable
                          key={sound.id}
                          style={[
                            styles.obstacleSoundOption,
                            obstacleSound.customSoundId === sound.id && styles.obstacleSoundOptionActive,
                          ]}
                          onPress={() => {
                            const updated = {
                              ...settings,
                              obstacleSounds: {
                                ...settings.obstacleSounds,
                                [obstacle.key]: {
                                  useCustom: true,
                                  customSoundId: sound.id,
                                },
                              },
                            };
                            setSettings(updated);
                            setHasChanges(true);
                          }}
                        >
                          <Ionicons 
                            name={obstacleSound.customSoundId === sound.id ? "checkmark-circle" : "ellipse-outline"} 
                            size={18} 
                            color={obstacleSound.customSoundId === sound.id ? '#22c55e' : '#666'} 
                          />
                          <Text 
                            style={[
                              styles.obstacleSoundOptionText,
                              obstacleSound.customSoundId === sound.id && styles.obstacleSoundOptionTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {sound.name}
                          </Text>
                          <Pressable onPress={() => playSound(sound.uri)}>
                            <Ionicons name="play" size={16} color="#22c55e" />
                          </Pressable>
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.obstacleSoundDefault}>
                      Используется общая тема: {settings.soundTheme === 'motion-tracker' ? '👽 Чужие' : settings.soundTheme === 'radar-detector' ? '📡 Радар' : '🎧 Свой звук'}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

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

        {/* 🆕 Логика предупреждений */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🚗 Логика предупреждений</Text>
          <Text style={styles.sectionDescription}>
            Настройте когда будут срабатывать звуковые предупреждения
          </Text>

          {/* Порог превышения скорости */}
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Порог превышения скорости:</Text>
            <TextInput
              style={styles.input}
              value={String(settings.speedThresholdExcess || 20)}
              onChangeText={(text) => updateSetting('speedThresholdExcess', parseInt(text) || 20)}
              keyboardType="number-pad"
            />
            <Text style={styles.inputUnit}>км/ч</Text>
          </View>
          <Text style={styles.sliderDescription}>
            Если ваша скорость превышает рекомендованную менее чем на это значение - предупреждение будет только визуальным
          </Text>

          {/* Рекомендованные скорости */}
          <Text style={styles.subSectionTitle}>Рекомендованная скорость для типов препятствий:</Text>
          {settings.recommendedSpeeds && Object.entries(settings.recommendedSpeeds).map(([key, value]) => (
            <View key={key} style={styles.inputRow}>
              <Text style={styles.inputLabel}>
                {key === 'pothole' && '🕳️ Яма:'}
                {key === 'speed_bump' && '🚧 Лежачий:'}
                {key === 'bump' && '〰️ Неровность:'}
                {key === 'vibration' && '〰️〰️ Вибрация:'}
                {key === 'braking' && '🚗 Торможение:'}
              </Text>
              <TextInput
                style={styles.input}
                value={String(value)}
                onChangeText={(text) => {
                  const updated = { ...settings, recommendedSpeeds: { ...settings.recommendedSpeeds, [key]: parseInt(text) || 40 } };
                  setSettings(updated);
                  setHasChanges(true);
                }}
                keyboardType="number-pad"
              />
              <Text style={styles.inputUnit}>км/ч</Text>
            </View>
          ))}
        </View>

        {/* 🆕 Кастомные тексты озвучки */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💬 Тексты озвучки</Text>
          <Text style={styles.sectionDescription}>
            Настройте фразы для голосовых предупреждений
          </Text>
          
          {settings.customTexts && Object.entries(settings.customTexts).map(([key, value]) => (
            <View key={key} style={styles.textInputRow}>
              <Text style={styles.textInputLabel}>
                {key === 'pothole' && '🕳️ Яма:'}
                {key === 'speed_bump' && '🚧 Лежачий:'}
                {key === 'bump' && '〰️ Неровность:'}
                {key === 'vibration' && '〰️〰️ Вибрация:'}
                {key === 'braking' && '🚗 Торможение:'}
              </Text>
              <TextInput
                style={styles.textInput}
                value={value}
                onChangeText={(text) => {
                  const updated = { ...settings, customTexts: { ...settings.customTexts, [key]: text } };
                  setSettings(updated);
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
  themeButtonSubtext: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
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
  soundUsageBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  usageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 4,
  },
  usageBadgeText: {
    fontSize: 10,
    color: '#22c55e',
    fontWeight: '600',
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
  // Новые стили для тем
  themeButtonsWrap: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  customThemeSection: {
    marginTop: 8,
  },
  customThemeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#1e3a5f',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#00d4ff',
    gap: 10,
  },
  customThemeButtonActive: {
    backgroundColor: '#00d4ff',
    borderColor: '#00d4ff',
  },
  customThemeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#00d4ff',
  },
  customThemeButtonTextActive: {
    color: '#fff',
  },
  customThemePicker: {
    marginTop: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  pickerLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 10,
  },
  soundPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  soundPickerItemActive: {
    borderColor: '#22c55e',
    backgroundColor: '#1a2e1a',
  },
  soundPickerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  soundPickerName: {
    fontSize: 14,
    color: '#ccc',
    flex: 1,
  },
  soundPickerNameActive: {
    color: '#22c55e',
    fontWeight: '600',
  },
  // Стили для индивидуальных звуков препятствий
  obstacleSoundRow: {
    marginBottom: 20,
    padding: 14,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
  },
  obstacleSoundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  obstacleSoundLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  obstacleSoundPicker: {
    gap: 8,
  },
  obstacleSoundOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    padding: 10,
    borderRadius: 8,
    gap: 8,
  },
  obstacleSoundOptionActive: {
    backgroundColor: '#1a2e1a',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  obstacleSoundOptionText: {
    fontSize: 13,
    color: '#888',
    flex: 1,
  },
  obstacleSoundOptionTextActive: {
    color: '#22c55e',
    fontWeight: '500',
  },
  obstacleSoundDefault: {
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
  },
  soundManagerWrapper: {
    marginTop: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // Стили для информационных блоков
  infoBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  infoItem: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  infoContent: {
    flex: 1,
    marginLeft: 12,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 6,
  },
  infoText: {
    fontSize: 13,
    color: '#aaa',
    lineHeight: 20,
    marginBottom: 6,
  },
  infoBold: {
    fontWeight: '600',
    color: '#00d4ff',
  },
  infoLocation: {
    fontSize: 11,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 4,
  },
  usageHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#fbbf24',
    gap: 8,
  },
  usageHintText: {
    flex: 1,
    fontSize: 12,
    color: '#fbbf24',
    lineHeight: 18,
  },
  // Стили для списка стандартных звуков
  standardSoundsBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  standardSoundsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
  },
  standardSoundList: {
    gap: 10,
  },
  standardSoundItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#00d4ff',
  },
  standardSoundName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#00d4ff',
    marginBottom: 4,
  },
  standardSoundUsage: {
    fontSize: 12,
    color: '#aaa',
    lineHeight: 16,
  },
});
