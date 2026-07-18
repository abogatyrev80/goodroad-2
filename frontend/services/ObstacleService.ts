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
import { backendConfigService } from './BackendConfigService';

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
  private cachedObstacles: Obstacle[] = [];
  private lastFetchTime: number = 0;
  private passedObstacles: Set<string> = new Set(); // ID пройденных препятствий
  private driverReactions: DriverReaction[] = [];
  private readonly CACHE_DURATION = 30000; // 30 секунд
  private readonly PASSED_DISTANCE = 50; // метров - считается пройденным
  private initialized = false;

  /** Порог в метрах: ближе — препятствие считается проеханным (для UI и фильтрации) */
  getPassedDistance(): number {
    return this.PASSED_DISTANCE;
  }

  constructor() {
    // Не загружаем AsyncStorage в конструкторе - делаем это лениво при первом использовании
  }

  /**
   * Ленивая инициализация сервиса
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Загружаем реакции водителя
    await this.loadDriverReactions();
    
    this.initialized = true;
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
      // Инициализируемся при первом использовании
      await this.ensureInitialized();

      // Проверяем кэш
      const now = Date.now();
      if (now - this.lastFetchTime < this.CACHE_DURATION && this.cachedObstacles.length > 0) {
        return this.filterActiveObstacles(this.cachedObstacles, latitude, longitude);
      }

      // Запрашиваем с сервера
      const url = `${backendConfigService.getActiveUrl()}/api/obstacles/nearby?latitude=${latitude}&longitude=${longitude}&radius=${radius}&min_confirmations=${minConfirmations}`;

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
    
  }

  /**
   * Пометить препятствие как пройденное
   */
  markAsPassed(obstacleId: string): void {
    this.passedObstacles.add(obstacleId);
  }

  /**
   * Очистить пройденные препятствия (когда остановились)
   */
  clearPassedObstacles(): void {
    this.passedObstacles.clear();
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

  /**
   * Вычислить расстояние между двумя точками (формула Haversine)
   */
  calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371e3; // Радиус Земли в метрах
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Расстояние в метрах
  }

  /**
   * 🆕 Вычислить bearing (направление) от точки 1 к точке 2 в градусах (0-360)
   */
  calculateBearing(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    
    return ((θ * 180) / Math.PI + 360) % 360; // Нормализуем до 0-360
  }

  /**
   * Проверить, находится ли препятствие впереди по курсу (не сбоку и не сзади)
   * @param currentBearing - текущее направление движения (градусы 0-360)
   * @param bearingToObstacle - направление на препятствие (градусы)
   * @param tolerance - полуширина сектора впереди в градусах (45 = 90° впереди)
   * @returns true если препятствие впереди по курсу
   */
  isObstacleAhead(
    currentBearing: number,
    bearingToObstacle: number,
    tolerance: number = 50
  ): boolean {
    let diff = Math.abs(bearingToObstacle - currentBearing);
    if (diff > 180) {
      diff = 360 - diff;
    }
    // Сзади = разница около 180°. Строго: впереди только если diff <= tolerance
    return diff <= tolerance;
  }

  /**
   * 🆕 Получить релевантное расстояние с учетом вектора движения
   * Возвращает null если препятствие не на пути
   */
  getRelevantDistance(
    currentLat: number,
    currentLon: number,
    currentBearing: number | null | undefined,
    obstacleLat: number,
    obstacleLon: number
  ): number | null {
    // Вычисляем прямое расстояние
    const distance = this.calculateDistance(currentLat, currentLon, obstacleLat, obstacleLon);
    
    // Если нет данных о направлении движения (например стоим), используем прямое расстояние
    if (currentBearing === null || currentBearing === undefined || currentBearing === -1) {
      return distance;
    }

    // Вычисляем направление на препятствие
    const bearingToObstacle = this.calculateBearing(
      currentLat,
      currentLon,
      obstacleLat,
      obstacleLon
    );

    const isAhead = this.isObstacleAhead(currentBearing, bearingToObstacle, 50);
    if (!isAhead) {
      return null; // сзади или сбоку — не показываем
    }

    // Препятствие впереди - возвращаем расстояние
    return distance;
  }
}

// Singleton
export const obstacleService = new ObstacleService();
export default obstacleService;
