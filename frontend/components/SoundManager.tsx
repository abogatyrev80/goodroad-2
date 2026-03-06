/**
 * SoundManager.tsx
 * Управление звуками для разных типов событий
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';

// Типы событий
export type EventType = 'pothole' | 'braking' | 'vibration' | 'bump' | 'general';

// Интерфейс звуковой настройки
export interface SoundConfig {
  eventType: EventType;
  soundId: string;
  soundName: string;
  isCustom: boolean;
  uri?: string;
}

// Стандартные звуки для каждого типа события
const DEFAULT_SOUNDS: Record<EventType, { id: string; name: string; description: string }> = {
  pothole: {
    id: 'pothole_warning',
    name: 'Яма - Резкое предупреждение',
    description: 'Высокий приоритет, резкий звук',
  },
  braking: {
    id: 'braking_alert',
    name: 'Торможение - Мягкое предупреждение',
    description: 'Средний приоритет, плавный звук',
  },
  vibration: {
    id: 'vibration_beep',
    name: 'Вибрация - Короткий сигнал',
    description: 'Низкий приоритет, короткий звук',
  },
  bump: {
    id: 'bump_notification',
    name: 'Кочка - Средний сигнал',
    description: 'Средний приоритет, умеренный звук',
  },
  general: {
    id: 'general_beep',
    name: 'Общее - Стандартный сигнал',
    description: 'Универсальный звук',
  },
};

// Альтернативные стандартные звуки
const ALTERNATIVE_SOUNDS = [
  { id: 'beep_short', name: 'Короткий сигнал' },
  { id: 'beep_long', name: 'Длинный сигнал' },
  { id: 'ding', name: 'Дин-дон' },
  { id: 'alert_soft', name: 'Мягкое предупреждение' },
  { id: 'alert_loud', name: 'Громкое предупреждение' },
];

const STORAGE_KEY = 'good_road_sound_config';

interface Props {
  onSave?: () => void;
  hideTitle?: boolean;
}

export default function SoundManager({ onSave, hideTitle = false }: Props) {
  const [soundConfigs, setSoundConfigs] = useState<SoundConfig[]>([]);
  const [expandedEvent, setExpandedEvent] = useState<EventType | null>(null);
  const playingSoundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    loadSoundConfigs();
    
    // Инициализация аудио режима
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    }).catch((error) => {
      console.error('Error setting audio mode:', error);
    });
    
    return () => {
      // Очистка при размонтировании
      if (playingSoundRef.current) {
        playingSoundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  // Загрузить конфигурацию из AsyncStorage
  const loadSoundConfigs = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSoundConfigs(JSON.parse(stored));
      } else {
        // Инициализация стандартными звуками
        const defaultConfigs: SoundConfig[] = Object.entries(DEFAULT_SOUNDS).map(
          ([eventType, sound]) => ({
            eventType: eventType as EventType,
            soundId: sound.id,
            soundName: sound.name,
            isCustom: false,
          })
        );
        setSoundConfigs(defaultConfigs);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(defaultConfigs));
      }
    } catch (error) {
      console.error('Ошибка загрузки звуковых настроек:', error);
    }
  };

  // Сохранить конфигурацию
  const saveSoundConfigs = async (configs: SoundConfig[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
      setSoundConfigs(configs);
      onSave?.();
    } catch (error) {
      console.error('Ошибка сохранения звуковых настроек:', error);
    }
  };

  // Выбрать стандартный звук
  const selectStandardSound = (eventType: EventType, soundId: string, soundName: string) => {
    const updatedConfigs = soundConfigs.map((config) =>
      config.eventType === eventType
        ? { eventType, soundId, soundName, isCustom: false }
        : config
    );
    saveSoundConfigs(updatedConfigs);
    Alert.alert('Успешно!', `Звук для "${getEventName(eventType)}" обновлён`);
  };

  // Загрузить свой звук
  const uploadCustomSound = async (eventType: EventType) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const customConfig: SoundConfig = {
          eventType,
          soundId: `custom_${Date.now()}`,
          soundName: asset.name,
          isCustom: true,
          uri: asset.uri,
        };

        const updatedConfigs = soundConfigs.map((config) =>
          config.eventType === eventType ? customConfig : config
        );

        await saveSoundConfigs(updatedConfigs);
        Alert.alert('Успешно!', `Пользовательский звук "${asset.name}" загружен`);
      }
    } catch (error) {
      console.error('Ошибка загрузки звука:', error);
      Alert.alert('Ошибка', 'Не удалось загрузить звук');
    }
  };

  // Сбросить к стандартному звуку
  const resetToDefault = (eventType: EventType) => {
    const defaultSound = DEFAULT_SOUNDS[eventType];
    selectStandardSound(eventType, defaultSound.id, defaultSound.name);
    Alert.alert('Сброшено', 'Восстановлен стандартный звук');
  };

  // Маппинг звуков: разные файлы и скорость воспроизведения, чтобы звуки отличались
  const getSoundSource = (soundId: string): { source: any; rate: number } => {
    const soundMap: Record<string, { source: any; rate: number }> = {
      'pothole_warning': { source: require('../assets/sounds/emergency.mp3'), rate: 1.0 },
      'braking_alert': { source: require('../assets/sounds/warning.mp3'), rate: 0.9 },
      'vibration_beep': { source: require('../assets/sounds/info.mp3'), rate: 1.4 },
      'bump_notification': { source: require('../assets/sounds/critical.mp3'), rate: 1.0 },
      'general_beep': { source: require('../assets/sounds/info.mp3'), rate: 1.0 },
      'beep_short': { source: require('../assets/sounds/info.mp3'), rate: 1.35 },
      'beep_long': { source: require('../assets/sounds/warning.mp3'), rate: 0.7 },
      'ding': { source: require('../assets/sounds/info.mp3'), rate: 1.15 },
      'alert_soft': { source: require('../assets/sounds/info.mp3'), rate: 1.05 },
      'alert_loud': { source: require('../assets/sounds/warning.mp3'), rate: 1.2 },
    };
    return soundMap[soundId] || { source: require('../assets/sounds/info.mp3'), rate: 1.0 };
  };

  // Воспроизвести звук
  const playTestSound = async (config: SoundConfig) => {
    if (Platform.OS === 'web') {
      Alert.alert('⚠️', 'Воспроизведение звуков на веб-платформе может не работать. Используйте мобильное приложение.');
      return;
    }
    
    try {
      // Останавливаем предыдущий звук
      if (playingSoundRef.current) {
        await playingSoundRef.current.stopAsync();
        await playingSoundRef.current.unloadAsync();
        playingSoundRef.current = null;
      }

      // Инициализируем аудио режим
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      let soundSource: any;
      
      let rate = 1.0;
      if (config.isCustom && config.uri) {
        soundSource = { uri: config.uri };
      } else {
        try {
          const resolved = getSoundSource(config.soundId);
          soundSource = resolved.source;
          rate = resolved.rate;
        } catch (error) {
          console.error('❌ Error getting sound source:', error);
          Alert.alert('❌ Ошибка', `Не удалось загрузить звук: ${config.soundId}`);
          return;
        }
      }

      const { sound } = await Audio.Sound.createAsync(
        soundSource,
        { volume: 1.0, shouldPlay: false }
      );
      
      playingSoundRef.current = sound;
      
      await sound.setVolumeAsync(1.0);
      try {
        await sound.setRateAsync(rate, false); // false = меняем высоту тона, чтобы звуки отличались
      } catch (_) {}
      
      await sound.playAsync();

      // Автоматически выгружаем после завершения
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          playingSoundRef.current = null;
        }
      });
    } catch (error: any) {
      console.error('❌ Error playing test sound:', error);
      Alert.alert('❌ Ошибка', `Не удалось воспроизвести звук: ${error?.message || 'Неизвестная ошибка'}`);
    }
  };

  // Получить название события на русском
  const getEventName = (eventType: EventType): string => {
    const names: Record<EventType, string> = {
      pothole: 'Яма',
      braking: 'Торможение',
      vibration: 'Вибрация',
      bump: 'Кочка',
      general: 'Общее предупреждение',
    };
    return names[eventType];
  };

  // Получить иконку для типа события
  const getEventIcon = (eventType: EventType): keyof typeof Ionicons.glyphMap => {
    const icons: Record<EventType, keyof typeof Ionicons.glyphMap> = {
      pothole: 'warning',
      braking: 'hand-left',
      vibration: 'pulse',
      bump: 'trending-up',
      general: 'notifications',
    };
    return icons[eventType];
  };

  // Получить цвет для типа события
  const getEventColor = (eventType: EventType): string => {
    const colors: Record<EventType, string> = {
      pothole: '#F44336',
      braking: '#FF9800',
      vibration: '#FFC107',
      bump: '#FF5722',
      general: '#2196F3',
    };
    return colors[eventType];
  };

  return (
    <View style={[styles.container, hideTitle && styles.containerCompact]}>
      {!hideTitle && (
        <>
          <Text style={styles.title}>🔊 Звуковые оповещения</Text>
          <Text style={styles.subtitle}>
            Настройте звуки для каждого типа события. Можете использовать стандартные или загрузить свои.
          </Text>
        </>
      )}

      <ScrollView style={styles.eventList} nestedScrollEnabled>
        {soundConfigs.map((config) => {
          const isExpanded = expandedEvent === config.eventType;
          const eventColor = getEventColor(config.eventType);
          const defaultSound = DEFAULT_SOUNDS[config.eventType];

          return (
            <View key={config.eventType} style={styles.eventCard}>
              {/* Header */}
              <Pressable
                style={[styles.eventHeader, { borderLeftColor: eventColor }]}
                onPress={() => setExpandedEvent(isExpanded ? null : config.eventType)}
              >
                <View style={styles.eventHeaderLeft}>
                  <Ionicons
                    name={getEventIcon(config.eventType)}
                    size={24}
                    color={eventColor}
                  />
                  <View style={styles.eventHeaderText}>
                    <Text style={styles.eventName}>{getEventName(config.eventType)}</Text>
                    <Text style={styles.currentSound}>
                      {config.isCustom ? '🎵 ' : '🔔 '}
                      {config.soundName}
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color="#888"
                />
              </Pressable>

              {/* Expanded Content */}
              {isExpanded && (
                <View style={styles.eventContent}>
                  {/* Current Sound Info */}
                  <View style={styles.currentSoundInfo}>
                    <Text style={styles.sectionTitle}>Текущий звук:</Text>
                    <View style={styles.soundItem}>
                      <Ionicons
                        name={config.isCustom ? 'musical-notes' : 'volume-high'}
                        size={20}
                        color={eventColor}
                      />
                      <Text style={styles.soundItemText}>{config.soundName}</Text>
                      {config.isCustom && (
                        <View style={styles.customBadge}>
                          <Text style={styles.customBadgeText}>Свой</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.actionButtons}>
                    {/* Test Sound */}
                    <Pressable
                      style={[styles.actionButton, { backgroundColor: eventColor }]}
                      onPress={() => playTestSound(config)}
                    >
                      <Ionicons name="play" size={16} color="white" />
                      <Text style={styles.actionButtonText}>Тест</Text>
                    </Pressable>

                    {/* Upload Custom */}
                    <Pressable
                      style={[styles.actionButton, { backgroundColor: '#2196F3' }]}
                      onPress={() => uploadCustomSound(config.eventType)}
                    >
                      <Ionicons name="cloud-upload" size={16} color="white" />
                      <Text style={styles.actionButtonText}>Загрузить свой</Text>
                    </Pressable>

                    {/* Reset to Default */}
                    {config.isCustom && (
                      <Pressable
                        style={[styles.actionButton, { backgroundColor: '#757575' }]}
                        onPress={() => resetToDefault(config.eventType)}
                      >
                        <Ionicons name="refresh" size={16} color="white" />
                        <Text style={styles.actionButtonText}>Сбросить</Text>
                      </Pressable>
                    )}
                  </View>

                  {/* Standard Sounds */}
                  <View style={styles.standardSounds}>
                    <Text style={styles.sectionTitle}>Стандартные звуки:</Text>

                    {/* Default Sound */}
                    <Pressable
                      style={[
                        styles.standardSoundItem,
                        !config.isCustom &&
                          config.soundId === defaultSound.id &&
                          styles.selectedSound,
                      ]}
                      onPress={() =>
                        selectStandardSound(
                          config.eventType,
                          defaultSound.id,
                          defaultSound.name
                        )
                      }
                    >
                      <Ionicons
                        name="star"
                        size={16}
                        color={
                          !config.isCustom && config.soundId === defaultSound.id
                            ? eventColor
                            : '#888'
                        }
                      />
                      <View style={styles.standardSoundText}>
                        <Text style={styles.standardSoundName}>{defaultSound.name}</Text>
                        <Text style={styles.standardSoundDesc}>{defaultSound.description}</Text>
                      </View>
                      {!config.isCustom && config.soundId === defaultSound.id && (
                        <Ionicons name="checkmark-circle" size={20} color={eventColor} />
                      )}
                    </Pressable>

                    {/* Alternative Sounds */}
                    {ALTERNATIVE_SOUNDS.map((altSound) => (
                      <Pressable
                        key={altSound.id}
                        style={[
                          styles.standardSoundItem,
                          !config.isCustom &&
                            config.soundId === altSound.id &&
                            styles.selectedSound,
                        ]}
                        onPress={() =>
                          selectStandardSound(config.eventType, altSound.id, altSound.name)
                        }
                      >
                        <Ionicons
                          name="volume-medium"
                          size={16}
                          color={
                            !config.isCustom && config.soundId === altSound.id
                              ? eventColor
                              : '#888'
                          }
                        />
                        <Text style={styles.standardSoundName}>{altSound.name}</Text>
                        {!config.isCustom && config.soundId === altSound.id && (
                          <Ionicons name="checkmark-circle" size={20} color={eventColor} />
                        )}
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    padding: 16,
  },
  containerCompact: {
    flex: 0,
    padding: 0,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 16,
    lineHeight: 20,
  },
  eventList: {
    flex: 1,
  },
  eventCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderLeftWidth: 4,
  },
  eventHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  eventHeaderText: {
    marginLeft: 12,
    flex: 1,
  },
  eventName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  currentSound: {
    fontSize: 13,
    color: '#888',
  },
  eventContent: {
    padding: 16,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  currentSoundInfo: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  soundItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#333',
    borderRadius: 8,
  },
  soundItemText: {
    fontSize: 14,
    color: '#ffffff',
    marginLeft: 8,
    flex: 1,
  },
  customBadge: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  customBadgeText: {
    fontSize: 11,
    color: '#ffffff',
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
    gap: 6,
  },
  actionButtonText: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '600',
  },
  standardSounds: {
    marginTop: 8,
  },
  standardSoundItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#333',
    borderRadius: 8,
    marginBottom: 8,
    gap: 10,
  },
  selectedSound: {
    backgroundColor: '#3a3a3a',
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  standardSoundText: {
    flex: 1,
  },
  standardSoundName: {
    fontSize: 14,
    color: '#ffffff',
    marginBottom: 2,
  },
  standardSoundDesc: {
    fontSize: 12,
    color: '#888',
  },
});
