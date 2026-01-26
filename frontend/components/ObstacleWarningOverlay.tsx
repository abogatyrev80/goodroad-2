/**
 * ObstacleWarningOverlay - Плавающее визуальное предупреждение о препятствиях
 * 
 * Отображается поверх всех элементов
 * Показывает расстояние и тип препятствия с цветовой индикацией
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
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
  const [pulseAnim] = useState(new Animated.Value(1));
  const [fadeAnim] = useState(new Animated.Value(0));
  const [displayedDistance, setDisplayedDistance] = useState(0); // 🆕 Плавное отображение расстояния
  const [progressAnim] = useState(new Animated.Value(0)); // 🆕 Анимация прогресс-бара
  const progressContainerWidth = useRef<number>(0); // 🆕 Ширина контейнера прогресс-бара

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

  // 🆕 ПЛАВНАЯ ИНТЕРПОЛЯЦИЯ РАССТОЯНИЯ
  useEffect(() => {
    if (!obstacle) {
      setDisplayedDistance(0);
      return;
    }
    
    const targetDistance = obstacle.distance;
    const currentDistance = displayedDistance || targetDistance;
    
    // Если расстояние изменилось значительно, плавно интерполируем
    if (Math.abs(targetDistance - currentDistance) > 2) {
      // Используем анимацию для плавного перехода
      const animValue = new Animated.Value(currentDistance);
      
      Animated.timing(animValue, {
        toValue: targetDistance,
        duration: 150, // Быстрая анимация для отзывчивости
        useNativeDriver: false, // Нужен для изменения значения
      }).start();
      
      // Обновляем отображаемое значение
      const listener = animValue.addListener(({ value }) => {
        setDisplayedDistance(Math.round(value));
      });
      
      return () => {
        animValue.removeListener(listener);
        animValue.stopAnimation();
      };
    } else {
      // Небольшое изменение - обновляем сразу
      setDisplayedDistance(Math.round(targetDistance));
    }
  }, [obstacle?.distance]);

  useEffect(() => {
    if (visible && obstacle) {
      // Fade in
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();

      // Пульсация для критичных препятствий
      if (obstacle.distance < 300) {
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.1,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 500,
              useNativeDriver: true,
            }),
          ])
        ).start();
      }
    } else {
      // Fade out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, obstacle]);

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

  // 🆕 УЛУЧШЕННЫЙ РАСЧЕТ ПРОГРЕССА с учетом типа препятствия и расстояния
  const getProgressPercentage = (obstacle: Obstacle): number => {
    const distance = obstacle.distance;
    
    // Определяем максимальное расстояние предупреждения в зависимости от типа
    // Более опасные препятствия показываются дальше
    const maxWarningDistance: Record<string, number> = {
      accident: 1000,      // Авария - очень далеко
      braking: 800,        // Торможение - далеко
      pothole: 600,        // Яма - среднее
      speed_bump: 500,     // Лежачий полицейский - среднее
      bump: 500,           // Неровность - среднее
      vibration: 400,      // Вибрация - близко
    };
    
    const maxDistance = maxWarningDistance[obstacle.type] || 600;
    const minDistance = 0; // При 0 метрах = 100%
    
    // Обратная пропорция: чем ближе, тем больше заполнение
    // Формула: процент = (maxDistance - distance) / maxDistance * 100
    const percentage = Math.max(0, Math.min(100, ((maxDistance - distance) / maxDistance) * 100));
    
    // Учитываем подтверждения - больше подтверждений = более заметный прогресс
    const confirmationsMultiplier = Math.min(1.2, 1 + (obstacle.confirmations - 1) * 0.1);
    const adjustedPercentage = Math.min(100, percentage * confirmationsMultiplier);
    
    return Math.round(adjustedPercentage);
  };

  // 🆕 АНИМАЦИЯ ПРОГРЕСС-БАРА
  useEffect(() => {
    if (!obstacle) {
      progressAnim.setValue(0);
      return;
    }
    
    const targetProgress = getProgressPercentage(obstacle);
    
    Animated.timing(progressAnim, {
      toValue: targetProgress,
      duration: 200, // Плавное заполнение
      useNativeDriver: false, // Нужен для изменения width
    }).start();
  }, [obstacle?.distance, obstacle?.type, obstacle?.confirmations]);

  return (
    <Animated.View
      style={[
        styles.overlay,
        currentPosition,
        {
          opacity: fadeAnim,
          transform: [{ scale: pulseAnim }],
        },
      ]}
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

      {/* 🆕 УЛУЧШЕННЫЙ ИНДИКАТОР РАССТОЯНИЯ (прогресс бар с учетом типа препятствия) */}
      <View 
        style={styles.progressContainer}
        onLayout={(event) => {
          progressContainerWidth.current = event.nativeEvent.layout.width;
        }}
      >
        <Animated.View 
          style={[
            styles.progressBar, 
            { 
              backgroundColor: colors.bg,
              width: progressAnim.interpolate({
                inputRange: [0, 100],
                outputRange: [0, progressContainerWidth.current || Dimensions.get('window').width - 32],
              }),
            }
          ]} 
        />
        {/* 🆕 Визуальные метки на шкале */}
        <View style={styles.progressMarkers}>
          <View style={[styles.marker, styles.marker25]} />
          <View style={[styles.marker, styles.marker50]} />
          <View style={[styles.marker, styles.marker75]} />
        </View>
      </View>
    </Animated.View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 100,
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 10,
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
