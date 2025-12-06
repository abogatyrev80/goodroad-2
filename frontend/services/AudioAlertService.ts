/**
 * AudioAlertService - Умная система аудио-оповещений для водителя
 * 
 * Функции:
 * - Голосовые подсказки (Text-to-Speech)
 * - Звуковые сигналы разной интенсивности
 * - Адаптация под реакцию водителя
 * - Эскалация при игнорировании
 */

import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Obstacle } from './ObstacleService';

export interface AudioSettings {
  voiceEnabled: boolean;
  soundEnabled: boolean;
  volume: number; // 0.0 - 1.0
  minConfirmations: number; // 1, 2, 3
  language: 'ru' | 'en';
  soundTheme: 'motion-tracker' | 'radar-detector' | 'voice-only'; // Звуковая схема
}

export interface AlertHistory {
  obstacleId: string;
  distance: number;
  timestamp: number;
  driverReacted: boolean; // снизил ли скорость
}

class AudioAlertService {
  private settings: AudioSettings = {
    voiceEnabled: true,
    soundEnabled: true,
    volume: 0.7,
    minConfirmations: 1,
    language: 'ru',
    soundTheme: 'motion-tracker',
  };

  private alertHistory: Map<string, AlertHistory[]> = new Map();
  private activeAlerts: Set<string> = new Set(); // ID препятствий с активными оповещениями
  private soundObjects: Map<string, Audio.Sound> = new Map();
  private lastSpeed: number = 0;
  private initialized = false;

  constructor() {
    // Не загружаем AsyncStorage в конструкторе - делаем это лениво при первом использовании
  }

