/**
 * useObstacleAlerts - Хук для управления оповещениями о препятствиях
 * 
 * Интегрирует ObstacleService и DynamicAudioAlertService
 */

import { useState, useEffect, useRef } from 'react';
import obstacleService, { Obstacle } from '../services/ObstacleService';
import dynamicAudioService from '../services/DynamicAudioAlertService';

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

  // Проверка и выдача аудио-оповещений с использованием динамической системы
  const checkForAlerts = async (obstacleList: Obstacle[]) => {
    // Получаем настройки динамической системы
    const settings = dynamicAudioService.getSettings();

    for (const obstacle of obstacleList) {
      const distance = obstacle.distance;

      // Проверяем пределы дистанции
      if (distance < settings.minDistance || distance > settings.maxDistance) {
        continue;
      }

      // Проверяем, это новое препятствие?
      if (!lastAlertedObstacles.current.has(obstacle.id)) {
        // Первый раз видим это препятствие - объявляем голосом
        await dynamicAudioService.announceObstacle(obstacle);
        lastAlertedObstacles.current.add(obstacle.id);
        
        // Сохраняем для отслеживания реакции
        alertedObstaclesForReaction.current.set(obstacle.id, {
          obstacle,
          alerted: true,
        });

        // Очищаем через 60 секунд
        setTimeout(() => {
          lastAlertedObstacles.current.delete(obstacle.id);
          dynamicAudioService.clearActiveObstacle();
          alertedObstaclesForReaction.current.delete(obstacle.id);
        }, 60000);
      }

      // Непрерывные динамические сигналы (beep) пока препятствие рядом
      await dynamicAudioService.alertDynamic(obstacle, currentSpeed);

      // Проверяем реакцию водителя
      checkDriverReaction(obstacle);
    }
  };

  // Проверка реакции водителя
  const checkDriverReaction = async (obstacle: Obstacle) => {
    const alertData = alertedObstaclesForReaction.current.get(obstacle.id);
    if (!alertData || !alertData.alerted) return;

    // Проверяем снизил ли водитель скорость
    const speedDelta = previousSpeed.current - currentSpeed;
    
    if (speedDelta > 5) {
      // Водитель отреагировал (снизил скорость более чем на 5 км/ч)
      await obstacleService.recordDriverReaction(obstacle, 'confirmed');
      console.log(`👍 Driver reacted to ${obstacle.type} at ${obstacle.distance}m`);
      
      // Удаляем из отслеживания
      alertedObstaclesForReaction.current.delete(obstacle.id);
    } else if (obstacle.distance < 50) {
      // Препятствие пройдено без снижения скорости - проигнорировано
      await obstacleService.recordDriverReaction(obstacle, 'ignored');
      console.log(`😐 Driver ignored ${obstacle.type}`);
      
      // Удаляем из отслеживания
      alertedObstaclesForReaction.current.delete(obstacle.id);
      obstacleService.markAsPassed(obstacle.id);
    }
  };

  // Отслеживание изменения скорости
  useEffect(() => {
    previousSpeed.current = currentSpeed;
  }, [currentSpeed]);

  // Очистка при остановке
  useEffect(() => {
    if (!isTracking) {
      dynamicAudioService.clearActiveObstacle();
      obstacleService.clearPassedObstacles();
      lastAlertedObstacles.current.clear();
      alertedObstaclesForReaction.current.clear();
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
