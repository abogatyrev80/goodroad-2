import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTracking } from '../hooks/useTracking';
import { useAutoStart } from '../hooks/useAutoStart';
import { useObstacleAlerts } from '../hooks/useObstacleAlerts';
import ObstacleWarningOverlay, { WarningSize, WarningPosition } from '../components/ObstacleWarningOverlay';
import alertSettingsService from '../services/AlertSettingsService';
import SimpleToast from '../components/SimpleToast';

export default function HomeScreen() {
  const {
    isTracking,
    isLoading,
    currentLocation,
    currentSpeed,
    currentLocationRef,
    startTracking,
    stopTracking,
    toggleTracking,
    initializeServices,
    reportObstacle,
  } = useTracking();

  const { autostartMode } = useAutoStart({ startTracking, stopTracking, isTracking });

  const [warningSize, setWarningSize] = useState<WarningSize>('medium');
  const [warningPosition, setWarningPosition] = useState<WarningPosition>('top');
  const [simulateWarningOverlay, setSimulateWarningOverlay] = useState(false);

  const { obstacles, closestObstacle, refetchObstacles } = useObstacleAlerts(
    isTracking,
    currentLocation,
    currentSpeed,
    currentLocationRef
  );
  const obstaclesCount = obstacles.length;

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    initializeServices();
    alertSettingsService.initialize();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!cancelled) {
          await loadWarningSettings();
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  const loadWarningSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem('warning_settings');
      if (saved) {
        const settings = JSON.parse(saved);
        const validSizes: WarningSize[] = ['small', 'medium', 'large'];
        const validPositions: WarningPosition[] = ['top', 'center', 'bottom'];
        setWarningSize(validSizes.includes(settings.size) ? settings.size : 'medium');
        setWarningPosition(validPositions.includes(settings.position) ? settings.position : 'top');
      }
    } catch (error) {
      console.error('Error loading warning settings:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />

      <ObstacleWarningOverlay
        obstacle={
          simulateWarningOverlay
            ? {
                id: 'sim',
                type: 'pothole',
                latitude: 0,
                longitude: 0,
                distance: 120,
                severity: { average: 0.7, max: 1 },
                confidence: 0.9,
                confirmations: 5,
                avgSpeed: 40,
                lastReported: new Date().toISOString(),
                priority: 1,
              }
            : closestObstacle
        }
        visible={
          simulateWarningOverlay ||
          (isTracking &&
            closestObstacle !== null &&
            closestObstacle.distance < 1000 &&
            closestObstacle.distance >= 50 &&
            currentSpeed > 1)
        }
        size={warningSize}
        position={warningPosition}
      />

      <View style={styles.header}>
        <Text style={styles.title}>GOOD ROAD</Text>
        <Text style={styles.subtitle}>Мониторинг качества дорог</Text>
        {typeof __DEV__ !== 'undefined' && __DEV__ && (
          <Pressable
            style={({ pressed }) => [
              styles.simulateWarningBtn,
              pressed && styles.simulateWarningBtnPressed,
              simulateWarningOverlay && styles.simulateWarningBtnActive,
            ]}
            onPress={() => setSimulateWarningOverlay((v) => !v)}
          >
            <Text style={styles.simulateWarningBtnText}>
              {simulateWarningOverlay ? 'Выкл симуляцию предупреждения' : 'Симуляция предупреждения'}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={styles.statusContainer}>
        <View style={[styles.statusBadge, isTracking && styles.statusBadgeActive]}>
          <View style={[styles.statusDot, isTracking && styles.statusDotActive]} />
          <Text style={styles.statusText}>
            {isTracking ? 'АКТИВЕН' : 'ОСТАНОВЛЕН'}
          </Text>
        </View>
        {isTracking && obstaclesCount > 0 && (
          <View style={styles.obstaclesBadge}>
            <Ionicons name="warning" size={16} color="#fbbf24" />
            <Text style={styles.obstaclesText}>{obstaclesCount} препятствий</Text>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.buttonsContainer}
        contentContainerStyle={styles.buttonsContainerContent}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={[
            styles.mainButton,
            isTracking && styles.mainButtonActive,
            isLoading && styles.buttonDisabled,
          ]}
          onPress={toggleTracking}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : (
            <>
              <Ionicons
                name={isTracking ? 'stop-circle' : 'play-circle'}
                size={48}
                color="#fff"
              />
              <Text style={styles.mainButtonText}>
                {isTracking ? 'ОСТАНОВИТЬ МОНИТОРИНГ' : 'НАЧАТЬ МОНИТОРИНГ'}
              </Text>
            </>
          )}
        </Pressable>

        {isTracking && (
          <Pressable
            style={[styles.compactButton, styles.refreshButton]}
            onPress={() => {
              refetchObstacles();
            }}
          >
            <Ionicons name="refresh" size={24} color="#fbbf24" />
            <Text style={styles.compactButtonText}>ОБНОВИТЬ</Text>
          </Pressable>
        )}

        <Pressable
          style={[styles.compactButton, styles.autostartButton]}
          onPress={() => router.push('/autostart-settings')}
        >
          <View style={styles.buttonContent}>
            <Ionicons name="flash" size={28} color="#fbbf24" />
            <View style={styles.buttonTextContainer}>
              <Text style={[styles.compactButtonText, styles.autostartButtonText]}>АВТОЗАПУСК</Text>
              <Text style={styles.buttonSubtext}>Bluetooth / CarPlay</Text>
            </View>
          </View>
        </Pressable>

        <Pressable
          style={[styles.compactButton, styles.audioSettingsButton]}
          onPress={() => router.push('/audio-settings')}
        >
          <View style={styles.buttonContent}>
            <Ionicons name="volume-high" size={28} color="#00d4ff" />
            <View style={styles.buttonTextContainer}>
              <Text style={[styles.compactButtonText, styles.audioSettingsButtonText]}>АУДИО НАСТРОЙКИ</Text>
              <Text style={styles.buttonSubtext}>Звуки, озвучка, логика</Text>
            </View>
          </View>
        </Pressable>

        <Pressable
          style={styles.compactButton}
          onPress={() => router.push('/warning-settings')}
        >
          <Ionicons name="eye" size={24} color="#00d4ff" />
          <Text style={styles.compactButtonText}>ВИЗУАЛЬНЫЕ КАРТОЧКИ</Text>
        </Pressable>

        <Pressable
          style={styles.compactButton}
          onPress={() => router.push('/data-stats')}
        >
          <Ionicons name="stats-chart" size={24} color="#00d4ff" />
          <Text style={styles.compactButtonText}>ОТПРАВКА ДАННЫХ</Text>
        </Pressable>

        <Pressable
          style={[styles.button, styles.reportButton]}
          onPress={reportObstacle}
          disabled={!currentLocation}
        >
          <Ionicons name="alert-circle" size={34} color="#ff3b30" />
          <Text style={[styles.buttonText, styles.reportButtonText]}>
            ОТМЕТИТЬ ПРЕПЯТСТВИЕ
          </Text>
        </Pressable>

        {__DEV__ && (
          <Pressable
            style={styles.button}
            onPress={() => router.push('/admin-simple')}
          >
            <Ionicons name="analytics" size={34} color="#00d4ff" />
            <Text style={styles.buttonText}>АДМИН-ПАНЕЛЬ</Text>
          </Pressable>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>GoodRoad v2.0</Text>
        </View>
      </ScrollView>

      <SimpleToast />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#1a1a3e',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#00d4ff',
    letterSpacing: 2,
    textShadowColor: 'rgba(0, 212, 255, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  subtitle: {
    fontSize: 12,
    color: '#8b94a8',
    marginTop: 4,
    fontWeight: '500',
  },
  simulateWarningBtn: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#1a1a3e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3b3b6b',
  },
  simulateWarningBtnPressed: {
    opacity: 0.8,
  },
  simulateWarningBtnActive: {
    borderColor: '#fbbf24',
    backgroundColor: '#2d2a14',
  },
  simulateWarningBtnText: {
    fontSize: 12,
    color: '#8b94a8',
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1a1a3e',
    borderWidth: 2,
    borderColor: '#2d2d5f',
    gap: 8,
  },
  statusBadgeActive: {
    borderColor: '#00ff88',
    backgroundColor: '#002211',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#6b7280',
  },
  statusDotActive: {
    backgroundColor: '#00ff88',
    shadowColor: '#00ff88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  statusText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#c7cad9',
  },
  obstaclesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 150, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 150, 0, 0.3)',
    gap: 8,
  },
  obstaclesText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ff9500',
  },
  buttonsContainer: {
    flex: 1,
  },
  buttonsContainerContent: {
    padding: 16,
    paddingBottom: 16,
    flexGrow: 1,
  },
  mainButton: {
    height: 110,
    backgroundColor: '#0066ff',
    borderRadius: 16,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
    shadowColor: '#0066ff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 12,
  },
  mainButtonActive: {
    backgroundColor: '#ff3b30',
    shadowColor: '#ff3b30',
  },
  mainButtonText: {
    fontSize: 17,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.2,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  button: {
    height: 68,
    backgroundColor: '#1a1a3e',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#00d4ff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },
  compactButton: {
    minHeight: 56,
    backgroundColor: '#1a1a3e',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#00d4ff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    marginBottom: 12,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  buttonTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#00d4ff',
    letterSpacing: 1,
  },
  compactButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#00d4ff',
    letterSpacing: 0.6,
  },
  buttonSubtext: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
  },
  autostartButton: {
    borderColor: '#fbbf24',
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    borderWidth: 3,
  },
  autostartButtonText: {
    color: '#fbbf24',
    fontSize: 16,
  },
  audioSettingsButton: {
    borderColor: '#00d4ff',
    backgroundColor: 'rgba(0, 212, 255, 0.15)',
    borderWidth: 3,
    minHeight: 70,
  },
  audioSettingsButtonText: {
    color: '#00d4ff',
    fontSize: 16,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  refreshButton: {
    borderColor: '#fbbf24',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
  },
  reportButton: {
    borderColor: '#ff3b30',
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
  },
  reportButtonText: {
    color: '#ff3b30',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a3e',
    marginTop: 8,
  },
  footerText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
});
