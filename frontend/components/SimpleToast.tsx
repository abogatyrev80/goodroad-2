/**
 * SimpleToast - Простой компонент для автоматически исчезающих уведомлений
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  text1: string;
  text2?: string;
  duration: number;
}

let toastQueue: ToastMessage[] = [];
let showToastCallback: ((message: ToastMessage) => void) | null = null;

export const showToast = (
  type: ToastType,
  text1: string,
  text2?: string,
  duration: number = 3000
) => {
  const message: ToastMessage = {
    id: Date.now().toString(),
    type,
    text1,
    text2,
    duration,
  };

  if (showToastCallback) {
    showToastCallback(message);
  }
};

interface SimpleToastProps {}

export default function SimpleToast({}: SimpleToastProps) {
  const [currentMessage, setCurrentMessage] = React.useState<ToastMessage | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(100)).current;

  useEffect(() => {
    showToastCallback = (message: ToastMessage) => {
      setCurrentMessage(message);
    };

    return () => {
      showToastCallback = null;
    };
  }, []);

  useEffect(() => {
    if (currentMessage) {
      // Анимация появления
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Автоматическое скрытие
      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: 100,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setCurrentMessage(null);
        });
      }, currentMessage.duration);

      return () => clearTimeout(timer);
    }
  }, [currentMessage]);

  if (!currentMessage) {
    return null;
  }

  const getBackgroundColor = () => {
    switch (currentMessage.type) {
      case 'success':
        return '#22c55e';
      case 'error':
        return '#ef4444';
      case 'info':
        return '#3b82f6';
    }
  };

  const getIcon = () => {
    switch (currentMessage.type) {
      case 'success':
        return 'checkmark-circle';
      case 'error':
        return 'close-circle';
      case 'info':
        return 'information-circle';
    }
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: getBackgroundColor(),
          opacity: fadeAnim,
          transform: [{ translateY }],
        },
      ]}
    >
      <Ionicons name={getIcon()} size={24} color="#fff" style={styles.icon} />
      <View style={styles.textContainer}>
        <Text style={styles.text1}>{currentMessage.text1}</Text>
        {currentMessage.text2 && (
          <Text style={styles.text2}>{currentMessage.text2}</Text>
        )}
      </View>
    </Animated.View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    maxWidth: width - 32,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 9999,
  },
  icon: {
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  text1: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 2,
  },
  text2: {
    fontSize: 14,
    color: '#fff',
    opacity: 0.9,
  },
});

// Добавляем View для исправления типов
const View = require('react-native').View;
