import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Switch,
  Alert,
  Vibration,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Audio } from 'expo-av';

export default function GoodRoadApp() {
  const [isTracking, setIsTracking] = useState(false);
  const [roadConditionScore, setRoadConditionScore] = useState<number>(75);
  const [audioWarnings, setAudioWarnings] = useState(true);
  const [vibrationWarnings, setVibrationWarnings] = useState(true);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    setupAudio();
    return () => {
      cleanupAudio();
    };
  }, []);

  const setupAudio = async () => {
    try {
      // Configure audio mode for alerts
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('Error setting up audio:', error);
    }
  };

  const cleanupAudio = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch (error) {
        console.error('Error cleaning up audio:', error);
      }
    }
  };

  const playWarningSound = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      // Create beep sound using data URI
      const beepSound = {
        uri: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvGUgBSuG0O/AaykEK4nS8LljIAUug8rz0LljIAUiiM7t2o0zCRvT98'
      };

      const { sound } = await Audio.Sound.createAsync(beepSound, {
        shouldPlay: true,
        volume: 1.0,
        rate: 1.0,
        positionMillis: 0,
        progressUpdateIntervalMillis: 100,
      });

      soundRef.current = sound;

      // Play multiple beeps for urgency
      for (let i = 0; i < 3; i++) {
        await sound.replayAsync();
        await new Promise(resolve => setTimeout(resolve, 200));
      }

    } catch (error) {
      console.error('Error playing warning sound:', error);
      
      // Fallback: Use Web Audio API for browsers
      if (Platform.OS === 'web') {
        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          
          oscillator.frequency.value = 800; // Frequency in Hz
          oscillator.type = 'sine';
          
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          
          oscillator.start();
          setTimeout(() => oscillator.stop(), 500);
        } catch (webAudioError) {
          console.error('Web Audio API error:', webAudioError);
        }
      }
    }
  };

  const triggerVibration = () => {
    if (vibrationWarnings && Platform.OS !== 'web') {
      // Pattern: vibrate for 200ms, pause 100ms, repeat 3 times
      Vibration.vibrate([200, 100, 200, 100, 200]);
    }
  };

  const getRoadConditionColor = (score: number) => {
    if (score >= 80) return '#4CAF50';
    if (score >= 60) return '#FF9800';
    if (score >= 40) return '#FF5722';
    return '#F44336';
  };

  const testWarning = async () => {
    // Play sound if enabled
    if (audioEnabled) {
      await playWarningSound();
    }
    
    // Trigger vibration if enabled
    triggerVibration();
    
    // Show visual alert
    Alert.alert(
      '⚠️ ПРЕДУПРЕЖДЕНИЕ',
      'Впереди препятствие - яма через 50 метров!\n\n🔊 Звуковое оповещение воспроизведено\n📳 Вибрация активирована',
      [{ text: 'OK' }]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      <View style={styles.header}>
        <Ionicons name="car-sport" size={32} color="#4CAF50" />
        <Text style={styles.title}>Good Road</Text>
        <TouchableOpacity 
          onPress={() => router.push('/settings')}
          style={styles.settingsButton}
        >
          <Ionicons name="settings" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Warning Banner */}
        <View style={styles.warningBanner}>
          <Ionicons name="warning" size={24} color="#FF5722" />
          <View style={styles.warningContent}>
            <Text style={styles.warningTitle}>Система предупреждений активна</Text>
            <Text style={styles.warningText}>Мониторинг препятствий включен</Text>
          </View>
        </View>

        {/* Road Condition Display */}
        <View style={styles.conditionCard}>
          <View style={[styles.conditionIndicator, { backgroundColor: getRoadConditionColor(roadConditionScore) }]}>
            <Text style={styles.conditionScore}>{Math.round(roadConditionScore)}</Text>
          </View>
          <View style={styles.conditionInfo}>
            <Text style={styles.conditionTitle}>Качество дороги</Text>
            <Text style={[styles.conditionText, { color: getRoadConditionColor(roadConditionScore) }]}>
              {roadConditionScore >= 80 ? 'Отличная дорога' :
               roadConditionScore >= 60 ? 'Хорошая дорога' :
               roadConditionScore >= 40 ? 'Удовлетворительная' : 'Плохая дорога'}
            </Text>
          </View>
        </View>

        {/* Tracking Control */}
        <View style={styles.controlCard}>
          <TouchableOpacity
            style={[styles.trackingButton, { backgroundColor: isTracking ? '#F44336' : '#4CAF50' }]}
            onPress={() => setIsTracking(!isTracking)}
          >
            <Ionicons 
              name={isTracking ? "stop" : "play"} 
              size={24} 
              color="white" 
            />
            <Text style={styles.buttonText}>
              {isTracking ? 'Остановить мониторинг' : 'Начать мониторинг'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Status Cards */}
        <View style={styles.statusGrid}>
          <View style={styles.statusCard}>
            <Ionicons name="location" size={24} color="#4CAF50" />
            <Text style={styles.statusTitle}>GPS</Text>
            <Text style={styles.statusValue}>Подключен</Text>
            <Text style={styles.statusSubtitle}>±15м точность</Text>
          </View>

          <View style={styles.statusCard}>
            <Ionicons name="speedometer" size={24} color="#2196F3" />
            <Text style={styles.statusTitle}>Скорость</Text>
            <Text style={styles.statusValue}>{currentSpeed} км/ч</Text>
            <Text style={styles.statusSubtitle}>Предупреждения активны</Text>
          </View>
        </View>

        {/* Audio Settings */}
        <View style={styles.quickSettingsCard}>
          <Text style={styles.settingsTitle}>🔊 Быстрые настройки</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Звуковые предупреждения</Text>
            <Switch
              value={audioEnabled}
              onValueChange={setAudioEnabled}
              thumbColor={audioEnabled ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Вибрация</Text>
            <Switch
              value={vibrationEnabled}
              onValueChange={setVibrationEnabled}
              thumbColor={vibrationEnabled ? '#4CAF50' : '#888'}
              trackColor={{ false: '#333', true: '#4CAF5050' }}
            />
          </View>
        </View>

        {/* Test Warning Button */}
        <TouchableOpacity 
          style={styles.testButton}
          onPress={testWarning}
        >
          <Ionicons name="volume-high" size={20} color="white" />
          <Text style={styles.testButtonText}>Тестовое предупреждение</Text>
        </TouchableOpacity>

        {/* Settings Navigation */}
        <TouchableOpacity 
          style={styles.settingsNavButton}
          onPress={() => router.push('/settings')}
        >
          <Ionicons name="settings-outline" size={20} color="white" />
          <Text style={styles.settingsNavText}>Подробные настройки предупреждений</Text>
          <Ionicons name="chevron-forward" size={20} color="#888" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    flex: 1,
    textAlign: 'center',
  },
  settingsButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  warningBanner: {
    backgroundColor: '#FF572220',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: '#FF5722',
  },
  warningContent: {
    flex: 1,
    marginLeft: 12,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF5722',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 14,
    color: '#FF5722',
  },
  conditionCard: {
    flexDirection: 'row',
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  conditionIndicator: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  conditionScore: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  conditionInfo: {
    flex: 1,
  },
  conditionTitle: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '600',
  },
  conditionText: {
    fontSize: 16,
    marginTop: 4,
    fontWeight: '500',
  },
  controlCard: {
    marginBottom: 16,
  },
  trackingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  statusGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statusCard: {
    flex: 0.48,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statusTitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 8,
  },
  statusValue: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
    marginTop: 4,
  },
  statusSubtitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  quickSettingsCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  settingsTitle: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  settingLabel: {
    fontSize: 14,
    color: '#ffffff',
    flex: 1,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2196F3',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  testButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  settingsNavButton: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  settingsNavText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
    marginLeft: 8,
  },
});