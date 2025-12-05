/**
 * AutostartSettings - Настройки автозапуска мониторинга
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

type AutostartMode = 'disabled' | 'onCharge' | 'onOpen';

export default function AutostartSettingsScreen() {
  const [autostartMode, setAutostartMode] = useState<AutostartMode>('disabled');
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
      Alert.alert('Сохранено', `Автозапуск: ${getModeText(mode)}`);
    } catch (error) {
      console.error('Error saving autostart settings:', error);
      Alert.alert('Ошибка', 'Не удалось сохранить настройки');
    }
  };

  const getModeText = (mode: AutostartMode): string => {
    switch (mode) {
      case 'disabled':
        return 'Выключен';
      case 'onCharge':
        return 'При подключении зарядки';
      case 'onOpen':
        return 'При запуске приложения';
    }
  };

  const getModeDescription = (mode: AutostartMode): string => {
    switch (mode) {
      case 'disabled':
        return 'Мониторинг запускается только вручную';
      case 'onCharge':
        return 'Мониторинг автоматически запускается когда устройство подключено к зарядке (например, в автомобиле)';
      case 'onOpen':
        return 'Мониторинг автоматически запускается при каждом открытии приложения';
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingContainer}>
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
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Автозапуск</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content}>
        {/* Описание */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color="#60a5fa" />
          <Text style={styles.infoText}>
            Настройте когда мониторинг дороги должен запускаться автоматически.
            Вы всегда можете запустить или остановить мониторинг вручную.
          </Text>
        </View>

        {/* Режимы */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Выберите режим автозапуска</Text>

          {/* Выключен */}
          <Pressable
            style={[
              styles.modeOption,
              autostartMode === 'disabled' && styles.modeOptionActive,
            ]}
            onPress={() => saveSettings('disabled')}
          >
            <View style={styles.modeHeader}>
              <Ionicons
                name="close-circle"
                size={32}
                color={autostartMode === 'disabled' ? '#3b82f6' : '#64748b'}
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
                <Text style={styles.modeDescription}>
                  {getModeDescription('disabled')}
                </Text>
              </View>
              {autostartMode === 'disabled' && (
                <Ionicons name="checkmark-circle" size={24} color="#3b82f6" />
              )}
            </View>
          </Pressable>

          {/* При зарядке */}
          <Pressable
            style={[
              styles.modeOption,
              autostartMode === 'onCharge' && styles.modeOptionActive,
            ]}
            onPress={() => saveSettings('onCharge')}
          >
            <View style={styles.modeHeader}>
              <Ionicons
                name="flash"
                size={32}
                color={autostartMode === 'onCharge' ? '#3b82f6' : '#64748b'}
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
                <Text style={styles.modeDescription}>
                  {getModeDescription('onCharge')}
                </Text>
              </View>
              {autostartMode === 'onCharge' && (
                <Ionicons name="checkmark-circle" size={24} color="#3b82f6" />
              )}
            </View>

            <View style={styles.recommendedBadge}>
              <Ionicons name="star" size={14} color="#fbbf24" />
              <Text style={styles.recommendedText}>Рекомендуется</Text>
            </View>
          </Pressable>

          {/* При запуске */}
          <Pressable
            style={[
              styles.modeOption,
              autostartMode === 'onOpen' && styles.modeOptionActive,
            ]}
            onPress={() => saveSettings('onOpen')}
          >
            <View style={styles.modeHeader}>
              <Ionicons
                name="play-circle"
                size={32}
                color={autostartMode === 'onOpen' ? '#3b82f6' : '#64748b'}
              />
              <View style={styles.modeInfo}>
                <Text
                  style={[
                    styles.modeTitle,
                    autostartMode === 'onOpen' && styles.modeTitleActive,
                  ]}
                >
                  При запуске
                </Text>
                <Text style={styles.modeDescription}>
                  {getModeDescription('onOpen')}
                </Text>
              </View>
              {autostartMode === 'onOpen' && (
                <Ionicons name="checkmark-circle" size={24} color="#3b82f6" />
              )}
            </View>
          </Pressable>
        </View>

        {/* Дополнительная информация */}
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>💡 Советы</Text>
          
          <View style={styles.tipItem}>
            <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
            <Text style={styles.tipText}>
              Режим "При зарядке" идеален для использования в автомобиле
            </Text>
          </View>

          <View style={styles.tipItem}>
            <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
            <Text style={styles.tipText}>
              Мониторинг автоматически остановится при выключении зарядки (в режиме "При зарядке")
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#94a3b8',
  },
  content: {
    flex: 1,
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
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#e2e8f0',
    marginBottom: 16,
  },
  modeOption: {
    padding: 16,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#334155',
  },
  modeOptionActive: {
    borderColor: '#3b82f6',
    backgroundColor: '#1e40af',
  },
  modeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  modeInfo: {
    flex: 1,
  },
  modeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#e2e8f0',
    marginBottom: 4,
  },
  modeTitleActive: {
    color: '#fff',
  },
  modeDescription: {
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
  },
  recommendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  recommendedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fbbf24',
  },
  tipsSection: {
    margin: 16,
    padding: 16,
    backgroundColor: '#1e293b',
    borderRadius: 12,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#e2e8f0',
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
    color: '#94a3b8',
    lineHeight: 20,
  },
  bottomSpacer: {
    height: 32,
  },
});
