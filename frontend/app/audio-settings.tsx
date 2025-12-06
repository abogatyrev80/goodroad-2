/**
 * AudioSettings - Настройки аудио-оповещений
 * 
 * Позволяет настроить голосовые и звуковые предупреждения
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  Pressable,
  Alert,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Slider from '@react-native-community/slider';
import audioAlertService, { AudioSettings } from '../services/AudioAlertService';

export default function AudioSettingsScreen() {
  const [settings, setSettings] = useState<AudioSettings>(audioAlertService.getSettings());
  const [stats, setStats] = useState(audioAlertService.getEffectivenessStats());

  useEffect(() => {
    // Загружаем текущие настройки
    const currentSettings = audioAlertService.getSettings();
    setSettings(currentSettings);
    setStats(audioAlertService.getEffectivenessStats());
  }, []);

  const handleSettingChange = async (key: keyof AudioSettings, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await audioAlertService.saveSettings({ [key]: value });
  };

  const handleTestAlert = async () => {
    await audioAlertService.testAlert();
    Alert.alert('Тест', 'Тестовое оповещение воспроизведено');
  };

  const playExamplePhrase = async (urgency: string) => {
    const examples = {
      emergency: { ru: 'ОПАСНОСТЬ! Яма через 100 метров!', en: 'DANGER! Pothole in 100 meters!' },
      critical: { ru: 'Внимание! Яма через 200 метров', en: 'Warning! Pothole in 200 meters' },
      warning: { ru: 'Впереди яма, 400 метров', en: 'Pothole ahead, 400 meters' },
      info: { ru: 'Яма на расстоянии 800 метров', en: 'Pothole at 800 meters' },
    };

    const message = examples[urgency as keyof typeof examples][settings.language];
    await audioAlertService.speakDirect(message);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Аудио-оповещения</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content}>
        {/* Основные настройки */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔊 Основные настройки</Text>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Голосовые подсказки</Text>
              <Text style={styles.settingDescription}>
                Произносит тип и расстояние до препятствия
              </Text>
            </View>
            <Switch
              value={settings.voiceEnabled}
              onValueChange={(value) => handleSettingChange('voiceEnabled', value)}
              trackColor={{ false: '#475569', true: '#3b82f6' }}
              thumbColor="#fff"
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Звуковые сигналы</Text>
              <Text style={styles.settingDescription}>
                Воспроизводит звук перед голосом
              </Text>
            </View>
            <Switch
              value={settings.soundEnabled}
              onValueChange={(value) => handleSettingChange('soundEnabled', value)}
              trackColor={{ false: '#475569', true: '#3b82f6' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Громкость */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔉 Громкость</Text>
          <View style={styles.sliderContainer}>
            <Ionicons name="volume-low" size={20} color="#94a3b8" />
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={1}
              value={settings.volume}
              onValueChange={(value) => handleSettingChange('volume', value)}
              minimumTrackTintColor="#3b82f6"
              maximumTrackTintColor="#475569"
              thumbTintColor="#3b82f6"
            />
            <Ionicons name="volume-high" size={20} color="#94a3b8" />
          </View>
          <Text style={styles.volumeLabel}>{Math.round(settings.volume * 100)}%</Text>
        </View>

        {/* Минимальные подтверждения */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>✅ Уровень доверия</Text>
          <Text style={styles.sectionDescription}>
            Минимальное количество подтверждений для оповещения
          </Text>

          <View style={styles.confirmationOptions}>
            {[1, 2, 3].map((level) => (
              <Pressable
                key={level}
                style={[
                  styles.confirmationOption,
                  settings.minConfirmations === level && styles.confirmationOptionActive,
                ]}
                onPress={() => handleSettingChange('minConfirmations', level)}
              >
                <Text
                  style={[
                    styles.confirmationOptionText,
                    settings.minConfirmations === level &&
                      styles.confirmationOptionTextActive,
                  ]}
                >
                  {level}+
                </Text>
                <Text style={styles.confirmationOptionLabel}>
                  {level === 1 && 'Все'}
                  {level === 2 && 'Проверенные'}
                  {level === 3 && 'Надежные'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Язык */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🌍 Язык оповещений</Text>
          <View style={styles.languageOptions}>
            <Pressable
              style={[
                styles.languageOption,
                settings.language === 'ru' && styles.languageOptionActive,
              ]}
              onPress={() => handleSettingChange('language', 'ru')}
            >
              <Text
                style={[
                  styles.languageOptionText,
                  settings.language === 'ru' && styles.languageOptionTextActive,
                ]}
              >
                🇷🇺 Русский
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.languageOption,
                settings.language === 'en' && styles.languageOptionActive,
              ]}
              onPress={() => handleSettingChange('language', 'en')}
            >
              <Text
                style={[
                  styles.languageOptionText,
                  settings.language === 'en' && styles.languageOptionTextActive,
                ]}
              >
                🇬🇧 English
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Звуковая тема */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎵 Звуковая тема</Text>
          
          <Pressable
            style={[
              styles.themeCard,
              settings.soundTheme === 'motion-tracker' && styles.themeCardActive,
            ]}
            onPress={() => handleSettingChange('soundTheme', 'motion-tracker')}
          >
            <View style={styles.themeHeader}>
              <Ionicons name="radio" size={24} color={settings.soundTheme === 'motion-tracker' ? '#00d4ff' : '#8b94a8'} />
              <View style={styles.themeInfo}>
                <Text style={[styles.themeTitle, settings.soundTheme === 'motion-tracker' && styles.themeTitleActive]}>
                  Motion Tracker
                </Text>
                <Text style={styles.themeDescription}>
                  Звук датчика движения из фильма "Чужие" 👽
                </Text>
              </View>
              {settings.soundTheme === 'motion-tracker' && (
                <Ionicons name="checkmark-circle" size={24} color="#00ff88" />
              )}
            </View>
          </Pressable>

          <Pressable
            style={[
              styles.themeCard,
              settings.soundTheme === 'voice-only' && styles.themeCardActive,
            ]}
            onPress={() => handleSettingChange('soundTheme', 'voice-only')}
          >
            <View style={styles.themeHeader}>
              <Ionicons name="mic" size={24} color={settings.soundTheme === 'voice-only' ? '#00d4ff' : '#8b94a8'} />
              <View style={styles.themeInfo}>
                <Text style={[styles.themeTitle, settings.soundTheme === 'voice-only' && styles.themeTitleActive]}>
                  Только голос
                </Text>
                <Text style={styles.themeDescription}>
                  Без звуковых сигналов, только голосовые подсказки 🗣️
                </Text>
              </View>
              {settings.soundTheme === 'voice-only' && (
                <Ionicons name="checkmark-circle" size={24} color="#00ff88" />
              )}
            </View>
          </Pressable>
        </View>

        {/* Примеры голосовых фраз */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🗣️ Примеры голосовых фраз</Text>
          
          <Text style={styles.examplesHint}>
            Система произносит разные фразы в зависимости от расстояния и опасности препятствия. Нажмите для прослушивания:
          </Text>

          {/* Info - далеко */}
          <Pressable style={styles.exampleCard} onPress={() => playExamplePhrase('info')}>
            <View style={[styles.exampleBadge, { backgroundColor: '#3b82f6' }]}>
              <Text style={styles.exampleBadgeText}>800м+</Text>
            </View>
            <View style={styles.exampleContent}>
              <Text style={styles.exampleTitle}>Информационное</Text>
              <Text style={styles.exampleText}>
                {settings.language === 'ru' ? '"Яма на расстоянии 800 метров"' : '"Pothole at 800 meters"'}
              </Text>
            </View>
            <Ionicons name="play-circle-outline" size={28} color="#00d4ff" />
          </Pressable>

          {/* Warning - средняя дистанция */}
          <Pressable style={styles.exampleCard} onPress={() => playExamplePhrase('warning')}>
            <View style={[styles.exampleBadge, { backgroundColor: '#f59e0b' }]}>
              <Text style={styles.exampleBadgeText}>400м</Text>
            </View>
            <View style={styles.exampleContent}>
              <Text style={styles.exampleTitle}>Предупреждение</Text>
              <Text style={styles.exampleText}>
                {settings.language === 'ru' ? '"Впереди яма, 400 метров"' : '"Pothole ahead, 400 meters"'}
              </Text>
            </View>
            <Ionicons name="play-circle-outline" size={28} color="#00d4ff" />
          </Pressable>

          {/* Critical - близко */}
          <Pressable style={styles.exampleCard} onPress={() => playExamplePhrase('critical')}>
            <View style={[styles.exampleBadge, { backgroundColor: '#ef4444' }]}>
              <Text style={styles.exampleBadgeText}>200м</Text>
            </View>
            <View style={styles.exampleContent}>
              <Text style={styles.exampleTitle}>Критическое</Text>
              <Text style={styles.exampleText}>
                {settings.language === 'ru' ? '"Внимание! Яма через 200 метров"' : '"Warning! Pothole in 200 meters"'}
              </Text>
            </View>
            <Ionicons name="play-circle-outline" size={28} color="#00d4ff" />
          </Pressable>

          {/* Emergency - очень близко */}
          <Pressable style={styles.exampleCard} onPress={() => playExamplePhrase('emergency')}>
            <View style={[styles.exampleBadge, { backgroundColor: '#dc2626' }]}>
              <Text style={styles.exampleBadgeText}>100м!</Text>
            </View>
            <View style={styles.exampleContent}>
              <Text style={styles.exampleTitle}>Экстренное</Text>
              <Text style={styles.exampleText}>
                {settings.language === 'ru' ? '"ОПАСНОСТЬ! Яма через 100 метров!"' : '"DANGER! Pothole in 100 meters!"'}
              </Text>
              <Text style={styles.exampleNote}>Громче и быстрее</Text>
            </View>
            <Ionicons name="play-circle-outline" size={28} color="#00d4ff" />
          </Pressable>
        </View>

        {/* Статистика эффективности */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📊 Статистика</Text>
          
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.totalAlerts}</Text>
              <Text style={styles.statLabel}>Всего оповещений</Text>
            </View>

            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {Math.round(stats.reactionRate * 100)}%
              </Text>
              <Text style={styles.statLabel}>Реакция водителя</Text>
            </View>

            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {Math.round(stats.averageReactionDistance)}м
              </Text>
              <Text style={styles.statLabel}>Среднее расстояние</Text>
            </View>
          </View>

          <Text style={styles.statsDescription}>
            Система адаптируется под ваш стиль вождения на основе этих данных
          </Text>
        </View>

        {/* Кнопка теста */}
        <Pressable style={styles.testButton} onPress={handleTestAlert}>
          <Ionicons name="play-circle" size={24} color="#fff" />
          <Text style={styles.testButtonText}>Тестовое оповещение</Text>
        </Pressable>

        {/* Информация */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color="#60a5fa" />
          <Text style={styles.infoText}>
            Система автоматически регулирует дистанцию и частоту оповещений на основе
            вашей реакции. Чем чаще вы реагируете на предупреждения, тем точнее они
            становятся.
          </Text>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#e2e8f0',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    color: '#e2e8f0',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    color: '#64748b',
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  volumeLabel: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 8,
  },
  confirmationOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmationOption: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#334155',
  },
  confirmationOptionActive: {
    backgroundColor: '#1e40af',
    borderColor: '#3b82f6',
  },
  confirmationOptionText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#94a3b8',
    marginBottom: 4,
  },
  confirmationOptionTextActive: {
    color: '#fff',
  },
  confirmationOptionLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  languageOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  languageOption: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#334155',
    alignItems: 'center',
  },
  languageOptionActive: {
    backgroundColor: '#1e40af',
    borderColor: '#3b82f6',
  },
  languageOptionText: {
    fontSize: 16,
    color: '#94a3b8',
  },
  languageOptionTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#1e293b',
    borderRadius: 12,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#3b82f6',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
  },
  statsDescription: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 12,
    fontStyle: 'italic',
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    margin: 16,
    padding: 16,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
  },
  testButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  infoBox: {
    flexDirection: 'row',
    margin: 16,
    padding: 16,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 20,
  },
  examplesHint: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 16,
    lineHeight: 20,
  },
  exampleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    marginBottom: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  exampleBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  exampleBadgeText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
  },
  exampleContent: {
    flex: 1,
  },
  exampleTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#e2e8f0',
    marginBottom: 4,
  },
  exampleText: {
    fontSize: 14,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  exampleNote: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  bottomSpacer: {
    height: 32,
  },
});
