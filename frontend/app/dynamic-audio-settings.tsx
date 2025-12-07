/**
 * Настройки динамических аудио-предупреждений
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Slider from '@react-native-community/slider';
import DynamicAudioAlertService, { 
  DynamicAudioSettings, 
  RECOMMENDED_SPEEDS 
} from '../services/DynamicAudioAlertService';

export default function DynamicAudioSettingsScreen() {
  const [settings, setSettings] = useState<DynamicAudioSettings>(
    DynamicAudioAlertService.getSettings()
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = () => {
    const current = DynamicAudioAlertService.getSettings();
    setSettings(current);
  };

  const saveSettings = async (newSettings: Partial<DynamicAudioSettings>) => {
    setLoading(true);
    try {
      await DynamicAudioAlertService.saveSettings(newSettings);
      setSettings({ ...settings, ...newSettings });
      Alert.alert('✅ Успешно', 'Настройки сохранены');
    } catch (error) {
      Alert.alert('❌ Ошибка', 'Не удалось сохранить настройки');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={28} color="#00d4ff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Динамические Предупреждения</Text>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Описание */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={24} color="#00d4ff" />
          <Text style={styles.infoText}>
            Частота и высота звуковых сигналов меняется в зависимости от расстояния,
            опасности препятствия и вашей скорости
          </Text>
        </View>

        {/* Включение звуковых сигналов */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔊 Звуковые сигналы</Text>
          
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Звуковые сигналы (beep)</Text>
              <Text style={styles.settingDescription}>
                Динамические звуковые сигналы
              </Text>
            </View>
            <Switch
              value={settings.beepEnabled}
              onValueChange={(value) => saveSettings({ beepEnabled: value })}
              trackColor={{ false: '#767577', true: '#00d4ff' }}
              thumbColor={settings.beepEnabled ? '#ffffff' : '#f4f3f4'}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Голосовые объявления</Text>
              <Text style={styles.settingDescription}>
                Тип препятствия и рекомендуемая скорость
              </Text>
            </View>
            <Switch
              value={settings.voiceEnabled}
              onValueChange={(value) => saveSettings({ voiceEnabled: value })}
              trackColor={{ false: '#767577', true: '#00d4ff' }}
              thumbColor={settings.voiceEnabled ? '#ffffff' : '#f4f3f4'}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Предупреждения о скорости</Text>
              <Text style={styles.settingDescription}>
                Если превышаете рекомендуемую скорость
              </Text>
            </View>
            <Switch
              value={settings.speedWarningEnabled}
              onValueChange={(value) => saveSettings({ speedWarningEnabled: value })}
              trackColor={{ false: '#767577', true: '#00d4ff' }}
              thumbColor={settings.speedWarningEnabled ? '#ffffff' : '#f4f3f4'}
            />
          </View>
        </View>

        {/* Громкость */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔉 Громкость</Text>
          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>Громкость: {Math.round(settings.volume * 100)}%</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={1}
              step={0.1}
              value={settings.volume}
              onSlidingComplete={(value) => saveSettings({ volume: value })}
              minimumTrackTintColor="#00d4ff"
              maximumTrackTintColor="#333"
              thumbTintColor="#00d4ff"
            />
          </View>
        </View>

        {/* Пределы дистанций */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📏 Пределы срабатывания</Text>
          
          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>
              Минимальная дистанция: {settings.minDistance}м
            </Text>
            <Text style={styles.sliderDescription}>
              Не предупреждать ближе (слишком поздно)
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={10}
              maximumValue={200}
              step={10}
              value={settings.minDistance}
              onSlidingComplete={(value) => saveSettings({ minDistance: value })}
              minimumTrackTintColor="#00d4ff"
              maximumTrackTintColor="#333"
              thumbTintColor="#00d4ff"
            />
          </View>

          <View style={styles.sliderContainer}>
            <Text style={styles.sliderLabel}>
              Максимальная дистанция: {settings.maxDistance}м
            </Text>
            <Text style={styles.sliderDescription}>
              Не предупреждать дальше (слишком рано)
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={200}
              maximumValue={1000}
              step={50}
              value={settings.maxDistance}
              onSlidingComplete={(value) => saveSettings({ maxDistance: value })}
              minimumTrackTintColor="#00d4ff"
              maximumTrackTintColor="#333"
              thumbTintColor="#00d4ff"
            />
          </View>
        </View>

        {/* Рекомендуемые скорости */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🚗 Рекомендуемые скорости</Text>
          <Text style={styles.sectionDescription}>
            Настройте безопасную скорость для каждого типа препятствия
          </Text>

          <View style={styles.speedTable}>
            {/* Лежачий полицейский */}
            <View style={styles.editableSpeedRow}>
              <View style={styles.speedRowHeader}>
                <Ionicons name="warning" size={20} color="#ff3b30" />
                <Text style={styles.speedType}>Лежачий полицейский</Text>
              </View>
              <Slider
                style={styles.speedSlider}
                minimumValue={10}
                maximumValue={60}
                step={5}
                value={settings.recommendedSpeeds.speed_bump}
                onSlidingComplete={(value) => saveSettings({
                  recommendedSpeeds: { ...settings.recommendedSpeeds, speed_bump: value }
                })}
                minimumTrackTintColor="#ff3b30"
                maximumTrackTintColor="#333"
                thumbTintColor="#ff3b30"
              />
              <Text style={styles.speedValue}>{settings.recommendedSpeeds.speed_bump} км/ч</Text>
            </View>

            {/* Яма */}
            <View style={styles.editableSpeedRow}>
              <View style={styles.speedRowHeader}>
                <Ionicons name="alert-circle" size={20} color="#ff9500" />
                <Text style={styles.speedType}>Яма</Text>
              </View>
              <Slider
                style={styles.speedSlider}
                minimumValue={20}
                maximumValue={80}
                step={5}
                value={settings.recommendedSpeeds.pothole}
                onSlidingComplete={(value) => saveSettings({
                  recommendedSpeeds: { ...settings.recommendedSpeeds, pothole: value }
                })}
                minimumTrackTintColor="#ff9500"
                maximumTrackTintColor="#333"
                thumbTintColor="#ff9500"
              />
              <Text style={styles.speedValue}>{settings.recommendedSpeeds.pothole} км/ч</Text>
            </View>

            {/* Неровность */}
            <View style={styles.editableSpeedRow}>
              <View style={styles.speedRowHeader}>
                <Ionicons name="ellipse" size={20} color="#ffcc00" />
                <Text style={styles.speedType}>Неровность</Text>
              </View>
              <Slider
                style={styles.speedSlider}
                minimumValue={30}
                maximumValue={90}
                step={5}
                value={settings.recommendedSpeeds.bump}
                onSlidingComplete={(value) => saveSettings({
                  recommendedSpeeds: { ...settings.recommendedSpeeds, bump: value }
                })}
                minimumTrackTintColor="#ffcc00"
                maximumTrackTintColor="#333"
                thumbTintColor="#ffcc00"
              />
              <Text style={styles.speedValue}>{settings.recommendedSpeeds.bump} км/ч</Text>
            </View>

            {/* Зона торможения */}
            <View style={styles.editableSpeedRow}>
              <View style={styles.speedRowHeader}>
                <Ionicons name="hand-left" size={20} color="#34c759" />
                <Text style={styles.speedType}>Зона торможения</Text>
              </View>
              <Slider
                style={styles.speedSlider}
                minimumValue={40}
                maximumValue={100}
                step={5}
                value={settings.recommendedSpeeds.braking}
                onSlidingComplete={(value) => saveSettings({
                  recommendedSpeeds: { ...settings.recommendedSpeeds, braking: value }
                })}
                minimumTrackTintColor="#34c759"
                maximumTrackTintColor="#333"
                thumbTintColor="#34c759"
              />
              <Text style={styles.speedValue}>{settings.recommendedSpeeds.braking} км/ч</Text>
            </View>

            {/* Вибрация */}
            <View style={styles.editableSpeedRow}>
              <View style={styles.speedRowHeader}>
                <Ionicons name="pulse" size={20} color="#5ac8fa" />
                <Text style={styles.speedType}>Вибрация</Text>
              </View>
              <Slider
                style={styles.speedSlider}
                minimumValue={50}
                maximumValue={110}
                step={5}
                value={settings.recommendedSpeeds.vibration}
                onSlidingComplete={(value) => saveSettings({
                  recommendedSpeeds: { ...settings.recommendedSpeeds, vibration: value }
                })}
                minimumTrackTintColor="#5ac8fa"
                maximumTrackTintColor="#333"
                thumbTintColor="#5ac8fa"
              />
              <Text style={styles.speedValue}>{settings.recommendedSpeeds.vibration} км/ч</Text>
            </View>

            {/* Авария */}
            <View style={styles.editableSpeedRow}>
              <View style={styles.speedRowHeader}>
                <Ionicons name="warning-outline" size={20} color="#af52de" />
                <Text style={styles.speedType}>Авария</Text>
              </View>
              <Slider
                style={styles.speedSlider}
                minimumValue={10}
                maximumValue={60}
                step={5}
                value={settings.recommendedSpeeds.accident}
                onSlidingComplete={(value) => saveSettings({
                  recommendedSpeeds: { ...settings.recommendedSpeeds, accident: value }
                })}
                minimumTrackTintColor="#af52de"
                maximumTrackTintColor="#333"
                thumbTintColor="#af52de"
              />
              <Text style={styles.speedValue}>{settings.recommendedSpeeds.accident} км/ч</Text>
            </View>
          </View>
        </View>

        {/* Как это работает */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💡 Как это работает</Text>
          
          <View style={styles.howItWorksItem}>
            <Text style={styles.howItWorksTitle}>🎵 Частота сигналов</Text>
            <Text style={styles.howItWorksText}>
              Чем ближе препятствие → тем чаще пищит (от 0.2 до 3 сек)
            </Text>
          </View>

          <View style={styles.howItWorksItem}>
            <Text style={styles.howItWorksTitle}>🎼 Высота тона</Text>
            <Text style={styles.howItWorksText}>
              Чем опаснее → тем выше тон (0.8x - 2.0x скорость воспроизведения)
            </Text>
          </View>

          <View style={styles.howItWorksItem}>
            <Text style={styles.howItWorksTitle}>⚡ Превышение скорости</Text>
            <Text style={styles.howItWorksText}>
              Если едете быстрее рекомендуемой → сигналы еще чаще
            </Text>
          </View>

          <View style={styles.howItWorksItem}>
            <Text style={styles.howItWorksTitle}>🗣️ Голосовые подсказки</Text>
            <Text style={styles.howItWorksText}>
              Один раз объявляет тип препятствия и рекомендуемую скорость
            </Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#0a2540',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    color: '#00d4ff',
    lineHeight: 20,
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 24,
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
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    color: '#888',
  },
  sliderContainer: {
    backgroundColor: '#111',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  sliderLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  sliderDescription: {
    fontSize: 13,
    color: '#888',
    marginBottom: 12,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  speedTable: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 8,
  },
  speedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  editableSpeedRow: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  speedRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  speedType: {
    flex: 1,
    fontSize: 15,
    color: '#fff',
    marginLeft: 12,
  },
  speedSlider: {
    width: '100%',
    height: 40,
    marginVertical: 4,
  },
  speedValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#00d4ff',
    textAlign: 'right',
  },
  howItWorksItem: {
    backgroundColor: '#111',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  howItWorksTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  howItWorksText: {
    fontSize: 14,
    color: '#888',
    lineHeight: 20,
  },
});
