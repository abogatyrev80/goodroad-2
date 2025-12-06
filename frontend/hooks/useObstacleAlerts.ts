/**
 * useObstacleAlerts - Хук для управления оповещениями о препятствиях
 * 
 * Интегрирует ObstacleService и AudioAlertService
 */

import { useState, useEffect, useRef } from 'react';
import obstacleService, { Obstacle } from '../services/ObstacleService';
import audioAlertService from '../services/AudioAlertService';

export function useObstacleAlerts(
  isTracking: boolean,
  currentLocation: any,
  currentSpeed: number
) {
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [closestObstacle, setClosestObstacle] = useState<Obstacle | null>(null);
  const fetchInterval = useRef<NodeJS.Timeout | null>(null);
  const lastAlertedObstacles = useRef<Set<string>>(new Set());
  const previousSpeed = useRef<number>(0);
  const alertedObstaclesForReaction = useRef<Map<string, { obstacle: Obstacle; alerted: boolean }>>(new Map());

  // Загрузка препятствий каждые 30 секунд
  useEffect(() => {
    if (!isTracking || !currentLocation) {
      return;
    }

    const fetchObstacles = async () => {
      try {
        const lat = currentLocation.coords.latitude;
        const lon = currentLocation.coords.longitude;

        const nearbyObstacles = await obstacleService.fetchNearbyObstacles(
          lat,
          lon,
          5000, // 5 км радиус
          1 // минимум 1 подтверждение
        );

        setObstacles(nearbyObstacles);

        // Находим ближайшее
        const closest = obstacleService.getClosestObstacle(nearbyObstacles);
        setClosestObstacle(closest);

        // Проверяем нужны ли оповещения
        checkForAlerts(nearbyObstacles);
      } catch (error) {
        console.error('❌ Error fetching obstacles:', error);
      }
    };

    // Загружаем сразу
    fetchObstacles();

    // И каждые 30 секунд
    fetchInterval.current = setInterval(fetchObstacles, 30000);

    return () => {
      if (fetchInterval.current) {
        clearInterval(fetchInterval.current);
      }
    };
  }, [isTracking, currentLocation?.coords?.latitude, currentLocation?.coords?.longitude]);

  // Проверка и выдача аудио-оповещений
  const checkForAlerts = async (obstacleList: Obstacle[]) => {
    // Обновляем скорость в аудио-сервисе
    audioAlertService.updateSpeed(currentSpeed);

    for (const obstacle of obstacleList) {
      // Пропускаем если уже оповещали
      if (lastAlertedObstacles.current.has(obstacle.id)) {
        continue;
      }

      // Проверяем нужно ли оповещение
      if (audioAlertService.shouldAlert(obstacle, currentSpeed)) {
        // Выдаем оповещение
        await audioAlertService.alert(obstacle, currentSpeed);
        
        // Помечаем как оповещенное
        lastAlertedObstacles.current.add(obstacle.id);

        // Очищаем через 60 секунд (чтобы не повторять слишком часто)
        setTimeout(() => {
          lastAlertedObstacles.current.delete(obstacle.id);
          audioAlertService.clearAlert(obstacle.id);
        }, 60000);
      }
    }
  };

  // Очистка при остановке
  useEffect(() => {
    if (!isTracking) {
      audioAlertService.clearAllAlerts();
      lastAlertedObstacles.current.clear();
      setObstacles([]);
      setClosestObstacle(null);
    }
  }, [isTracking]);

  return {
    obstacles,
    closestObstacle,
    obstaclesCount: obstacles.length,
  };
}
