/**
 * ObstacleWarningOverlay - Плавающее визуальное предупреждение о препятствиях
 * 
 * Отображается поверх всех элементов
 * Показывает расстояние и тип препятствия с цветовой индикацией
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';

const _debugHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
const _debugLogUrl = `http://${_debugHost}:7242/ingest/2d55966e-6eaf-4e5e-a957-213921ca07de`;
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
  const [displayedDistance, setDisplayedDistance] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0); // Процент для прогресс-бара (без interpolate — избегаем чёрного экрана)
  const [progressAnim] = useState(new Animated.Value(0));
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
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

  // Fade + пульсация, с остановкой loop при размонтировании
  useEffect(() => {
    if (visible && obstacle) {
      // #region agent log
      (()=>{const p={sessionId:'c27951',location:'ObstacleWarningOverlay.tsx:fade-start',message:'Starting fade-in useNativeDriver:true',data:{distance:obstacle.distance},hypothesisId:'H-A',timestamp:Date.now()};fetch(_debugLogUrl,{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c27951'},body:JSON.stringify(p)}).catch(()=>{});if(__DEV__)console.log('[DEBUG c27951]',p);})();
      // #endregion
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false, // true давало чёрный экран на части устройств при появлении оверлея
      }).start();

      if (obstacle.distance < 300) {
        if (pulseLoopRef.current) pulseLoopRef.current.stop();
        pulseLoopRef.current = Animated.loop(
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
        );
        pulseLoopRef.current.start();
      }
    } else {
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop();
        pulseLoopRef.current = null;
      }
      pulseAnim.setValue(1);
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false, // в паре с fade-in для единообразия и избежания артефактов
      }).start();
    }
    return () => {
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop();
        pulseLoopRef.current = null;
      }
    };
  }, [visible, obstacle]);

  // #region agent log
  if (!visible || !obstacle) {
    (()=>{const p={sessionId:'c27951',location:'ObstacleWarningOverlay.tsx:early-return',message:'Overlay returns null',data:{visible,hasObstacle:!!obstacle,reason:!visible?'not visible':!obstacle?'no obstacle':''},hypothesisId:'H-D',timestamp:Date.now()};fetch(_debugLogUrl,{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c27951'},body:JSON.stringify(p)}).catch(()=>{});if(__DEV__)console.log('[DEBUG c27951]',p);})();
    return null;
  }
  (()=>{const p={sessionId:'c27951',location:'ObstacleWarningOverlay.tsx:render',message:'Overlay rendering Animated.View',data:{visible,distance:obstacle.distance,position,size,overlayStyle:['absolute','left:16 right:16','backgroundColor:transparent']},hypothesisId:'H-A,H-C',timestamp:Date.now()};fetch(_debugLogUrl,{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c27951'},body:JSON.stringify(p)}).catch(()=>{});if(__DEV__)console.log('[DEBUG c27951]',p);})();
  // #endregion

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

  // Анимация прогресс-бара: обновляем progressPercent через listener (без interpolate — стабильно на нативе)
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
    </Animated.View>
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
