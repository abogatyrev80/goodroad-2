/**
 * WarningAlert.tsx
 * 
 * Компонент для отображения предупреждений от сервера
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import type { Warning } from '../services/RawDataCollector';

// Условный импорт Audio для web совместимости
let Audio: any = null;
if (Platform.OS !== 'web') {
  try {
    const ExpoAV = require('expo-av');
    Audio = ExpoAV.Audio;
  } catch (error) {
    console.warn('⚠️ expo-av not available:', error);
  }
}

interface WarningAlertProps {
  warning: Warning;
  onDismiss: (warningId: string) => void;
}

const WarningAlert: React.FC<WarningAlertProps> = ({ warning, onDismiss }) => {
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(-100)).current;
  
  useEffect(() => {
    // Анимация появления
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
    
    // Проигрываем звук
    playWarningSound(warning.severity);
    
    // Автоматически скрываем через 5 секунд
    const timer = setTimeout(() => {
      handleDismiss();
    }, 5000);
    
    return () => clearTimeout(timer);
  }, []);
  
  const playWarningSound = async (severity: number) => {
    if (!Audio || Platform.OS === 'web') {
      return;
    }
    
    try {
      // Используем существующие звуки в зависимости от уровня опасности
      let soundFile;
      if (severity <= 1) {
        // Критическое - используем emergency
        soundFile = require('../assets/sounds/emergency.mp3');
      } else if (severity <= 2) {
        // Высокое - используем critical
        soundFile = require('../assets/sounds/critical.mp3');
      } else if (severity <= 3) {
        // Среднее - используем warning
        soundFile = require('../assets/sounds/warning.mp3');
      } else {
        // Низкое - используем info
        soundFile = require('../assets/sounds/info.mp3');
      }
      
      const { sound } = await Audio.Sound.createAsync(soundFile);
      await sound.playAsync();
    } catch (error) {
      console.error('Ошибка воспроизведения звука:', error);
    }
  };
  
  const handleDismiss = () => {
    // Анимация исчезновения
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss(warning.id);
    });
  };
  
  const getSeverityColor = (severity: number) => {
    switch (severity) {
      case 1:
        return '#FF0000'; // Критическое - красный
      case 2:
        return '#FF6B00'; // Высокое - оранжевый
      case 3:
        return '#FFB800'; // Среднее - желтый
      default:
        return '#4CAF50'; // Низкое - зеленый
    }
  };
  
  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'pothole':
        return '🕳️';
      case 'braking':
        return '🚨';
      case 'bump':
        return '⚠️';
      case 'vibration':
        return '〰️';
      default:
        return '⚠️';
    }
  };
  
  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
          borderLeftColor: getSeverityColor(warning.severity),
        },
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.icon}>{getEventIcon(warning.eventType)}</Text>
        <View style={styles.textContainer}>
          <Text style={styles.message}>{warning.message}</Text>
          <Text style={styles.distance}>
            Расстояние: {Math.round(warning.distance)}м
          </Text>
        </View>
        <TouchableOpacity onPress={handleDismiss} style={styles.dismissButton}>
          <Text style={styles.dismissText}>✕</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    borderLeftWidth: 4,
    marginHorizontal: 16,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  icon: {
    fontSize: 32,
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  message: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  distance: {
    color: '#AAAAAA',
    fontSize: 14,
  },
  dismissButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  dismissText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default WarningAlert;
