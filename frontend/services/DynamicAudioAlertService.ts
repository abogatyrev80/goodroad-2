/**
 * DynamicAudioAlertService - Динамическая система аудио-оповещений
 *
 * Частота звука зависит от расстояния (чем ближе - тем чаще).
 * Высота тона зависит от опасности.
 */

import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Obstacle } from './ObstacleService';

export interface CustomSoundItem {
  id: string;
  name: string;
  uri: string;
}

export interface DynamicAudioSettings {
  voiceEnabled: boolean;
  beepEnabled: boolean;
  volume: number;
  minDistance: number;
  maxDistance: number;
  language: 'ru' | 'en';
  soundTheme: 'motion-tracker' | 'radar-detector' | 'custom';
  customThemeSoundId?: string;
  beepIntervalAtFar: number;
  beepIntervalAtNear: number;
  speedWarningEnabled: boolean;
}

class DynamicAudioAlertService {
  private settings: DynamicAudioSettings = {
    voiceEnabled: true,
    beepEnabled: true,
    volume: 0.8,
    minDistance: 50,
    maxDistance: 600,
    language: 'ru',
    soundTheme: 'motion-tracker',
    customThemeSoundId: undefined,
    beepIntervalAtFar: 3000,
    beepIntervalAtNear: 500,
    speedWarningEnabled: true,
  };

  private beepSound: Audio.Sound | null = null;
  private lastBeepTime: number = 0;
  private activeObstacleId: string | null = null;
  private initialized = false;

  constructor() {}

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.loadSettings();
    await this.initBeepSound();
    this.initialized = true;
  }

  private async loadSettings(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem('dynamic_audio_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed === 'object' && parsed !== null) {
          this.settings = { ...this.settings, ...parsed };
        }
      }
    } catch (error) {
      console.error('Error loading dynamic audio settings:', error);
    }
  }

  async saveSettings(newSettings: Partial<DynamicAudioSettings>): Promise<void> {
    await this.ensureInitialized();
    this.settings = { ...this.settings, ...newSettings };
    try {
      await AsyncStorage.setItem('dynamic_audio_settings', JSON.stringify(this.settings));
    } catch (error) {
      console.error('Error saving dynamic audio settings:', error);
    }
  }

  getSettings(): DynamicAudioSettings {
    return { ...this.settings };
  }

  private async initBeepSound(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
      });

      const { sound } = await Audio.Sound.createAsync(
        require('../assets/sounds/radar-emergency.mp3'),
        { volume: this.settings.volume, shouldPlay: false }
      );

      this.beepSound = sound;
    } catch (error: any) {
      console.error('Error initializing beep sound:', error);
    }
  }

  clearActiveObstacle(): void {
    this.activeObstacleId = null;
    this.lastBeepTime = 0;
  }

  async alertDynamicWithFrequency(
    obstacle: Obstacle,
    currentSpeedMS: number,
    frequency: number
  ): Promise<void> {
    await this.ensureInitialized();

    if (!this.settings.beepEnabled) {
      return;
    }

    const distance = obstacle.distance;
    const now = Date.now();
    const timeSinceLastBeep = now - this.lastBeepTime;

    const interval = 1000 / frequency;

    if (timeSinceLastBeep < interval) {
      return;
    }

    let pitch = 1.0;
    if (distance < 50) {
      pitch = 1.5;
    } else if (distance < 100) {
      pitch = 1.3;
    } else if (distance < 200) {
      pitch = 1.1;
    }

    await this.playBeepWithPitch(pitch);
    this.lastBeepTime = now;
  }

  private async playBeepWithPitch(pitch: number): Promise<void> {
    try {
      if (!this.beepSound) {
        await this.initBeepSound();
      }

      if (!this.beepSound || !this.settings.beepEnabled) {
        return;
      }

      await this.beepSound.setPositionAsync(0);
      await this.beepSound.setRateAsync(pitch, true);
      await this.beepSound.setVolumeAsync(this.settings.volume);
      await this.beepSound.playAsync();
    } catch (error: any) {
      console.error('Error playing beep with pitch:', error);
    }
  }

  async announceObstacleWithText(obstacle: Obstacle, customText: string): Promise<void> {
    await this.ensureInitialized();

    if (!this.settings.voiceEnabled) {
      return;
    }

    try {
      await Speech.stop();
      await Speech.speak(customText, {
        language: this.settings.language === 'ru' ? 'ru-RU' : 'en-US',
        pitch: 1.0,
        rate: 0.9,
        volume: this.settings.volume,
      });
    } catch (error) {
      console.error('Error announcing obstacle with custom text:', error);
    }
  }
}

export default new DynamicAudioAlertService();
