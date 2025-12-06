/**
 * ObstacleWarningOverlay - Плавающее визуальное предупреждение о препятствиях
 * 
 * Отображается поверх всех элементов
 * Показывает расстояние и тип препятствия с цветовой индикацией
 */

import React, { useEffect, useState } from 'react';
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

          {/* Расстояние - большое и заметное */}
          <View style={styles.distanceContainer}>
            <Text style={[styles.distanceNumber, { color: colors.text }]}>
              {Math.round(obstacle.distance)}
            </Text>
            <Text style={[styles.distanceUnit, { color: colors.text }]}>м</Text>
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

      {/* Индикатор расстояния (прогресс бар) */}
      <View style={styles.progressContainer}>
        <View 
          style={[
            styles.progressBar, 
            { 
              backgroundColor: colors.bg,
              width: `${Math.max(10, Math.min(100, (1000 - obstacle.distance) / 10))}%`
            }
          ]} 
        />
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
    height: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 4,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
});
