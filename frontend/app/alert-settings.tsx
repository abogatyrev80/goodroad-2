/**
 * Экран настроек системы предупреждений
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import alertSettingsService, { AlertSettings } from '../services/AlertSettingsService';

export default function AlertSettingsScreen() {
  const [settings, setSettings] = useState<AlertSettings>(alertSettingsService.getSettings());
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const current = alertSettingsService.getSettings();
    setSettings(current);
  };

  const updateSetting = (key: keyof AlertSettings, value: any) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    setHasChanges(true);
  };

  const updateNestedSetting = (parent: keyof AlertSettings, key: string, value: any) => {
    const updated = {
      ...settings,
      [parent]: {
        ...(settings[parent] as any),
        [key]: value,
      },
    };
    setSettings(updated);
    setHasChanges(true);
  };

  const saveSettings = async () => {
    await alertSettingsService.saveSettings(settings);
    setHasChanges(false);
    alert('✅ Настройки сохранены!');
  };

  const resetToDefaults = () => {
    if (confirm('Сбросить все настройки на значения по умолчанию?')) {
      alertSettingsService.saveSettings({
        speedThresholdExcess: 20,
        alertMode: 'full',
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
        alertDistances: {
          earlyWarning: 200,
          mainWarning: 100,
          urgentWarning: 50,
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
        <Text style={styles.headerTitle}>⚙️ Настройки предупреждений</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Порог превышения скорости */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🚗 Порог превышения скорости</Text>
          <Text style={styles.sectionDescription}>
            На сколько км/ч можно превышать рекомендованную скорость без звуковых предупреждений
          </Text>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Порог превышения:</Text>
            <TextInput
              style={styles.input}
              value={String(settings.speedThresholdExcess)}
              onChangeText={(text) => updateSetting('speedThresholdExcess', parseInt(text) || 20)}
              keyboardType="number-pad"
            />
            <Text style={styles.inputUnit}>км/ч</Text>
          </View>
        </View>

        {/* Рекомендованные скорости */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎯 Рекомендованные скорости</Text>
          <Text style={styles.sectionDescription}>
            Безопасная скорость для каждого типа препятствия
          </Text>
          
          {Object.entries(settings.recommendedSpeeds).map(([key, value]) => (
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
                onChangeText={(text) => updateNestedSetting('recommendedSpeeds', key, parseInt(text) || 40)}
                keyboardType="number-pad"
              />
              <Text style={styles.inputUnit}>км/ч</Text>
            </View>
          ))}
        </View>

        {/* Кастомные тексты */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💬 Тексты предупреждений</Text>
          <Text style={styles.sectionDescription}>
            Измените фразы, которые будут произноситься
          </Text>
          
          {Object.entries(settings.customTexts).map(([key, value]) => (
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
                onChangeText={(text) => updateNestedSetting('customTexts', key, text)}
                placeholder="Текст предупреждения"
                placeholderTextColor="#666"
              />
            </View>
          ))}
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
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  switchLabel: {
    fontSize: 16,
    color: '#fff',
    flex: 1,
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
  linkButton: {
    backgroundColor: '#3b82f6',
    marginTop: 12,
  },
});
