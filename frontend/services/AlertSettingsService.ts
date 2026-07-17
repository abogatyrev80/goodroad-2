/**
 * AlertSettingsService - Сервис для управления настройками предупреждений
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AlertSettings {
  speedThresholdExcess: number;
  recommendedSpeeds: {
    pothole: number;
    speed_bump: number;
    bump: number;
    vibration: number;
    braking: number;
  };
  customTexts: {
    pothole: string;
    speed_bump: string;
    bump: string;
    vibration: string;
    braking: string;
  };
}

const DEFAULT_SETTINGS: AlertSettings = {
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
};

class AlertSettingsService {
  private settings: AlertSettings = DEFAULT_SETTINGS;
  private readonly STORAGE_KEY = '@alert_settings';

  async initialize() {
    try {
      const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed === 'object' && parsed !== null) {
          this.settings = { ...DEFAULT_SETTINGS, ...parsed };
        }
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

  checkSpeedAlert(obstacleType: string, currentSpeed: number): {
    shouldAlert: boolean;
    alertLevel: 'silent' | 'visual' | 'voice' | 'full';
    speedExcess: number;
  } {
    const recommendedSpeed = this.settings.recommendedSpeeds[obstacleType as keyof typeof this.settings.recommendedSpeeds] || 50;
    const speedExcess = currentSpeed - recommendedSpeed;

    if (speedExcess <= this.settings.speedThresholdExcess) {
      return {
        shouldAlert: speedExcess > 0,
        alertLevel: 'visual',
        speedExcess,
      };
    }

    return {
      shouldAlert: true,
      alertLevel: 'full',
      speedExcess,
    };
  }

  getAlertText(obstacleType: string, distance: number): string {
    const baseText = this.settings.customTexts[obstacleType as keyof typeof this.settings.customTexts] || 'Препятствие через';
    return `${baseText} ${Math.round(distance)} метров`;
  }

  shouldUseVoice(alertLevel: 'silent' | 'visual' | 'voice' | 'full'): boolean {
    return alertLevel === 'voice' || alertLevel === 'full';
  }

  shouldUseSiren(alertLevel: 'silent' | 'visual' | 'voice' | 'full'): boolean {
    return alertLevel === 'full';
  }

  getSirenFrequency(speedExcess: number, distance: number): number {
    let frequency = 0.5;
    if (speedExcess > 0) {
      frequency += Math.min(speedExcess / 20, 1.5);
    }
    if (distance < 100) {
      frequency *= 2.0;
    } else if (distance < 200) {
      frequency *= 1.5;
    } else if (distance < 300) {
      frequency *= 1.2;
    }
    return Math.max(0.5, Math.min(3.0, frequency));
  }
}

export default new AlertSettingsService();
