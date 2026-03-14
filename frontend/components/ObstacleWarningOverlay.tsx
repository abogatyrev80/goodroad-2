/**
 * ObstacleWarningOverlay - Плавающее визуальное предупреждение о препятствиях
 * 
 * Отображается поверх всех элементов
 * Показывает расстояние и тип препятствия с цветовой индикацией
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Obstacle } from '../services/ObstacleService';

export type WarningSize = 'small' | 'medium' | 'large';
export type WarningPosition = 'top' | 'center' | 'bottom';

interface ObstacleWarningOverlayProps {
  obstacle: Obstacle | null;
  visible: boolean;
  size?: WarningSize;
  position?: WarningPosition;
}

export default function ObstacleWarningOverlay({
  obstacle,
  visible,
  size = 'medium',
  position = 'top',
}: ObstacleWarningOverlayProps) {
  const [displayedDistance, setDisplayedDistance] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0); // Процент для прогресс-бара (без interpolate — избегаем чёрного экрана)
  const [progressAnim] = useState(new Animated.Value(0));
  const mountedRef = useRef(true);

  // Размеры в зависимости от настройки
  const sizeConfig = {
    small: { icon: 28, distance: 32, padding: 12, iconBg: 50 },
    medium: { icon: 40, distance: 48, padding: 16, iconBg: 70 },
    large: { icon: 52, distance: 64, padding: 20, iconBg: 90 },
  };

  // Позиция в зависимости от настройки
  const positionStyle = {
    top: { top: 100 },
    center: { top: '40%' as any },
    bottom: { bottom: 150 },
  };

  const currentSize = sizeConfig[size];
  const currentPosition = positionStyle[position];

  // Отслеживание монтирования (чтобы не вызывать setState после unmount)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Быстрая реакция расстояния: при заметном изменении — сразу, иначе короткая анимация (частота обновлений задаётся в useObstacleAlerts)
  useEffect(() => {
    if (!obstacle) {
      if (mountedRef.current) setDisplayedDistance(0);
      return;
    }
    const targetDistance = obstacle.distance;
    const currentDistance = displayedDistance || targetDistance;
    const diff = Math.abs(targetDistance - currentDistance);

    // Сразу показываем при смене >5 м или при расхождении ≤1 м (чтобы не тянуть анимацию)
    if (diff > 5 || diff <= 1) {
      if (mountedRef.current) setDisplayedDistance(Math.round(targetDistance));
      return;
    }
    const animValue = new Animated.Value(currentDistance);
    Animated.timing(animValue, {
      toValue: targetDistance,
      duration: 40,
      useNativeDriver: false,
    }).start();
    const listener = animValue.addListener(({ value }) => {
      if (mountedRef.current) setDisplayedDistance(Math.round(value));
    });
    return () => {
      animValue.removeListener(listener);
      animValue.stopAnimation();
    };
  }, [obstacle?.distance]);

  // УЛУЧШЕННЫЙ РАСЧЕТ ПРОГРЕССА — объявление функции до любого return (для использования в useEffect)
  const getProgressPercentage = (obst: Obstacle): number => {
    const distance = obst.distance;
    const maxWarningDistance: Record<string, number> = {
      accident: 1000, braking: 800, pothole: 600, speed_bump: 500, bump: 500, vibration: 400,
    };
    const maxDistance = maxWarningDistance[obst.type] || 600;
    const percentage = Math.max(0, Math.min(100, ((maxDistance - distance) / maxDistance) * 100));
    const confirmationsMultiplier = Math.min(1.2, 1 + (obst.confirmations - 1) * 0.1);
    return Math.round(Math.min(100, percentage * confirmationsMultiplier));
  };

  // Анимация прогресс-бара — ВСЕГДА вызываем один и тот же набор хуков (до любого return)
  useEffect(() => {
    if (!obstacle) {
      progressAnim.setValue(0);
      if (mountedRef.current) setProgressPercent(0);
      return;
    }
    const targetProgress = getProgressPercentage(obstacle);
    Animated.timing(progressAnim, {
      toValue: targetProgress,
      duration: 100,
      useNativeDriver: false,
    }).start();
  }, [obstacle?.distance, obstacle?.type, obstacle?.confirmations]);

  useEffect(() => {
    const listener = progressAnim.addListener(({ value }) => {
      if (mountedRef.current) setProgressPercent(Math.round(value));
    });
    return () => progressAnim.removeListener(listener);
  }, []);

  if (!visible || !obstacle) {
    return null;
  }

  const getUrgencyLevel = (): 'critical' | 'warning' | 'caution' => {
    const distance = obstacle.distance;
    const confirmations = obstacle.confirmations;

    if (distance < 200 && confirmations >= 3) return 'critical';
    if (distance < 400) return 'warning';
    return 'caution';
  };

  const getColors = () => {
    const urgency = getUrgencyLevel();
    
    switch (urgency) {
      case 'critical':
        return {
          bg: '#dc2626',
          border: '#b91c1c',
          text: '#fff',
          icon: '#fef2f2',
        };
      case 'warning':
        return {
          bg: '#f59e0b',
          border: '#d97706',
          text: '#fff',
          icon: '#fffbeb',
        };
      case 'caution':
        return {
          bg: '#3b82f6',
          border: '#2563eb',
          text: '#fff',
          icon: '#eff6ff',
        };
    }
  };

  const getObstacleIcon = (): string => {
    const icons: Record<string, string> = {
      pothole: 'alert-circle',
      speed_bump: 'warning',
      bump: 'warning-outline',
      braking: 'alert',
      vibration: 'pulse',
      accident: 'alert-circle',
    };
    return icons[obstacle.type] || 'information-circle';
  };

  const getObstacleName = (): string => {
    const names: Record<string, string> = {
      pothole: 'ЯМА',
      speed_bump: 'ЛЕЖАЧИЙ ПОЛИЦЕЙСКИЙ',
      bump: 'НЕРОВНОСТЬ',
      braking: 'ТОРМОЖЕНИЕ',
      vibration: 'НЕРОВНАЯ ДОРОГА',
      accident: 'АВАРИЯ',
    };
    return names[obstacle.type] || 'ПРЕПЯТСТВИЕ';
  };

  const colors = getColors();
  const urgency = getUrgencyLevel();

  // Корень — обычный View без анимации, чтобы исключить чёрный экран от Animated.View на нативном слое
  return (
    <View
      style={[
        styles.overlay,
        currentPosition,
      ]}
      collapsable={false}
      pointerEvents="box-none"
    >
      <View style={[
        styles.container, 
        { 
          backgroundColor: colors.bg, 
          borderColor: colors.border,
          padding: currentSize.padding,
        }
      ]}>
        {/* Иконка */}
        <View style={[
          styles.iconContainer, 
          { 
            backgroundColor: colors.icon,
            width: currentSize.iconBg,
            height: currentSize.iconBg,
            borderRadius: currentSize.iconBg / 2,
          }
        ]}>
          <Ionicons name={getObstacleIcon() as any} size={currentSize.icon} color={colors.bg} />
        </View>

        {/* Информация */}
        <View style={styles.infoContainer}>
          <Text style={[styles.obstacleName, { color: colors.text }]}>
            {getObstacleName()}
          </Text>

          {/* Расстояние - большое и заметное с плавной интерполяцией */}
          <View style={styles.distanceContainer}>
            <Text style={[styles.distanceNumber, { color: colors.text, fontSize: currentSize.distance }]}>
              {displayedDistance || Math.round(obstacle.distance)}
            </Text>
            <Text style={[styles.distanceUnit, { color: colors.text, fontSize: currentSize.distance * 0.5 }]}>м</Text>
          </View>

          {/* Подтверждения */}
          {obstacle.confirmations > 1 && (
            <View style={styles.confirmationsContainer}>
              <Ionicons name="checkmark-done" size={16} color={colors.text} />
              <Text style={[styles.confirmationsText, { color: colors.text }]}>
                {obstacle.confirmations} подтвержд.
              </Text>
            </View>
          )}

          {/* Уровень срочности */}
          {urgency === 'critical' && (
            <View style={styles.urgencyBadge}>
              <Text style={styles.urgencyText}>⚠️ СНИЗЬТЕ СКОРОСТЬ!</Text>
            </View>
          )}
        </View>
      </View>

      {/* Индикатор расстояния: ширина в % без interpolate, чтобы избежать чёрного экрана на мобильном */}
      <View style={styles.progressContainer}>
        <View
          style={[
            styles.progressBar,
            {
              backgroundColor: colors.bg,
              width: `${Math.max(0, Math.min(100, progressPercent))}%`,
            },
          ]}
        />
        <View style={styles.progressMarkers}>
          <View style={[styles.marker, styles.marker25]} />
          <View style={[styles.marker, styles.marker50]} />
          <View style={[styles.marker, styles.marker75]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 100,
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 10,
    // Явно прозрачный фон — на части устройств Animated.View с useNativeDriver без фона даёт чёрный экран
    backgroundColor: 'transparent',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 20,
    borderWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 16,
  },
  iconContainer: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  infoContainer: {
    flex: 1,
  },
  obstacleName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  distanceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  distanceNumber: {
    fontSize: 48,
    fontWeight: 'bold',
    lineHeight: 48,
  },
  distanceUnit: {
    fontSize: 24,
    fontWeight: '600',
    marginLeft: 4,
  },
  confirmationsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  confirmationsText: {
    fontSize: 14,
    fontWeight: '600',
  },
  urgencyBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  urgencyText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  progressContainer: {
    height: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderRadius: 5,
    marginTop: 12,
    overflow: 'visible',
    position: 'relative',
  },
  progressBar: {
    height: '100%',
    borderRadius: 5,
  },
  progressMarkers: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    pointerEvents: 'none',
  },
  marker: {
    position: 'absolute',
    width: 2,
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    top: 0,
  },
  marker25: {
    left: '25%',
  },
  marker50: {
    left: '50%',
  },
  marker75: {
    left: '75%',
  },
});