  /**
   * Ленивая инициализация сервиса
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await this.loadSettings();
    await this.loadSounds();
    
    this.initialized = true;
  }

  /**
   * Загрузить настройки
   */
  private async loadSettings(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem('audio_settings');
      if (saved) {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
        console.log('🔊 Audio settings loaded:', this.settings);
      }
    } catch (error) {
      console.error('❌ Error loading audio settings:', error);
    }
  }

  /**
   * Сохранить настройки
   */
  async saveSettings(newSettings: Partial<AudioSettings>): Promise<void> {
    // Инициализируемся при первом использовании
    await this.ensureInitialized();

    this.settings = { ...this.settings, ...newSettings };
    try {
      await AsyncStorage.setItem('audio_settings', JSON.stringify(this.settings));
      console.log('✅ Audio settings saved:', this.settings);
    } catch (error) {
      console.error('❌ Error saving audio settings:', error);
    }
  }

  /**
   * Получить текущие настройки
   */
  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  /**
   * Предзагрузить звуковые эффекты
   */
  private async loadSounds(): Promise<void> {
    try {
      // В реальном приложении здесь были бы файлы звуков
      // Пока используем системные звуки
      console.log('🔊 Sound system initialized');
    } catch (error) {
      console.error('❌ Error loading sounds:', error);
    }
  }

  /**
   * Проверить нужно ли оповещение для препятствия
   */
  shouldAlert(obstacle: Obstacle, currentSpeed: number): boolean {
    // Проверяем минимальное количество подтверждений
    if (obstacle.confirmations < this.settings.minConfirmations) {
      return false;
    }

    // Проверяем не было ли уже оповещения
    if (this.activeAlerts.has(obstacle.id)) {
      return false;
    }

    // Вычисляем дистанцию оповещения на основе критичности
    const alertDistance = this.calculateAlertDistance(obstacle);
    
    return obstacle.distance <= alertDistance && obstacle.distance > 50;
  }

  /**
   * Вычислить дистанцию оповещения
   */
  private calculateAlertDistance(obstacle: Obstacle): number {
    let baseDistance = 400; // метров

    // Увеличиваем дистанцию для критичных препятствий
    if (obstacle.confirmations >= 3) {
      baseDistance = 1000;
    } else if (obstacle.confirmations >= 2) {
      baseDistance = 600;
    }

    // Увеличиваем для критичной severity
    if (obstacle.severity.max <= 2) {
      baseDistance *= 1.3;
    }

    // Корректируем на основе истории реакций
    const history = this.alertHistory.get(obstacle.id) || [];
    const reactionRate = history.filter(h => h.driverReacted).length / Math.max(history.length, 1);
    
    if (reactionRate < 0.3) {
      // Водитель часто игнорирует - увеличиваем дистанцию
      baseDistance *= 1.2;
    }

    return Math.round(baseDistance);
  }

  /**
   * Выдать аудио-оповещение
   */
  async alert(obstacle: Obstacle, currentSpeed: number): Promise<void> {
    // Инициализируемся при первом использовании
    await this.ensureInitialized();

    if (!this.settings.voiceEnabled && !this.settings.soundEnabled) {
      return;
    }

    // Определяем уровень срочности
    const urgency = this.getUrgencyLevel(obstacle, currentSpeed);
    
    console.log(`🔊 Audio alert: ${obstacle.type} at ${obstacle.distance}m, urgency: ${urgency}`);

    // Воспроизводим звук
    if (this.settings.soundEnabled) {
      await this.playSound(urgency);
    }

    // Воспроизводим голос
    if (this.settings.voiceEnabled) {
      await this.speak(obstacle, urgency);
    }

    // Добавляем в активные
    this.activeAlerts.add(obstacle.id);

    // Сохраняем в истории
    this.addToHistory(obstacle, currentSpeed);

    // Планируем повторное оповещение если критично
    if (urgency === 'critical' || urgency === 'emergency') {
      setTimeout(() => {
        if (this.activeAlerts.has(obstacle.id)) {
          this.escalate(obstacle, currentSpeed);
        }
      }, urgency === 'emergency' ? 3000 : 5000);
    }
  }

  /**
   * Определить уровень срочности
   */
  private getUrgencyLevel(obstacle: Obstacle, currentSpeed: number): 'info' | 'warning' | 'critical' | 'emergency' {
    const distance = obstacle.distance;
    const severity = obstacle.severity.max;
    const confirmations = obstacle.confirmations;

    // Экстренное - очень близко и опасно
    if (distance < 100 && severity <= 2) {
      return 'emergency';
    }

    // Критичное - близко с множественными подтверждениями
    if (distance < 300 && confirmations >= 3) {
      return 'critical';
    }

    // Предупреждение - средняя дистанция
    if (distance < 600) {
      return 'warning';
    }

    // Информационное - далеко
    return 'info';
  }

  /**
   * Воспроизвести звук
   */
  private async playSound(urgency: string): Promise<void> {
    try {
      // Настраиваем звуковую систему
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });

      // Используем системные звуки в зависимости от срочности
      // В production можно использовать custom звуки
      const sound = new Audio.Sound();
      
      // Разные типы звуков для разных уровней
      const soundUri = this.getSoundUri(urgency);
      
      if (soundUri) {
        await sound.loadAsync(soundUri);
        await sound.setVolumeAsync(this.settings.volume);
        await sound.playAsync();
        
        // Автоматически выгружаем после проигрывания
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            sound.unloadAsync();
          }
        });
      }
    } catch (error) {
      console.error('❌ Error playing sound:', error);
    }
  }

  /**
   * Получить URI звука для уровня срочности
   */
  private getSoundUri(urgency: string): any {
    // Если только голос - не воспроизводим звуки
    if (this.settings.soundTheme === 'voice-only') {
      return null;
    }

    // Выбор звуковых файлов в зависимости от темы
    if (this.settings.soundTheme === 'radar-detector') {
      // Тема "radar-detector" - звуки автомобильного радар-детектора
      const radarSounds: Record<string, any> = {
        info: require('../assets/sounds/radar-info.mp3'),
        warning: require('../assets/sounds/radar-warning.mp3'),
        critical: require('../assets/sounds/radar-critical.mp3'),
        emergency: require('../assets/sounds/radar-emergency.mp3'),
      };
      return radarSounds[urgency] || radarSounds.warning;
    }

    // Тема "motion-tracker" (по умолчанию) - звук датчика движения из фильма "Чужие"
    const motionTrackerSounds: Record<string, any> = {
      info: require('../assets/sounds/info.mp3'),
      warning: require('../assets/sounds/warning.mp3'),
      critical: require('../assets/sounds/critical.mp3'),
      emergency: require('../assets/sounds/emergency.mp3'),
    };

    return motionTrackerSounds[urgency] || motionTrackerSounds.warning;
  }

  /**
   * Произнести голосовое оповещение
   */
  private async speak(obstacle: Obstacle, urgency: string): Promise<void> {
    try {
      const message = this.getMessage(obstacle, urgency);
      const options: Speech.SpeechOptions = {
        language: this.settings.language === 'ru' ? 'ru-RU' : 'en-US',
        pitch: urgency === 'emergency' ? 1.2 : 1.0,
        rate: urgency === 'emergency' ? 1.1 : 0.9,
        volume: this.settings.volume,
      };

      await Speech.speak(message, options);
      console.log(`🗣️ Speaking: ${message}`);
    } catch (error) {
      console.error('❌ Error speaking:', error);
    }
  }

  /**
   * Получить текст сообщения
   */
  private getMessage(obstacle: Obstacle, urgency: string): string {
    const distance = Math.round(obstacle.distance);
    const type = this.getObstacleNameRu(obstacle.type);

    if (this.settings.language === 'ru') {
      switch (urgency) {
        case 'emergency':
          return `ОПАСНОСТЬ! ${type} через ${distance} метров!`;
        case 'critical':
          return `Внимание! ${type} через ${distance} метров`;
        case 'warning':
          return `Впереди ${type}, ${distance} метров`;
        case 'info':
          return `${type} на расстоянии ${distance} метров`;
      }
    } else {
      switch (urgency) {
        case 'emergency':
          return `DANGER! ${obstacle.type} in ${distance} meters!`;
        case 'critical':
          return `Warning! ${obstacle.type} in ${distance} meters`;
        case 'warning':
          return `${obstacle.type} ahead, ${distance} meters`;
        case 'info':
          return `${obstacle.type} at ${distance} meters`;
      }
    }

    return '';
  }

  /**
   * Получить название препятствия на русском
   */
  private getObstacleNameRu(type: string): string {
    const names: Record<string, string> = {
      pothole: 'яма',
      speed_bump: 'лежачий полицейский',
      bump: 'неровность',
      braking: 'требуется торможение',
      vibration: 'неровная дорога',
      accident: 'авария',
    };
    return names[type] || 'препятствие';
  }

  /**
   * Эскалация - более настойчивое оповещение
   */
  private async escalate(obstacle: Obstacle, currentSpeed: number): Promise<void> {
    // Проверяем отреагировал ли водитель (снизил скорость)
    const speedDelta = this.lastSpeed - currentSpeed;
    const driverReacted = speedDelta > 5; // снизил больше чем на 5 км/ч

    if (driverReacted) {
      // Водитель отреагировал - снимаем оповещение
      this.activeAlerts.delete(obstacle.id);
      this.recordReaction(obstacle.id, true);
      console.log(`✅ Driver reacted to ${obstacle.type}`);
      return;
    }

    // Водитель не отреагировал - повторяем с повышенной интенсивностью
    console.log(`⚠️ Escalating alert for ${obstacle.type}`);
    
    if (this.settings.voiceEnabled) {
      await Speech.speak(
        `ВНИМАНИЕ! ${this.getObstacleNameRu(obstacle.type)} ОЧЕНЬ БЛИЗКО!`,
        {
          language: 'ru-RU',
          pitch: 1.3,
          rate: 1.2,
          volume: Math.min(this.settings.volume + 0.2, 1.0),
        }
      );
    }

    this.recordReaction(obstacle.id, false);
  }

  /**
   * Обновить текущую скорость (для отслеживания реакции)
   */
  updateSpeed(speed: number): void {
    this.lastSpeed = speed;
  }

  /**
   * Добавить в историю оповещений
   */
  private addToHistory(obstacle: Obstacle, speed: number): void {
    const history = this.alertHistory.get(obstacle.id) || [];
    history.push({
      obstacleId: obstacle.id,
      distance: obstacle.distance,
      timestamp: Date.now(),
      driverReacted: false, // будет обновлено позже
    });
    this.alertHistory.set(obstacle.id, history);
  }

  /**
   * Записать реакцию водителя
   */
  private recordReaction(obstacleId: string, reacted: boolean): void {
    const history = this.alertHistory.get(obstacleId);
    if (history && history.length > 0) {
      history[history.length - 1].driverReacted = reacted;
    }
  }

  /**
   * Очистить активное оповещение (когда препятствие пройдено)
   */
  clearAlert(obstacleId: string): void {
    this.activeAlerts.delete(obstacleId);
    console.log(`🧹 Cleared alert for ${obstacleId}`);
  }

  /**
   * Очистить все активные оповещения
   */
  clearAllAlerts(): void {
    this.activeAlerts.clear();
    this.alertHistory.clear();
    Speech.stop();
    console.log('🧹 All alerts cleared');
  }

  /**
   * Получить статистику эффективности
   */
  getEffectivenessStats(): {
    totalAlerts: number;
    reactionRate: number;
    averageReactionDistance: number;
  } {
    let totalAlerts = 0;
    let reactedAlerts = 0;
    let totalReactionDistance = 0;

    this.alertHistory.forEach((history) => {
      history.forEach((alert) => {
        totalAlerts++;
        if (alert.driverReacted) {
          reactedAlerts++;
          totalReactionDistance += alert.distance;
        }
      });
    });

    return {
      totalAlerts,
      reactionRate: totalAlerts > 0 ? reactedAlerts / totalAlerts : 0,
      averageReactionDistance: reactedAlerts > 0 ? totalReactionDistance / reactedAlerts : 0,
    };
  }

  /**
   * Произнести текст напрямую (для превью)
   */
  async speakDirect(message: string): Promise<void> {
    try {
      await this.ensureInitialized();
      const options: Speech.SpeechOptions = {
        language: this.settings.language === 'ru' ? 'ru-RU' : 'en-US',
        pitch: 1.0,
        rate: 0.9,
        volume: this.settings.volume,
      };
      await Speech.speak(message, options);
    } catch (error) {
      console.error('❌ Error speaking direct:', error);
    }
  }

  /**
   * Тестовое оповещение
   */
  async testAlert(): Promise<void> {
    // Инициализируемся при первом использовании
    await this.ensureInitialized();

    if (this.settings.voiceEnabled) {
      await Speech.speak('Тестовое голосовое оповещение работает', {
        language: 'ru-RU',
        volume: this.settings.volume,
      });
    }
    if (this.settings.soundEnabled) {
      await this.playSound('warning');
    }
  }
}

// Singleton
export const audioAlertService = new AudioAlertService();
export default audioAlertService;
