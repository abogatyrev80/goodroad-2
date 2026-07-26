import { useState, useEffect, useRef, MutableRefObject } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import obstacleService, { Obstacle, ObstacleSector } from '../services/ObstacleService';
import dynamicAudioService from '../services/DynamicAudioAlertService';
import alertSettingsService from '../services/AlertSettingsService';

const PASSED_DISTANCE_M = 50;

export function useObstacleAlerts(
  isTracking: boolean,
  currentLocation: any,
  currentSpeed: number,
  currentLocationRef?: MutableRefObject<{ coords: { latitude: number; longitude: number; heading?: number } } | null>,
  gpsTrailRef?: MutableRefObject<Array<{ latitude: number; longitude: number; timestamp: number }>>
) {
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [closestObstacle, setClosestObstacle] = useState<Obstacle | null>(null);
  const fetchInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAlertedObstacles = useRef<Set<string>>(new Set());
  const previousSpeed = useRef<number>(0);
  const alertedObstaclesForReaction = useRef<Map<string, { obstacle: Obstacle; alerted: boolean }>>(new Map());
  const lastPositionRef = useRef<{ lat: number; lon: number } | null>(null);
  const currentSpeedRef = useRef<number>(currentSpeed);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const isProcessingAlert = useRef(false);
  const alertQueue = useRef<Obstacle[]>([]);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const lastForegroundTimeRef = useRef<number>(Date.now());
  const bearingHistory = useRef<number[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    obstaclesRef.current = obstacles;
  }, [obstacles]);

  // AppState listener — пересчёт при возврате из фона
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      appStateRef.current = next;
      if (next === 'active') {
        lastForegroundTimeRef.current = Date.now();
      }
    });
    return () => subscription.remove();
  }, []);

  // Загрузка препятствий каждые 30 секунд
  useEffect(() => {
    if (!isTracking || !currentLocation) {
      setObstacles([]);
      setClosestObstacle(null);
      lastAlertedObstacles.current.clear();
      alertedObstaclesForReaction.current.clear();
      lastPositionRef.current = null;
      alertQueue.current = [];
      isProcessingAlert.current = false;
      return;
    }

    const fetchObstacles = async () => {
      try {
        const lat = currentLocation.coords.latitude;
        const lon = currentLocation.coords.longitude;

        let nearbyObstacles: Obstacle[];

        const trail = gpsTrailRef?.current || [];
        if (trail.length >= 2) {
          nearbyObstacles = await obstacleService.fetchObstaclesAlongRoute(
            trail, lat, lon, 5000, 3
          );
        } else {
          nearbyObstacles = await obstacleService.fetchNearbyObstacles(
            lat, lon, 5000, 3
          );
        }

        setObstacles(nearbyObstacles);

        const closest = obstacleService.getClosestObstacle(nearbyObstacles);
        setClosestObstacle(closest);

        checkForAlerts(nearbyObstacles);
      } catch (error) {
        console.error('Error fetching obstacles:', error);
      }
    };

    fetchObstacles();
    fetchInterval.current = setInterval(fetchObstacles, 30000);

    return () => {
      if (fetchInterval.current) {
        clearInterval(fetchInterval.current);
      }
    };
  }, [isTracking, currentLocation?.coords?.latitude, currentLocation?.coords?.longitude]);

  // Сглаживание bearing (скользящее среднее по 5 последним значениям)
  const smoothBearing = (rawBearing: number): number => {
    const history = bearingHistory.current;
    history.push(rawBearing);
    if (history.length > 5) history.shift();
    const sum = history.reduce((a, b) => a + b, 0);
    return sum / history.length;
  };

  // Обновление расстояний в реальном времени
  useEffect(() => {
    if (!isTracking || obstaclesRef.current.length === 0) {
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
          effectiveBearing = smoothBearing(rawHeading);
        } else if (lastPositionRef.current) {
          const calcBearing = obstacleService.calculateBearing(
            lastPositionRef.current.lat,
            lastPositionRef.current.lon,
            lat,
            lon
          );
          effectiveBearing = smoothBearing(calcBearing);
        }
        lastPositionRef.current = { lat, lon };

        const passedDistance = obstacleService.getPassedDistance();

        const currentList = obstaclesRef.current;
        const updated = currentList
          .map(obstacle => {
            const result = obstacleService.getRelevantDistance(
              lat,
              lon,
              effectiveBearing,
              obstacle.latitude,
              obstacle.longitude
            );

            if (result === null) {
              obstacleService.markAsPassed(obstacle.id);
              return { ...obstacle, distance: 999999, sector: 'behind' as ObstacleSector };
            }

            const displayDistance = obstacle.road_distance ?? result.distance;
            if (displayDistance < passedDistance) {
              obstacleService.markAsPassed(obstacle.id);
              return { ...obstacle, distance: 999999, sector: 'behind' as ObstacleSector };
            }

            return {
              ...obstacle,
              distance: displayDistance,
              sector: result.sector,
            };
          })
          .filter(o => o.distance < 999999);

        setObstacles(updated);
        const closest = obstacleService.getClosestObstacle(updated);
        setClosestObstacle(closest);
      } catch (error) {
        console.error('Error updating distances:', error);
      }
    };

    const speedKmh = currentSpeed;
    let updateInterval: number;
    if (speedKmh < 20) updateInterval = 700;
    else if (speedKmh < 40) updateInterval = 350;
    else if (speedKmh < 60) updateInterval = 200;
    else if (speedKmh < 80) updateInterval = 150;
    else updateInterval = 100;

    updateDistances();
    const distanceUpdateInterval = setInterval(updateDistances, updateInterval);
    return () => clearInterval(distanceUpdateInterval);
  }, [isTracking, currentLocation?.coords?.latitude, currentLocation?.coords?.longitude, currentLocation?.coords?.heading, currentSpeed]);

  // Обработчик очереди оповещений (строго последовательно)
  const processAlertQueue = async () => {
    if (isProcessingAlert.current || alertQueue.current.length === 0) return;
    if (!mountedRef.current) return;

    isProcessingAlert.current = true;

    const queueItem = alertQueue.current.shift()!;
    const currentObstacle = obstaclesRef.current.find(o => o.id === queueItem.id) || queueItem;

    try {
      const speed = currentSpeedRef.current;
      const settings = dynamicAudioService.getSettings();
      const displayDistance = currentObstacle.road_distance ?? currentObstacle.distance;

      if (displayDistance < settings.minDistance || displayDistance > settings.maxDistance) {
        isProcessingAlert.current = false;
        processAlertQueue();
        return;
      }

      lastAlertedObstacles.current.add(currentObstacle.id);

      const alertText = alertSettingsService.getAlertText(currentObstacle.type, displayDistance);
      await dynamicAudioService.announceObstacleWithText(currentObstacle, alertText);

      alertedObstaclesForReaction.current.set(currentObstacle.id, {
        obstacle: currentObstacle,
        alerted: true,
      });

      setTimeout(() => {
        lastAlertedObstacles.current.delete(currentObstacle.id);
        dynamicAudioService.clearActiveObstacle();
        alertedObstaclesForReaction.current.delete(currentObstacle.id);
      }, 60000);

      const speedCheck = alertSettingsService.checkSpeedAlert(currentObstacle.type, speed);
      if (alertSettingsService.shouldUseSiren(speedCheck.alertLevel)) {
        const sirenFrequency = alertSettingsService.getSirenFrequency(speedCheck.speedExcess, displayDistance);
        await dynamicAudioService.alertDynamicWithFrequency(currentObstacle, speed, sirenFrequency);
      }

      checkDriverReaction(currentObstacle);
    } catch (error) {
      console.error('Alert processing error:', error);
    }

    isProcessingAlert.current = false;
    processAlertQueue();
  };

  // Проверка и постановка в очередь
  const checkForAlerts = async (obstacleList: Obstacle[]) => {
    const settings = dynamicAudioService.getSettings();
    const speed = currentSpeedRef.current;

    const sorted = [...obstacleList]
      .filter(o => {
        const d = o.road_distance ?? o.distance;
        return d >= settings.minDistance && d <= settings.maxDistance;
      })
      .filter(o => !lastAlertedObstacles.current.has(o.id))
      .sort((a, b) => {
        const da = a.road_distance ?? a.distance;
        const db = b.road_distance ?? b.distance;
        return da - db;
      });

    if (sorted.length === 0) return;

    for (const obstacle of sorted) {
      if (!lastAlertedObstacles.current.has(obstacle.id)) {
        alertQueue.current.push(obstacle);
      }
    }

    processAlertQueue();
  };

  const checkDriverReaction = async (obstacle: Obstacle) => {
    const alertData = alertedObstaclesForReaction.current.get(obstacle.id);
    if (!alertData || !alertData.alerted) return;

    const speedDelta = previousSpeed.current - currentSpeedRef.current;

    if (speedDelta > 5) {
      await obstacleService.recordDriverReaction(obstacle, 'confirmed');
      alertedObstaclesForReaction.current.delete(obstacle.id);
    } else if (obstacle.distance < 50) {
      await obstacleService.recordDriverReaction(obstacle, 'ignored');
      alertedObstaclesForReaction.current.delete(obstacle.id);
      obstacleService.markAsPassed(obstacle.id);
    }
  };

  useEffect(() => {
    previousSpeed.current = currentSpeedRef.current;
    currentSpeedRef.current = currentSpeed;
  }, [currentSpeed]);

  useEffect(() => {
    if (!isTracking) {
      lastPositionRef.current = null;
      dynamicAudioService.clearActiveObstacle();
      obstacleService.clearPassedObstacles();
      lastAlertedObstacles.current.clear();
      alertedObstaclesForReaction.current.clear();
      alertQueue.current = [];
      isProcessingAlert.current = false;
      bearingHistory.current = [];
      setObstacles([]);
      setClosestObstacle(null);
    }
  }, [isTracking]);

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
      console.error('Error refetching obstacles:', error);
    }
  };

  return {
    obstacles,
    closestObstacle,
    obstaclesCount: obstacles.length,
    isNearObstacle: !!closestObstacle,
    refetchObstacles,
  };
}
