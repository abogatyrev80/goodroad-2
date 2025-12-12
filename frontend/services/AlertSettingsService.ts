/**
 * AlertSettingsService - Сервис для управления настройками системы предупреждений
 * 
 * Функции:
 * - Настройка порога превышения скорости
 * - Кастомизация текстов предупреждений
 * - Настройка звуковых тем и интенсивности
 * - Логика "умолчания" при нормальной скорости
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AlertSettings {
  // Порог превышения скорости (км/ч)
  speedThresholdExcess: number; // По умолчанию 20 км/ч
  
  // Режимы предупреждения
  alertMode: 'silent' | 'visual' | 'voice' | 'full'; // silent - молчит, visual - только визуально, voice - голос без сирены, full - всё
  
  // Рекомендованная скорость для разных типов
  recommendedSpeeds: {
    pothole: number;      // Яма - рекомендуется 40 км/ч
    speed_bump: number;   // Лежачий - рекомендуется 20 км/ч
    bump: number;         // Неровность - рекомендуется 50 км/ч
    vibration: number;    // Вибрация - рекомендуется 60 км/ч
    braking: number;      // Торможение - рекомендуется 50 км/ч
  };
  
  // Кастомные тексты предупреждений
  customTexts: {
    pothole: string;
    speed_bump: string;
    bump: string;
    vibration: string;
    braking: string;
  };
  
  // Расстояния для предупреждений (метры)
  alertDistances: {
    earlyWarning: number;   // Раннее предупреждение (200м)
    mainWarning: number;    // Основное предупреждение (100м)
    urgentWarning: number;  // Срочное (50м)
  };
}

const DEFAULT_SETTINGS: AlertSettings = {
  speedThresholdExcess: 20, // +20 км/ч сверх рекомендованной
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
};

class AlertSettingsService {
  private settings: AlertSettings = DEFAULT_SETTINGS;
  private readonly STORAGE_KEY = '@alert_settings';

  async initialize() {
    try {
      const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('Error loading alert settings:', error);
    }
  }

  async saveSettings(settings: Partial<AlertSettings>) {
    try {
      this.settings = { ...this.settings, ...settings };
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Error saving alert settings:', error);
    }
  }

  getSettings(): AlertSettings {
    return { ...this.settings };
  }

  /**
   * Проверяет, нужно ли предупреждать на основе скорости
   * @returns { shouldAlert, alertLevel } - нужно ли предупреждать и уровень (silent/visual/voice/full)
   */
  checkSpeedAlert(obstacleType: string, currentSpeed: number): {
    shouldAlert: boolean;
    alertLevel: 'silent' | 'visual' | 'voice' | 'full';
    speedExcess: number;
  } {
    const recommendedSpeed = this.settings.recommendedSpeeds[obstacleType as keyof typeof this.settings.recommendedSpeeds] || 50;
    const speedExcess = currentSpeed - recommendedSpeed;
    
    // Если не превышаем порог - молчим или только визуально
    if (speedExcess <= this.settings.speedThresholdExcess) {
      return {
        shouldAlert: speedExcess > 0, // Предупреждаем если хоть немного превышает
        alertLevel: 'visual', // Только визуально
        speedExcess,
      };
    }
    
    // Превышаем порог - полное предупреждение
    return {
      shouldAlert: true,
      alertLevel: 'full',
      speedExcess,
    };
  }

  /**
   * Получает текст предупреждения
   */
  getAlertText(obstacleType: string, distance: number): string {
    const baseText = this.settings.customTexts[obstacleType as keyof typeof this.settings.customTexts] || 'Препятствие через';
    return `${baseText} ${Math.round(distance)} метров`;
  }

}
// Звуковые настройки теперь находятся в DynamicAudioAlertService (audio-settings.tsx)

export default new AlertSettingsService();
