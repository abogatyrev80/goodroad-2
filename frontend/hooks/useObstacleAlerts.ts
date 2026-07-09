/**
 * useObstacleAlerts - Хук для управления оповещениями о препятствиях
 * 
 * Интегрирует ObstacleService и DynamicAudioAlertService
 */

import { useState, useEffect, useRef, MutableRefObject } from 'react';
import obstacleService, { Obstacle } from '../services/ObstacleService';
import dynamicAudioService from '../services/DynamicAudioAlertService';
import alertSettingsService from '../services/AlertSettingsService';

const PASSED_DISTANCE_M = 50;

export function useObstacleAlerts(
  isTracking: boolean,
  currentLocation: any,
  currentSpeed: number,
  currentLocationRef?: MutableRefObject<{ coords: { latitude: number; longitude: number; heading?: number } } | null>
) {
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [closestObstacle, setClosestObstacle] = useState<Obstacle | null>(null);
  const fetchInterval = useRef<NodeJS.Timeout | null>(null);
  const lastAlertedObstacles = useRef<Set<string>>(new Set());
  const previousSpeed = useRef<number>(0);
  const alertedObstaclesForReaction = useRef<Map<string, { obstacle: Obstacle; alerted: boolean }>>(new Map());
  const lastPositionRef = useRef<{ lat: number; lon: number } | null>(null);
  const currentSpeedRef = useRef<number>(currentSpeed);

  // Загрузка препятствий каждые 30 секунд
  useEffect(() => {
    if (!isTracking || !currentLocation) {
      setObstacles([]);
      setClosestObstacle(null);
      lastAlertedObstacles.current.clear();
      alertedObstaclesForReaction.current.clear();
      lastPositionRef.current = null;
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
          3 // 🆕 минимум 3 подтверждения (повышено для снижения ложных срабатываний)
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
  
  // Обновление расстояний в реальном времени: направление движения, сразу скрывать проеханные
  useEffect(() => {
    if (!isTracking || obstacles.length === 0) {
      return;
    }

    const updateDistances = () => {
      try {
        const loc = currentLocationRef?.current ?? currentLocation;
        if (!loc?.coords) return;

        const lat = loc.coords.latitude;
        const lon = loc.coords.longitude;

        let effectiveBearing: number | null = null;
        const rawHeading = loc.coords.heading;
        if (typeof rawHeading === 'number' && rawHeading >= 0 && rawHeading <= 360) {
          effectiveBearing = rawHeading;
        } else if (lastPositionRef.current) {
          effectiveBearing = obstacleService.calculateBearing(
            lastPositionRef.current.lat,
            lastPositionRef.current.lon,
            lat,
            lon
          );
        }
        lastPositionRef.current = { lat, lon };

        const passedDistance = obstacleService.getPassedDistance();

        const updatedObstacles = obstacles
          .map(obstacle => {
            const relevantDistance = obstacleService.getRelevantDistance(
              lat,
              lon,
              effectiveBearing,
              obstacle.latitude,
              obstacle.longitude
            );

            if (relevantDistance !== null && relevantDistance < passedDistance) {
              obstacleService.markAsPassed(obstacle.id);
              return { ...obstacle, distance: 999999 };
            }
            return {
              ...obstacle,
              distance: relevantDistance !== null ? relevantDistance : 999999,
            };
          })
          .filter(o => o.distance < 999999);

        setObstacles(updatedObstacles);
        const closest = obstacleService.getClosestObstacle(updatedObstacles);
        setClosestObstacle(closest);
      } catch (error) {
        console.error('❌ Error updating distances:', error);
      }
    };

    // Частота пересчёта расстояния до препятствий (мс): чаще = быстрее реакция на экране
    const speedKmh = currentSpeed;
    let updateInterval: number;
    if (speedKmh < 20) updateInterval = 700;   // было 1500 — ускорено
    else if (speedKmh < 40) updateInterval = 350; // было 600
    else if (speedKmh < 60) updateInterval = 200; // было 400
    else if (speedKmh < 80) updateInterval = 150; // было 250
    else updateInterval = 100;                    // было 200

    updateDistances();
    const distanceUpdateInterval = setInterval(updateDistances, updateInterval);
    return () => clearInterval(distanceUpdateInterval);
  }, [isTracking, currentLocation?.coords?.latitude, currentLocation?.coords?.longitude, currentLocation?.coords?.heading, currentSpeed, obstacles.length]);

  // Проверка и выдача аудио-оповещений с использованием динамической системы
  const checkForAlerts = async (obstacleList: Obstacle[]) => {
    // Получаем настройки динамической системы
    const settings = dynamicAudioService.getSettings();
    const alertSettings = alertSettingsService.getSettings();
    const speed = currentSpeedRef.current;

    for (const obstacle of obstacleList) {
      const distance = obstacle.distance;

      // Проверяем пределы дистанции
      if (distance < settings.minDistance || distance > settings.maxDistance) {
        continue;
      }

      // 🆕 ПРОВЕРКА СКОРОСТИ - должны ли мы предупреждать?
      const speedCheck = alertSettingsService.checkSpeedAlert(obstacle.type, speed * 3.6); // м/с → км/ч
      
      if (!speedCheck.shouldAlert) {
        continue; // Скорость нормальная - молчим
      }

      // Проверяем, это новое препятствие?
      if (!lastAlertedObstacles.current.has(obstacle.id)) {
        // 🆕 Используем кастомный текст и проверяем нужен ли голос
        if (alertSettingsService.shouldUseVoice(speedCheck.alertLevel)) {
          const customText = alertSettingsService.getAlertText(obstacle.type, distance);
          await dynamicAudioService.announceObstacleWithText(obstacle, customText);
        }
        
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

      // 🆕 Непрерывные сирены только если нужно (на основе скорости)
      const shouldUseSiren = alertSettingsService.shouldUseSiren(speedCheck.alertLevel);
      
      if (shouldUseSiren) {
        const sirenFrequency = alertSettingsService.getSirenFrequency(speedCheck.speedExcess, distance);
        await dynamicAudioService.alertDynamicWithFrequency(obstacle, speed, sirenFrequency);
      }

      // Проверяем реакцию водителя
      checkDriverReaction(obstacle);
    }
  };

  // Проверка реакции водителя
  const checkDriverReaction = async (obstacle: Obstacle) => {
    const alertData = alertedObstaclesForReaction.current.get(obstacle.id);
    if (!alertData || !alertData.alerted) return;

    // Проверяем снизил ли водитель скорость
    const speedDelta = previousSpeed.current - currentSpeedRef.current;
    
    if (speedDelta > 5) {
      // Водитель отреагировал (снизил скорость более чем на 5 км/ч)
      await obstacleService.recordDriverReaction(obstacle, 'confirmed');
      
      // Удаляем из отслеживания
      alertedObstaclesForReaction.current.delete(obstacle.id);
    } else if (obstacle.distance < 50) {
      // Препятствие пройдено без снижения скорости - проигнорировано
      await obstacleService.recordDriverReaction(obstacle, 'ignored');
      
      // Удаляем из отслеживания
      alertedObstaclesForReaction.current.delete(obstacle.id);
      obstacleService.markAsPassed(obstacle.id);
    }
  };

  // Отслеживание изменения скорости
  useEffect(() => {
    previousSpeed.current = currentSpeedRef.current;
    currentSpeedRef.current = currentSpeed;
  }, [currentSpeed]);

  // Очистка при остановке
  useEffect(() => {
    if (!isTracking) {
      lastPositionRef.current = null;
      dynamicAudioService.clearActiveObstacle();
      obstacleService.clearPassedObstacles();
      lastAlertedObstacles.current.clear();
      alertedObstaclesForReaction.current.clear();
      setObstacles([]);
      setClosestObstacle(null);
    }
  }, [isTracking]);

  // 🆕 Функция для ручного обновления препятствий
  const refetchObstacles = async () => {
    if (!isTracking || !currentLocation) {
      return;
    }

    try {
      const lat = currentLocation.coords.latitude;
      const lon = currentLocation.coords.longitude;

      const nearbyObstacles = await obstacleService.fetchNearbyObstacles(
        lat,
        lon,
        5000,
        3
      );

      setObstacles(nearbyObstacles);
      const closest = obstacleService.getClosestObstacle(nearbyObstacles);
      setClosestObstacle(closest);
      checkForAlerts(nearbyObstacles);
    } catch (error) {
      console.error('❌ Error refetching obstacles:', error);
    }
  };

  return {
    obstacles,
    closestObstacle,
    obstaclesCount: obstacles.length,
    isNearObstacle: !!closestObstacle,
    refetchObstacles, // 🆕 Экспортируем функцию обновления
  };
}
