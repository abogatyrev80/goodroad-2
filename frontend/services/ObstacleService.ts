/**
 * ObstacleService - Сервис для работы с препятствиями из кластеров
 * 
 * Функции:
 * - Загрузка препятствий рядом с текущей позицией
 * - Кэширование данных
 * - Отслеживание пройденных препятствий
 * - Адаптация под реакции водителя
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Obstacle {
  id: string;
  type: 'pothole' | 'speed_bump' | 'bump' | 'braking' | 'vibration' | 'accident';
  latitude: number;
  longitude: number;
  distance: number; // метры
  severity: {
    average: number;
    max: number;
  };
  confidence: number;
  confirmations: number;
  avgSpeed: number; // км/ч
  lastReported: string;
  priority: number;
}

export interface ObstaclesResponse {
  userLocation: {
    latitude: number;
    longitude: number;
  };
  searchRadius: number;
  minConfirmations: number;
  total: number;
  obstacles: Obstacle[];
}

export interface DriverReaction {
  obstacleId: string;
  obstacleType: string;
  action: 'confirmed' | 'dismissed' | 'ignored';
  timestamp: string;
  distance: number; // на каком расстоянии была реакция
}

class ObstacleService {
  private backendUrl: string;
  private cachedObstacles: Obstacle[] = [];
  private lastFetchTime: number = 0;
  private passedObstacles: Set<string> = new Set(); // ID пройденных препятствий
  private driverReactions: DriverReaction[] = [];
  private readonly CACHE_DURATION = 30000; // 30 секунд
  private readonly PASSED_DISTANCE = 50; // метров - считается пройденным

  constructor() {
    const url = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://road-monitor-4.emergent.host';
    this.backendUrl = url.endsWith('/') ? url : url + '/';
    console.log('🚧 ObstacleService initialized with URL:', this.backendUrl);
    this.loadDriverReactions();
  }

  /**
   * Загрузить препятствия рядом с текущей позицией
   */
  async fetchNearbyObstacles(
    latitude: number,
    longitude: number,
    radius: number = 5000,
    minConfirmations: number = 1
  ): Promise<Obstacle[]> {
    try {
      // Проверяем кэш
      const now = Date.now();
      if (now - this.lastFetchTime < this.CACHE_DURATION && this.cachedObstacles.length > 0) {
        console.log('📦 Using cached obstacles:', this.cachedObstacles.length);
        return this.filterActiveObstacles(this.cachedObstacles, latitude, longitude);
      }

      // Запрашиваем с сервера
      const url = `${this.backendUrl}api/obstacles/nearby?latitude=${latitude}&longitude=${longitude}&radius=${radius}&min_confirmations=${minConfirmations}`;
      console.log('🌐 Fetching obstacles from:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: ObstaclesResponse = await response.json();
      
      this.cachedObstacles = data.obstacles;
      this.lastFetchTime = now;

      console.log(`✅ Fetched ${data.total} obstacles`);
      
      return this.filterActiveObstacles(data.obstacles, latitude, longitude);
    } catch (error) {
      console.error('❌ Error fetching obstacles:', error);
      // Возвращаем кэшированные данные в случае ошибки
      return this.filterActiveObstacles(this.cachedObstacles, latitude, longitude);
    }
  }

  /**
   * Фильтрует препятствия - убирает пройденные
   */
  private filterActiveObstacles(obstacles: Obstacle[], currentLat: number, currentLon: number): Obstacle[] {
    return obstacles.filter(obstacle => {
      // Пропускаем пройденные
      if (this.passedObstacles.has(obstacle.id)) {
        return false;
      }

      // Помечаем как пройденные если очень близко (позади)
      if (obstacle.distance < this.PASSED_DISTANCE) {
        this.markAsPassed(obstacle.id);
        return false;
      }

      return true;
    });
  }

  /**
   * Получить ближайшее препятствие
   */
  getClosestObstacle(obstacles: Obstacle[]): Obstacle | null {
    if (obstacles.length === 0) return null;
    
    // Уже отсортированы по приоритету, но выбираем ближайшее
    return obstacles.reduce((closest, current) => {
      return current.distance < closest.distance ? current : closest;
    });
  }

  /**
   * Получить препятствия требующие оповещения
   */
  getAlertsForDistance(obstacles: Obstacle[]): Obstacle[] {
    // Адаптируем дистанцию оповещения на основе реакций водителя
    const alertDistances = this.calculateAlertDistances();
    
    return obstacles.filter(obstacle => {
      const alertDistance = alertDistances[obstacle.type] || 500;
      return obstacle.distance <= alertDistance && obstacle.distance > this.PASSED_DISTANCE;
    });
  }

  /**
   * Вычисляет дистанции оповещения на основе реакций водителя
   */
  private calculateAlertDistances(): Record<string, number> {
    const defaults: Record<string, number> = {
      pothole: 500,
      speed_bump: 300,
      bump: 400,
      braking: 600,
      vibration: 400,
      accident: 800,
    };

    // Анализируем реакции водителя за последние 100 событий
    const recentReactions = this.driverReactions.slice(-100);
    
    for (const reaction of recentReactions) {
      const type = reaction.obstacleType;
      
      if (reaction.action === 'confirmed') {
        // Водитель подтвердил - увеличиваем дистанцию оповещения
        defaults[type] = Math.min(defaults[type] + 50, 1500);
      } else if (reaction.action === 'dismissed') {
        // Водитель отклонил - уменьшаем дистанцию оповещения
        defaults[type] = Math.max(defaults[type] - 50, 200);
      }
    }

    return defaults;
  }

  /**
   * Зарегистрировать реакцию водителя
   */
  async recordDriverReaction(
    obstacle: Obstacle,
    action: 'confirmed' | 'dismissed' | 'ignored'
  ): Promise<void> {
    const reaction: DriverReaction = {
      obstacleId: obstacle.id,
      obstacleType: obstacle.type,
      action,
      timestamp: new Date().toISOString(),
      distance: obstacle.distance,
    };

    this.driverReactions.push(reaction);

    // Сохраняем только последние 200 реакций
    if (this.driverReactions.length > 200) {
      this.driverReactions = this.driverReactions.slice(-200);
    }

    await this.saveDriverReactions();
    
    console.log(`📝 Driver reaction recorded: ${action} for ${obstacle.type} at ${obstacle.distance}m`);
  }

  /**
   * Пометить препятствие как пройденное
   */
  markAsPassed(obstacleId: string): void {
    this.passedObstacles.add(obstacleId);
    console.log(`✅ Obstacle marked as passed: ${obstacleId}`);
  }

  /**
   * Очистить пройденные препятствия (когда остановились)
   */
  clearPassedObstacles(): void {
    this.passedObstacles.clear();
    console.log('🧹 Cleared passed obstacles');
  }

  /**
   * Сохранить реакции водителя
   */
  private async saveDriverReactions(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        'driver_reactions',
        JSON.stringify(this.driverReactions)
      );
    } catch (error) {
      console.error('❌ Error saving driver reactions:', error);
    }
  }

  /**
   * Загрузить реакции водителя
   */
  private async loadDriverReactions(): Promise<void> {
    try {
      const data = await AsyncStorage.getItem('driver_reactions');
      if (data) {
        this.driverReactions = JSON.parse(data);
        console.log(`📂 Loaded ${this.driverReactions.length} driver reactions`);
      }
    } catch (error) {
      console.error('❌ Error loading driver reactions:', error);
    }
  }

  /**
   * Получить статистику адаптации
   */
  getAdaptationStats(): {
    totalReactions: number;
    confirmed: number;
    dismissed: number;
    ignored: number;
  } {
    return {
      totalReactions: this.driverReactions.length,
      confirmed: this.driverReactions.filter(r => r.action === 'confirmed').length,
      dismissed: this.driverReactions.filter(r => r.action === 'dismissed').length,
      ignored: this.driverReactions.filter(r => r.action === 'ignored').length,
    };
  }

  /**
   * Получить иконку для типа препятствия
   */
  getObstacleIcon(type: string): string {
    const icons: Record<string, string> = {
      pothole: '🕳️',
      speed_bump: '⚠️',
      bump: '⚠️',
      braking: '🚨',
      vibration: '〰️',
      accident: '🚨',
    };
    return icons[type] || '📍';
  }

  /**
   * Получить цвет для уровня серьезности
   */
  getSeverityColor(severity: number): string {
    if (severity <= 2) return '#dc2626'; // Критично
    if (severity <= 3) return '#f59e0b'; // Средне
    return '#22c55e'; // Низко
  }
}

// Singleton
export const obstacleService = new ObstacleService();
export default obstacleService;
