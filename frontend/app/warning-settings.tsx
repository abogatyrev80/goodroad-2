/**
 * WarningSettings - Настройки плавающего предупреждения
 * Размер и позиция предупреждения
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type WarningSize = 'small' | 'medium' | 'large';
export type WarningPosition = 'top' | 'center' | 'bottom';

export interface WarningSettings {
  size: WarningSize;
  position: WarningPosition;
}

export default function WarningSettingsScreen() {
  const [size, setSize] = useState<WarningSize>('medium');
  const [position, setPosition] = useState<WarningPosition>('top');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem('warning_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        const validSizes: WarningSize[] = ['small', 'medium', 'large'];
        const validPositions: WarningPosition[] = ['top', 'center', 'bottom'];
        setSize(validSizes.includes(parsed.size) ? parsed.size : 'medium');
        setPosition(validPositions.includes(parsed.position) ? parsed.position : 'top');
      }
    } catch (error) {
      console.error('Error loading warning settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      const settings: WarningSettings = { size, position };
      await AsyncStorage.setItem('warning_settings', JSON.stringify(settings));
      Alert.alert('Сохранено', 'Настройки предупреждений обновлены');
    } catch (error) {
      console.error('Error saving warning settings:', error);
      Alert.alert('Ошибка', 'Не удалось сохранить настройки');
    }
  };

  const getSizeDescription = (s: WarningSize): string => {
    switch (s) {
      case 'small':
        return 'Компактное предупреждение, не мешает обзору';
      case 'medium':
        return 'Оптимальный размер для большинства случаев';
      case 'large':
        return 'Максимально заметное предупреждение';
    }
  };

  const getPositionDescription = (p: WarningPosition): string => {
    switch (p) {
      case 'top':
        return 'В верхней части экрана, не закрывает дорогу';
      case 'center':
        return 'По центру экрана, максимальная видимость';
      case 'bottom':
        return 'В нижней части экрана, над кнопками';
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
          <Ionicons name="arrow-back" size={24} color="#00d4ff" />
        </Pressable>
        <Text style={styles.headerTitle}>Настройки предупреждений</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content}>
        {/* Информация */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color="#00d4ff" />
          <Text style={styles.infoText}>
            Настройте размер и позицию плавающего предупреждения о препятствиях.
            Выберите наиболее удобный вариант для вашего стиля вождения.
          </Text>
        </View>

        {/* Размер */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📏 Размер предупреждения</Text>

          <Pressable
            style={[styles.option, size === 'small' && styles.optionActive]}
            onPress={() => setSize('small')}
          >
            <View style={styles.optionHeader}>
              <Ionicons
                name="contract"
                size={28}
                color={size === 'small' ? '#00d4ff' : '#8b94a8'}
              />
              <View style={styles.optionInfo}>
                <Text style={[styles.optionTitle, size === 'small' && styles.optionTitleActive]}>
                  Маленький
                </Text>
                <Text style={styles.optionDescription}>{getSizeDescription('small')}</Text>
              </View>
              {size === 'small' && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
            </View>
            <View style={[styles.preview, styles.previewSmall]}>
              <View style={styles.previewIcon}>
                <Ionicons name="warning" size={20} color="#fff" />
              </View>
              <View>
                <Text style={styles.previewTitle}>ЯМА</Text>
                <Text style={styles.previewDistance}>250м</Text>
              </View>
            </View>
          </Pressable>

          <Pressable
            style={[styles.option, size === 'medium' && styles.optionActive]}
            onPress={() => setSize('medium')}
          >
            <View style={styles.optionHeader}>
              <Ionicons
                name="resize"
                size={28}
                color={size === 'medium' ? '#00d4ff' : '#8b94a8'}
              />
              <View style={styles.optionInfo}>
                <Text style={[styles.optionTitle, size === 'medium' && styles.optionTitleActive]}>
                  Средний
                </Text>
                <Text style={styles.optionDescription}>{getSizeDescription('medium')}</Text>
              </View>
              {size === 'medium' && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
            </View>
            <View style={styles.recommendedBadge}>
              <Ionicons name="star" size={14} color="#ff9500" />
              <Text style={styles.recommendedText}>Рекомендуется</Text>
            </View>
            <View style={[styles.preview, styles.previewMedium]}>
              <View style={styles.previewIcon}>
                <Ionicons name="warning" size={28} color="#fff" />
              </View>
              <View>
                <Text style={[styles.previewTitle, { fontSize: 16 }]}>ЯМА</Text>
                <Text style={[styles.previewDistance, { fontSize: 32 }]}>250м</Text>
              </View>
            </View>
          </Pressable>

          <Pressable
            style={[styles.option, size === 'large' && styles.optionActive]}
            onPress={() => setSize('large')}
          >
            <View style={styles.optionHeader}>
              <Ionicons
                name="expand"
                size={28}
                color={size === 'large' ? '#00d4ff' : '#8b94a8'}
              />
              <View style={styles.optionInfo}>
                <Text style={[styles.optionTitle, size === 'large' && styles.optionTitleActive]}>
                  Большой
                </Text>
                <Text style={styles.optionDescription}>{getSizeDescription('large')}</Text>
              </View>
              {size === 'large' && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
            </View>
            <View style={[styles.preview, styles.previewLarge]}>
              <View style={[styles.previewIcon, { width: 60, height: 60 }]}>
                <Ionicons name="warning" size={36} color="#fff" />
              </View>
              <View>
                <Text style={[styles.previewTitle, { fontSize: 20 }]}>ЯМА</Text>
                <Text style={[styles.previewDistance, { fontSize: 42 }]}>250м</Text>
              </View>
            </View>
          </Pressable>
        </View>

        {/* Позиция */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📍 Позиция на экране</Text>

          <Pressable
            style={[styles.option, position === 'top' && styles.optionActive]}
            onPress={() => setPosition('top')}
          >
            <View style={styles.optionHeader}>
              <Ionicons
                name="arrow-up-circle"
                size={28}
                color={position === 'top' ? '#00d4ff' : '#8b94a8'}
              />
              <View style={styles.optionInfo}>
                <Text style={[styles.optionTitle, position === 'top' && styles.optionTitleActive]}>
                  Сверху
                </Text>
                <Text style={styles.optionDescription}>{getPositionDescription('top')}</Text>
              </View>
              {position === 'top' && <Ionicons name="checkmark-circle" size={24} color="#00ff88" />}
            </View>
            <View style={styles.recommendedBadge}>
              <Ionicons name="star" size={14} color="#ff9500" />
              <Text style={styles.recommendedText}>Рекомендуется</Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.option, position === 'center' && styles.optionActive]}
            onPress={() => setPosition('center')}
          >
            <View style={styles.optionHeader}>
              <Ionicons
                name="radio-button-on"
                size={28}
                color={position === 'center' ? '#00d4ff' : '#8b94a8'}
              />
              <View style={styles.optionInfo}>
                <Text
                  style={[styles.optionTitle, position === 'center' && styles.optionTitleActive]}
                >
                  По центру
                </Text>
                <Text style={styles.optionDescription}>{getPositionDescription('center')}</Text>
              </View>
              {position === 'center' && (
                <Ionicons name="checkmark-circle" size={24} color="#00ff88" />
              )}
            </View>
          </Pressable>

          <Pressable
            style={[styles.option, position === 'bottom' && styles.optionActive]}
            onPress={() => setPosition('bottom')}
          >
            <View style={styles.optionHeader}>
              <Ionicons
                name="arrow-down-circle"
                size={28}
                color={position === 'bottom' ? '#00d4ff' : '#8b94a8'}
              />
              <View style={styles.optionInfo}>
                <Text
                  style={[styles.optionTitle, position === 'bottom' && styles.optionTitleActive]}
                >
                  Снизу
                </Text>
                <Text style={styles.optionDescription}>{getPositionDescription('bottom')}</Text>
              </View>
              {position === 'bottom' && (
                <Ionicons name="checkmark-circle" size={24} color="#00ff88" />
              )}
            </View>
          </Pressable>
        </View>

        {/* Кнопка сохранения */}
        <Pressable style={styles.saveButton} onPress={saveSettings}>
          <Ionicons name="save" size={24} color="#fff" />
          <Text style={styles.saveButtonText}>СОХРАНИТЬ НАСТРОЙКИ</Text>
        </Pressable>

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
    fontSize: 18,
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
  option: {
    padding: 16,
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#2d2d5f',
  },
  optionActive: {
    borderColor: '#00d4ff',
    backgroundColor: '#1e2547',
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  optionInfo: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#c7cad9',
    marginBottom: 4,
  },
  optionTitleActive: {
    color: '#00d4ff',
  },
  optionDescription: {
    fontSize: 14,
    color: '#8b94a8',
    lineHeight: 20,
  },
  recommendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  recommendedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ff9500',
  },
  preview: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f59e0b',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  previewSmall: {
    padding: 8,
  },
  previewMedium: {
    padding: 12,
  },
  previewLarge: {
    padding: 16,
  },
  previewIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
  },
  previewDistance: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  saveButton: {
    margin: 16,
    height: 56,
    backgroundColor: '#0066ff',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#0066ff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1,
  },
  bottomSpacer: {
    height: 32,
  },
});
