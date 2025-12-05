/**
 * ObstacleAlert - Интерактивное оповещение о препятствии
 * 
 * Особенности:
 * - Адаптируется под реакцию водителя
 * - Разные уровни срочности
 * - Вибрация и звук для критичных
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Vibration, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Obstacle } from '../services/ObstacleService';

interface ObstacleAlertProps {
  obstacle: Obstacle;
  onConfirm: () => void;
  onDismiss: () => void;
  onIgnore: () => void;
}

export default function ObstacleAlert({
  obstacle,
  onConfirm,
  onDismiss,
  onIgnore,
}: ObstacleAlertProps) {
  const scaleAnim = new Animated.Value(0);

  useEffect(() => {
    // Анимация появления
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 5,
      useNativeDriver: true,
    }).start();

    // Вибрация для критичных препятствий
    if (obstacle.distance < 300 && obstacle.severity.max <= 2) {
      Vibration.vibrate([0, 200, 100, 200]);
    }

    // Автозакрытие через 10 секунд (считается ignored)
    const timeout = setTimeout(() => {
      onIgnore();
    }, 10000);

    return () => clearTimeout(timeout);
  }, [obstacle.id]);

  const getIcon = (): string => {
    const icons: Record<string, string> = {
      pothole: 'warning',
      speed_bump: 'triangle',
      bump: 'warning-outline',
      braking: 'alert-circle',
      vibration: 'pulse',
      accident: 'alert',
    };
    return icons[obstacle.type] || 'information-circle';
  };

  const getTitle = (): string => {
    const titles: Record<string, string> = {
      pothole: 'Яма впереди',
      speed_bump: 'Лежачий полицейский',
      bump: 'Неровность',
      braking: 'Требуется торможение',
      vibration: 'Неровная дорога',
      accident: 'Авария',
    };
    return titles[obstacle.type] || 'Препятствие';
  };

  const getSeverityColor = (): string => {
    if (obstacle.severity.max <= 2) return '#dc2626'; // Критично
    if (obstacle.severity.max <= 3) return '#f59e0b'; // Средне
    return '#22c55e'; // Низко
  };

  const getUrgencyLevel = (): 'high' | 'medium' | 'low' => {
    if (obstacle.distance < 200 && obstacle.confirmations >= 3) return 'high';
    if (obstacle.distance < 500 && obstacle.confirmations >= 2) return 'medium';
    return 'low';
  };

  const urgency = getUrgencyLevel();
  const severityColor = getSeverityColor();

  return (
    <Animated.View
      style={[
        styles.container,
        { transform: [{ scale: scaleAnim }] },
        urgency === 'high' && styles.highUrgency,
      ]}
    >
      <View style={[styles.header, { backgroundColor: severityColor }]}>
        <Ionicons name={getIcon() as any} size={24} color="#fff" />
        <View style={styles.headerText}>
          <Text style={styles.title}>{getTitle()}</Text>
          <Text style={styles.distance}>{Math.round(obstacle.distance)}м впереди</Text>
        </View>
        <Pressable onPress={onDismiss} style={styles.closeButton}>
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Ionicons name="checkmark-done" size={16} color="#60a5fa" />
            <Text style={styles.infoLabel}>Подтверждений</Text>
            <Text style={styles.infoValue}>{obstacle.confirmations}</Text>
          </View>

          <View style={styles.infoItem}>
            <Ionicons name="speedometer" size={16} color="#60a5fa" />
            <Text style={styles.infoLabel}>Средняя скорость</Text>
            <Text style={styles.infoValue}>{Math.round(obstacle.avgSpeed)} км/ч</Text>
          </View>

          <View style={styles.infoItem}>
            <Ionicons name="stats-chart" size={16} color="#60a5fa" />
            <Text style={styles.infoLabel}>Уверенность</Text>
            <Text style={styles.infoValue}>{Math.round(obstacle.confidence * 100)}%</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.actionButton, styles.confirmButton]}
            onPress={onConfirm}
          >
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.actionText}>Подтвердить</Text>
          </Pressable>

          <Pressable
            style={[styles.actionButton, styles.dismissButton]}
            onPress={onDismiss}
          >
            <Ionicons name="close-circle" size={20} color="#fff" />
            <Text style={styles.actionText}>Ложное</Text>
          </Pressable>
        </View>

        {urgency === 'high' && (
          <Text style={styles.urgentNote}>
            ⚠️ Снизьте скорость! Множественные подтверждения
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 100,
    left: 16,
    right: 16,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    zIndex: 1000,
  },
  highUrgency: {
    borderWidth: 3,
    borderColor: '#dc2626',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  distance: {
    fontSize: 14,
    color: '#e2e8f0',
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  body: {
    padding: 16,
    backgroundColor: '#0f172a',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  infoItem: {
    alignItems: 'center',
    gap: 4,
  },
  infoLabel: {
    fontSize: 10,
    color: '#94a3b8',
    textAlign: 'center',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#e2e8f0',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  confirmButton: {
    backgroundColor: '#22c55e',
  },
  dismissButton: {
    backgroundColor: '#64748b',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  urgentNote: {
    marginTop: 12,
    fontSize: 12,
    color: '#fbbf24',
    textAlign: 'center',
    fontWeight: '600',
  },
});
