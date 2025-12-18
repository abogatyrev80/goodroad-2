/**
 * DynamicAudioAlertService - Динамическая система аудио-оповещений
 * 
 * Особенности:
 * - Частота звука зависит от расстояния (чем ближе - тем чаще)
 * - Высота тона зависит от опасности
 * - Рекомендуемые скорости для типов препятствий
 * - Настраиваемые пределы срабатывания
 * - Учет разницы между текущей и рекомендуемой скоростью
 */

import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Obstacle } from './ObstacleService';

// Пользовательский звук
export interface CustomSoundItem {
  id: string;
  name: string;
  uri: string;
}

// Настройки звуков для типов препятствий
export interface ObstacleSoundSettings {
  useCustom: boolean; // true = использовать свой звук, false = использовать тему
  customSoundId?: string; // ID пользовательского звука (если useCustom=true)
}

export interface DynamicAudioSettings {
  voiceEnabled: boolean;
  beepEnabled: boolean;
  volume: number; // 0.0 - 1.0
  minDistance: number; // Минимальная дистанция для предупреждений (метры)
  maxDistance: number; // Максимальная дистанция для предупреждений (метры)
  minSpeed: number; // Минимальная скорость для предупреждений (м/с)
  language: 'ru' | 'en';
  soundTheme: 'motion-tracker' | 'radar-detector' | 'custom'; // 🆕 + custom для своего звука
  customThemeSoundId?: string; // 🆕 ID пользовательского звука для темы "custom"
  theme: 'gentle' | 'moderate' | 'urgent'; // Тема звуковых сигналов
  beepStartDistance: number; // Расстояние начала beep сигналов (метры)
  beepIntervalAtFar: number; // Интервал beep на дальнем расстоянии (мс)
  beepIntervalAtNear: number; // Интервал beep на близком расстоянии (мс)
  speedWarningEnabled: boolean; // Предупреждать о превышении рекомендуемой скорости
  recommendedSpeeds: Record<string, number>; // 🆕 Настраиваемые рекомендуемые скорости
  speedThresholdExcess: number; // 🆕 Порог превышения скорости для звуковых предупреждений (км/ч)
  customTexts: Record<string, string>; // 🆕 Кастомные тексты предупреждений
  obstacleSounds: Record<string, ObstacleSoundSettings>; // 🆕 Индивидуальные звуки для типов препятствий
}

// Рекомендуемые скорости по умолчанию для типов препятствий (км/ч)
export const DEFAULT_RECOMMENDED_SPEEDS: Record<string, number> = {
  'speed_bump': 20,      // Лежачий полицейский - 20 км/ч
  'pothole': 40,         // Яма - 40 км/ч
  'bump': 50,            // Неровность - 50 км/ч
  'braking': 60,         // Место торможения - 60 км/ч
  'vibration': 70,       // Вибрация - 70 км/ч
  'accident': 30,        // Авария - 30 км/ч
};

// Минимальные расстояния для начала предупреждения (метры)
const BASE_WARNING_DISTANCES: Record<number, number> = {
  1: 500,  // Критическая опасность - 500м
  2: 400,  // Высокая опасность - 400м
  3: 300,  // Средняя опасность - 300м
  4: 200,  // Низкая опасность - 200м
  5: 100,  // Минимальная опасность - 100м
};

class DynamicAudioAlertService {
  private settings: DynamicAudioSettings = {
    voiceEnabled: true,
    beepEnabled: true,
    volume: 0.8,
    minDistance: 50,   // Не предупреждать ближе 50м (слишком поздно)
    maxDistance: 600,  // Не предупреждать дальше 600м (слишком рано)
    minSpeed: 5,      // м/с (~18 км/ч)
    language: 'ru',
    soundTheme: 'motion-tracker', // По умолчанию "Чужие"
    customThemeSoundId: undefined, // Нет пользовательского звука
    theme: 'moderate',
    beepStartDistance: 200,
    beepIntervalAtFar: 3000,
    beepIntervalAtNear: 500,
    speedWarningEnabled: true,
    recommendedSpeeds: { ...DEFAULT_RECOMMENDED_SPEEDS }, // Копируем значения по умолчанию
    speedThresholdExcess: 20, // +20 км/ч сверх рекомендованной
    customTexts: { // Кастомные тексты по умолчанию
      'pothole': 'Яма через',
      'speed_bump': 'Лежачий полицейский через',
      'bump': 'Неровность через',
      'vibration': 'Плохое покрытие через',
      'braking': 'Место торможения через',
    },
    obstacleSounds: { // Звуки для типов препятствий (по умолчанию - используем тему)
      'pothole': { useCustom: false },
      'speed_bump': { useCustom: false },
      'bump': { useCustom: false },
      'vibration': { useCustom: false },
      'braking': { useCustom: false },
    },
  };
  
  private customSoundCache: Map<string, Audio.Sound> = new Map();

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
        this.settings = { ...this.settings, ...JSON.parse(saved) };
        console.log('🔊 Dynamic audio settings loaded:', this.settings);
      }
    } catch (error) {
      console.error('❌ Error loading dynamic audio settings:', error);
    }
  }

  async saveSettings(newSettings: Partial<DynamicAudioSettings>): Promise<void> {
    await this.ensureInitialized();
    this.settings = { ...this.settings, ...newSettings };
    
    try {
      await AsyncStorage.setItem('dynamic_audio_settings', JSON.stringify(this.settings));
      console.log('✅ Dynamic audio settings saved:', this.settings);
    } catch (error) {
      console.error('❌ Error saving dynamic audio settings:', error);
    }
  }

  getSettings(): DynamicAudioSettings {
    return { ...this.settings };
  }

  /**
   * Инициализация короткого звукового сигнала (beep)
   */
  private async initBeepSound(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
      });

      // Используем короткий radar звук
      const { sound } = await Audio.Sound.createAsync(
        require('../assets/sounds/radar-emergency.mp3'),
        { volume: this.settings.volume, shouldPlay: false }
      );
      
      this.beepSound = sound;
      console.log('✅ Beep sound initialized');
    } catch (error) {
      console.error('❌ Error initializing beep sound:', error);
    }
  }

  /**
   * Вычисляет интервал между звуковыми сигналами (мс)
   * Чем ближе препятствие - тем чаще сигналы
   */
  private calculateBeepInterval(distance: number, severity: number, speedDiff: number): number {
    // Базовый интервал зависит от расстояния
    let baseInterval: number;
    
    if (distance < 100) {
      baseInterval = 300;  // Очень близко - каждые 0.3 сек
    } else if (distance < 200) {
      baseInterval = 600;  // Близко - каждые 0.6 сек
    } else if (distance < 300) {
      baseInterval = 1000; // Средне - каждую секунду
    } else if (distance < 400) {
      baseInterval = 1500; // Далековато - каждые 1.5 сек
    } else {
      baseInterval = 2000; // Далеко - каждые 2 сек
    }

    // Корректируем на основе опасности (severity: 1=critical, 5=low)
    const severityMultiplier = 1.2 - (severity * 0.04); // 1.16 для critical, 1.0 для low
    baseInterval = baseInterval / severityMultiplier;

    // Корректируем на основе превышения скорости
    if (speedDiff > 0) {
      // Превышаем рекомендуемую скорость - сигналы чаще
      const speedFactor = 1 + (speedDiff / 50); // +1 за каждые 50 км/ч превышения
      baseInterval = baseInterval / speedFactor;
    }

    return Math.max(200, Math.min(3000, baseInterval)); // Ограничиваем 0.2-3 сек
  }

  /**
   * Вычисляет высоту тона (playback rate)
   * Чем опаснее - тем выше тон
   */
  private calculatePlaybackRate(severity: number, distance: number): number {
    // Базовая скорость зависит от опасности
    let baseRate = 1.5 - (severity * 0.1); // 1.4 для critical, 1.0 для low

    // Увеличиваем скорость при приближении
    if (distance < 100) {
      baseRate *= 1.3;
    } else if (distance < 200) {
      baseRate *= 1.15;
    }

    return Math.max(0.8, Math.min(2.0, baseRate)); // Ограничиваем 0.8-2.0x
  }

  /**
   * Проигрывает звуковой сигнал с динамическими параметрами
   */
  private async playBeep(rate: number): Promise<void> {
    if (!this.beepSound || !this.settings.beepEnabled) return;

    try {
      // Останавливаем предыдущее воспроизведение
      await this.beepSound.stopAsync();
      await this.beepSound.setPositionAsync(0);
      
      // Устанавливаем высоту тона
      await this.beepSound.setRateAsync(rate, true);
      
      // Устанавливаем громкость
      await this.beepSound.setVolumeAsync(this.settings.volume);
      
      // Воспроизводим
      await this.beepSound.playAsync();
      
      this.lastBeepTime = Date.now();
    } catch (error) {
      console.error('❌ Error playing beep:', error);
    }
  }

  /**
   * Основная функция динамического оповещения
   */
  async alertDynamic(
    obstacle: Obstacle,
    currentSpeed: number // км/ч
  ): Promise<void> {
    await this.ensureInitialized();

    const distance = obstacle.distance;
    const severity = obstacle.severity.max;
    const obstacleType = obstacle.type;

    // Проверяем пределы дистанции
    if (distance < this.settings.minDistance || distance > this.settings.maxDistance) {
      return;
    }

    // Получаем рекомендуемую скорость из настроек
    const recommendedSpeed = this.settings.recommendedSpeeds[obstacleType] || 50;
    const speedDiff = currentSpeed - recommendedSpeed; // Положительно если превышаем

    // Предупреждение о скорости (только один раз при входе в зону)
    if (this.settings.speedWarningEnabled && 
        speedDiff > 10 && 
        this.activeObstacleId !== obstacle.id &&
        this.settings.voiceEnabled) {
      
      const warningText = this.settings.language === 'ru'
        ? `Снизьте скорость до ${recommendedSpeed} километров в час`
        : `Reduce speed to ${recommendedSpeed} kilometers per hour`;
      
      Speech.speak(warningText, {
        language: this.settings.language === 'ru' ? 'ru-RU' : 'en-US',
        rate: 1.1,
        volume: this.settings.volume,
      });
    }

    // Вычисляем параметры звукового сигнала
    const beepInterval = this.calculateBeepInterval(distance, severity, speedDiff);
    const playbackRate = this.calculatePlaybackRate(severity, distance);

    // Проверяем, пора ли пищать
    const now = Date.now();
    const timeSinceLastBeep = now - this.lastBeepTime;

    if (timeSinceLastBeep >= beepInterval) {
      await this.playBeep(playbackRate);
      
      console.log(`🔊 Beep: distance=${distance}m, interval=${beepInterval}ms, rate=${playbackRate.toFixed(2)}x, speedDiff=${speedDiff.toFixed(0)}km/h`);
    }

    // Запоминаем активное препятствие
    this.activeObstacleId = obstacle.id;
  }

  /**
   * Голосовое объявление типа препятствия (проигрывается один раз)
   */
  async announceObstacle(obstacle: Obstacle): Promise<void> {
    await this.ensureInitialized();

    if (!this.settings.voiceEnabled) return;

    const obstacleType = obstacle.type;
    const distance = obstacle.distance;
    const recommendedSpeed = this.settings.recommendedSpeeds[obstacleType] || 50;

    let text = '';
    
    if (this.settings.language === 'ru') {
      const obstacleNames: Record<string, string> = {
        'speed_bump': 'Лежачий полицейский',
        'pothole': 'Яма на дороге',
        'bump': 'Неровность',
        'braking': 'Зона торможения',
        'vibration': 'Плохое покрытие',
        'accident': 'Авария',
      };
      
      const name = obstacleNames[obstacleType] || 'Препятствие';
      text = `${name} через ${distance} метров. Рекомендуемая скорость ${recommendedSpeed} километров в час.`;
    } else {
      text = `${obstacleType} ahead in ${distance} meters. Recommended speed ${recommendedSpeed} kilometers per hour.`;
    }

    Speech.speak(text, {
      language: this.settings.language === 'ru' ? 'ru-RU' : 'en-US',
      rate: 1.0,
      volume: this.settings.volume,
    });
  }

  /**
   * Сбросить активное препятствие (когда проехали)
   */
  clearActiveObstacle(): void {
    this.activeObstacleId = null;
    this.lastBeepTime = 0;
  }

  /**
   * 🆕 Объявить препятствие с кастомным текстом
   */
  async announceObstacleWithText(obstacle: Obstacle, customText: string): Promise<void> {
    await this.ensureInitialized();
    
    if (!this.settings.voiceEnabled) {
      return;
    }

    try {
      await Speech.speak(customText, {
        language: this.settings.language === 'ru' ? 'ru-RU' : 'en-US',
        pitch: 1.0,
        rate: 0.9,
        volume: this.settings.volume,
      });
      
      console.log(`🗣️ Announced obstacle with custom text: ${customText}`);
    } catch (error) {
      console.error('❌ Error announcing obstacle with custom text:', error);
    }
  }

  /**
   * 🆕 Динамическое оповещение с заданной частотой
   */
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
    
    // Вычисляем интервал на основе частоты
    // frequency = количество beep в секунду
    const interval = 1000 / frequency; // мс между beep
    
    // Проверяем можно ли уже сделать beep
    if (timeSinceLastBeep < interval) {
      return; // Еще рано
    }

    // Определяем высоту тона на основе расстояния
    let pitch = 1.0;
    if (distance < 50) {
      pitch = 1.5; // Высокий тон - очень близко!
    } else if (distance < 100) {
      pitch = 1.3;
    } else if (distance < 200) {
      pitch = 1.1;
    }

    // Воспроизводим звук
    await this.playBeepWithPitch(pitch);
    this.lastBeepTime = now;
    
    console.log(`🔊 Dynamic beep at ${distance}m (frequency: ${frequency.toFixed(2)}/s, pitch: ${pitch})`);
  }

  /**
   * 🆕 Воспроизведение beep с заданной высотой тона
   */
  private async playBeepWithPitch(pitch: number): Promise<void> {
    try {
      if (!this.beepSound) {
        await this.initBeepSound();
      }
      
      if (this.beepSound) {
        await this.beepSound.setPositionAsync(0);
        await this.beepSound.setRateAsync(pitch, true); // Изменяем высоту тона
        await this.beepSound.setVolumeAsync(this.settings.volume);
        await this.beepSound.playAsync();
      }
    } catch (error) {
      console.error('❌ Error playing beep with pitch:', error);
    }
  }

  /**
   * Очистка ресурсов
   */
  async cleanup(): Promise<void> {
    if (this.beepSound) {
      await this.beepSound.unloadAsync();
      this.beepSound = null;
    }
  }
}

export default new DynamicAudioAlertService();
