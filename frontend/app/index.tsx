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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Импортируем offline системы
import { syncService } from '../services/SyncService';
import { localDB, LocalWarning } from '../services/LocalDatabase';

// Импортируем типы из настроек
import { AppSettings, SoundOption } from './settings';

// Типы препятствий и предупреждений
export interface RoadHazard {
  id: string;
  type: 'pothole' | 'speed_bump' | 'road_defect' | 'pedestrian_crossing' | 'railway_crossing' | 'construction' | 'unpaved_road';
  latitude: number;
  longitude: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  distance?: number;
}

export interface WarningState {
  hazard: RoadHazard;
  distanceToHazard: number;
  timeToHazard: number;
  currentSpeed: number;
  warningLevel: 'initial' | 'caution' | 'urgent' | 'critical';
  hasUserReacted: boolean;
  initialSpeed: number;
  lastWarningTime: number;
}

const HAZARD_NAMES: Record<string, string> = {
  pothole: 'яма',
  speed_bump: 'лежачий полицейский', 
  road_defect: 'дефект покрытия',
  pedestrian_crossing: 'пешеходный переход',
  railway_crossing: 'железнодорожный переезд',
  construction: 'дорожные работы',
  unpaved_road: 'грунтовая дорога'
};

export default function GoodRoadApp() {
  // Состояние приложения
  const [isTracking, setIsTracking] = useState(false);
  const [roadConditionScore, setRoadConditionScore] = useState<number>(75);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  
  // Настройки звука
  const [appSettings, setAppSettings] = useState<Partial<AppSettings>>({});
  
  // GPS и локация данные
  const [currentLocation, setCurrentLocation] = useState<Location.LocationObject | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number>(0);
  const [satelliteCount, setSatelliteCount] = useState<number>(0);
  const [locationError, setLocationError] = useState<string | null>(null);
  
  // Offline система
  const [isOffline, setIsOffline] = useState(false);
  const [nearbyWarnings, setNearbyWarnings] = useState<LocalWarning[]>([]);
  const [closestWarning, setClosestWarning] = useState<LocalWarning | null>(null);
  const [warningDirection, setWarningDirection] = useState<number>(0); // угол в градусах
  const [warningDistance, setWarningDistance] = useState<number>(0); // дистанция в метрах
  
  // Умная система предупреждений
  const [activeWarnings, setActiveWarnings] = useState<WarningState[]>([]);
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  const [lastHazardCheck, setLastHazardCheck] = useState<number>(0);
  
  // Refs для управления ресурсами
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const warningIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setupAudio();
    requestLocationPermission();
    loadAppSettings();
    initializeOfflineSystem();
    
    return () => {
      cleanup();
    };
  }, []);

  const initializeOfflineSystem = async () => {
    try {
      await syncService.initialize();
      console.log('✅ Offline system initialized');
    } catch (error) {
      console.error('❌ Offline system initialization error:', error);
    }
  };

  const loadAppSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem('good_road_settings');
      if (stored) {
        const settings = JSON.parse(stored) as AppSettings;
        setAppSettings(settings);
        setAudioEnabled(settings.audioWarnings);
        setVibrationEnabled(settings.vibrationWarnings);
      }
    } catch (error) {
      console.error('Error loading app settings:', error);
    }
  };

  // Функция для расчета направления к точке
  const calculateDirection = (
    fromLat: number, 
    fromLon: number, 
    toLat: number, 
    toLon: number
  ): number => {
    const dLon = (toLon - fromLon) * Math.PI / 180;
    const fromLatRad = fromLat * Math.PI / 180;
    const toLatRad = toLat * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(toLatRad);
    const x = Math.cos(fromLatRad) * Math.sin(toLatRad) - 
              Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(dLon);
    
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360; // Нормализуем к 0-360
  };

  // Функция для обновления локальных предупреждений
  const updateNearbyWarnings = async (latitude: number, longitude: number) => {
    try {
      // Получаем предупреждения из локальной БД (offline)
      const localWarnings = await syncService.getNearbyWarningsOffline(latitude, longitude, 2); // 2км радиус
      setNearbyWarnings(localWarnings);

      if (localWarnings.length > 0) {
        // Находим ближайшее предупреждение
        const warningsWithDistance = localWarnings.map(warning => ({
          ...warning,
          distance: calculateDistance(latitude, longitude, warning.latitude, warning.longitude)
        })).sort((a, b) => a.distance - b.distance);

        const closest = warningsWithDistance[0];
        setClosestWarning(closest);
        
        // Рассчитываем направление и дистанцию
        const direction = calculateDirection(latitude, longitude, closest.latitude, closest.longitude);
        setWarningDirection(direction);
        setWarningDistance(closest.distance);

        console.log(`🎯 Closest warning: ${closest.hazardType} at ${closest.distance.toFixed(0)}m, direction: ${direction.toFixed(0)}°`);
      } else {
        setClosestWarning(null);
        setWarningDirection(0);
        setWarningDistance(0);
      }
    } catch (error) {
      console.error('Error updating nearby warnings:', error);
    }
  };

  // Функция сохранения данных локально (offline)
  const saveSensorDataOffline = async (location: Location.LocationObject) => {
    try {
      await syncService.saveOfflineSensorData(
        location.coords.latitude,
        location.coords.longitude,
        currentSpeed,
        location.coords.accuracy || 0,
        { x: 0, y: 0, z: 0 }, // Акселерометр можно добавить позже
        roadConditionScore
      );
      console.log('💾 Sensor data saved offline');
    } catch (error) {
      console.error('Error saving sensor data offline:', error);
    }
  };

  const setupAudio = async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      console.log('🔊 Audio system initialized');
    } catch (error) {
      console.error('Audio setup error:', error);
    }
  };

  const cleanup = async () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
    }
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch (error) {
        console.error('Sound cleanup error:', error);
      }
    }
    if (warningIntervalRef.current) {
      clearInterval(warningIntervalRef.current);
    }
  };

  // Функции для умной системы предупреждений
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000; // Радиус Земли в метрах
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const getTimeToHazard = (distance: number, speed: number): number => {
    if (speed <= 0) return Infinity;
    const speedMPS = speed / 3.6; // км/ч в м/с
    return distance / speedMPS; // время в секундах
  };

  const checkUserReaction = (warning: WarningState, currentSpeed: number): boolean => {
    const speedDecrease = warning.initialSpeed - currentSpeed;
    const requiredDecrease = warning.initialSpeed * 0.1; // Требуется снижение на 10%
    
    console.log(`🚗 Checking reaction: Initial: ${warning.initialSpeed.toFixed(1)}, Current: ${currentSpeed.toFixed(1)}, Decrease: ${speedDecrease.toFixed(1)}, Required: ${requiredDecrease.toFixed(1)}`);
    
    return speedDecrease >= requiredDecrease;
  };

  const getWarningLevel = (timeToHazard: number, severity: string): WarningState['warningLevel'] => {
    if (timeToHazard < 3) return 'critical';
    if (timeToHazard < 6) return 'urgent';
    if (timeToHazard < 12) return 'caution';
    return 'initial';
  };

  const fetchNearbyHazards = async (latitude: number, longitude: number) => {
    try {
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8001';
      const response = await fetch(`${backendUrl}/api/warnings?latitude=${latitude}&longitude=${longitude}&radius=500`);
      
      if (response.ok) {
        const data = await response.json();
        const hazards: RoadHazard[] = data.map((item: any) => ({
          id: item._id,
          type: item.hazard_type || 'road_defect',
          latitude: item.latitude,
          longitude: item.longitude,
          severity: item.severity || 'medium',
          description: item.description || HAZARD_NAMES[item.hazard_type] || 'препятствие',
          distance: calculateDistance(latitude, longitude, item.latitude, item.longitude)
        }));
        
        setNearbyHazards(hazards);
        console.log(`🚨 Found ${hazards.length} nearby hazards`);
      }
    } catch (error) {
      console.error('Error fetching hazards:', error);
    }
  };

  const processWarnings = () => {
    if (!currentLocation || !isTracking || currentSpeed < (appSettings.speedThreshold || 15)) {
      return;
    }

    const now = Date.now();
    
    // Проверяем каждое препятствие
    nearbyHazards.forEach(hazard => {
      const distance = calculateDistance(
        currentLocation.coords.latitude,
        currentLocation.coords.longitude,
        hazard.latitude,
        hazard.longitude
      );

      const timeToHazard = getTimeToHazard(distance, currentSpeed);
      const warningLevel = getWarningLevel(timeToHazard, hazard.severity);
      
      // Проверяем, есть ли уже активное предупреждение для этого препятствия
      const existingWarning = activeWarnings.find(w => w.hazard.id === hazard.id);
      
      if (distance > (appSettings.maxWarningDistance || 200)) {
        // Удаляем предупреждение, если слишком далеко
        if (existingWarning) {
          setActiveWarnings(prev => prev.filter(w => w.hazard.id !== hazard.id));
        }
        return;
      }

      if (distance < (appSettings.minWarningDistance || 30)) {
        // Удаляем предупреждение, если слишком близко (проехали)
        if (existingWarning) {
          setActiveWarnings(prev => prev.filter(w => w.hazard.id !== hazard.id));
        }
        return;
      }

      if (!existingWarning && timeToHazard < 15) {
        // Создаем новое предупреждение
        const newWarning: WarningState = {
          hazard: { ...hazard, distance },
          distanceToHazard: distance,
          timeToHazard,
          currentSpeed,
          warningLevel,
          hasUserReacted: false,
          initialSpeed: currentSpeed,
          lastWarningTime: now
        };
        
        setActiveWarnings(prev => [...prev, newWarning]);
        triggerInitialWarning(newWarning);
        console.log(`🚨 New warning: ${hazard.description} in ${distance.toFixed(0)}m (${timeToHazard.toFixed(1)}s)`);
        
      } else if (existingWarning) {
        // Обновляем существующее предупреждение
        const hasReacted = checkUserReaction(existingWarning, currentSpeed);
        const timeSinceLastWarning = (now - existingWarning.lastWarningTime) / 1000;
        
        const updatedWarning: WarningState = {
          ...existingWarning,
          distanceToHazard: distance,
          timeToHazard,
          currentSpeed,
          warningLevel,
          hasUserReacted: hasReacted
        };

        setActiveWarnings(prev => 
          prev.map(w => w.hazard.id === hazard.id ? updatedWarning : w)
        );

        // Эскалация предупреждений, если пользователь не реагирует
        if (!hasReacted && timeSinceLastWarning > (appSettings.warningCooldown || 5)) {
          triggerEscalatedWarning(updatedWarning);
          
          setActiveWarnings(prev => 
            prev.map(w => w.hazard.id === hazard.id ? { ...w, lastWarningTime: now } : w)
          );
        }
      }
    });
  };

  const requestLocationPermission = async () => {
    try {
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      
      if (foregroundStatus !== 'granted') {
        setLocationError('Разрешение на геолокацию отклонено');
        Alert.alert(
          'Разрешение на геолокацию',
          'Для работы приложения необходимо разрешение на определение местоположения',
          [{ text: 'OK' }]
        );
        return;
      }

      // Запрос фонового доступа
      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        console.log('Background location not granted');
      }

      console.log('✅ Location permissions granted');
      setLocationError(null);
      
    } catch (error) {
      console.error('Permission request error:', error);
      setLocationError('Ошибка запроса разрешений');
    }
  };

  const startTracking = async () => {
    if (locationError) {
      Alert.alert('Ошибка', 'Сначала необходимо предоставить разрешение на геолокацию');
      return;
    }

    setIsLoading(true);
    
    try {
      // Проверяем доступность GPS
      const isLocationEnabled = await Location.hasServicesEnabledAsync();
      if (!isLocationEnabled) {
        Alert.alert('GPS отключен', 'Включите GPS для работы приложения');
        setIsLoading(false);
        return;
      }

      // Запускаем отслеживание геолокации
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000, // Обновления каждую секунду
          distanceInterval: 1, // Обновления каждый метр
        },
        (location) => {
          updateLocationData(location);
        }
      );

      setIsTracking(true);
      console.log('🛰️ GPS tracking started');
      
    } catch (error) {
      console.error('GPS start error:', error);
      Alert.alert('Ошибка GPS', 'Не удалось запустить отслеживание GPS');
    } finally {
      setIsLoading(false);
    }
  };

  const stopTracking = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    
    setIsTracking(false);
    setCurrentSpeed(0);
    console.log('🛑 GPS tracking stopped');
  };

  const triggerVibration = () => {
    if (!vibrationEnabled) return;

    if (Platform.OS !== 'web') {
      Vibration.vibrate([200, 100, 200, 100, 200, 100]);
      console.log('📳 Vibration triggered');
    } else {
      console.log('📳 Vibration would work on mobile device');
    }
  };

  const updateLocationData = (location: Location.LocationObject) => {
    setCurrentLocation(location);
    
    // Обновляем скорость (конвертируем м/с в км/ч)
    const speedKmh = (location.coords.speed || 0) * 3.6;
    setCurrentSpeed(speedKmh);
    
    // Обновляем историю скорости для анализа реакции пользователя
    setSpeedHistory(prev => {
      const newHistory = [...prev, speedKmh];
      return newHistory.length > 10 ? newHistory.slice(-10) : newHistory;
    });
    
    // Обновляем точность GPS
    setGpsAccuracy(location.coords.accuracy || 0);
    
    // Симулируем количество спутников на основе точности
    const estimatedSatellites = Math.max(4, Math.min(12, Math.round(20 - (location.coords.accuracy || 50) / 5)));
    setSatelliteCount(estimatedSatellites);
    
    console.log(`📍 Location: ${location.coords.latitude.toFixed(6)}, ${location.coords.longitude.toFixed(6)}`);
    console.log(`🚗 Speed: ${speedKmh.toFixed(1)} km/h`);
    console.log(`📡 Accuracy: ±${(location.coords.accuracy || 0).toFixed(1)}m`);
    
    // Проверяем препятствия каждые 5 секунд или при значительном изменении координат
    const now = Date.now();
    if (now - lastHazardCheck > 5000) {
      fetchNearbyHazards(location.coords.latitude, location.coords.longitude);
      updateNearbyWarnings(location.coords.latitude, location.coords.longitude);
      setLastHazardCheck(now);
    }
  };

  // Интеграция умной системы предупреждений с useEffect
  useEffect(() => {
    if (isTracking && currentLocation) {
      // Запускаем обработку предупреждений каждые 2 секунды
      if (warningIntervalRef.current) {
        clearInterval(warningIntervalRef.current);
      }
      
      warningIntervalRef.current = setInterval(() => {
        processWarnings();
      }, 2000);
    } else {
      // Очищаем предупреждения при остановке трекинга
      if (warningIntervalRef.current) {
        clearInterval(warningIntervalRef.current);
        warningIntervalRef.current = null;
      }
      setActiveWarnings([]);
      setNearbyHazards([]);
    }
    
    return () => {
      if (warningIntervalRef.current) {
        clearInterval(warningIntervalRef.current);
      }
    };
  }, [isTracking, currentLocation, currentSpeed, nearbyHazards.length]);

  const playWarningSound = async () => {
    if (!audioEnabled) return;

    try {
      // Получаем текущий выбранный звук
      const selectedSoundId = appSettings.selectedSoundId || 'beep_classic';
      const volume = appSettings.warningVolume || 0.8;
      
      // Ищем выбранный звук в кастомных звуках
      const customSound = appSettings.customSounds?.find(s => s.id === selectedSoundId);

      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      // Если выбран пользовательский звук и он существует
      if (customSound && customSound.uri) {
        try {
          if (soundRef.current) {
            await soundRef.current.unloadAsync();
          }

          const { sound } = await Audio.Sound.createAsync(
            { uri: customSound.uri },
            {
              shouldPlay: false,
              volume: volume,
              rate: 1.0,
            }
          );

          soundRef.current = sound;
          await sound.playAsync();
          console.log(`🔊 Custom sound played: ${customSound.name}`);
          return;
        } catch (error) {
          console.error('Error playing custom sound:', error);
          // Fallback to default sound
        }
      }

      // Web Audio API для браузера (разные звуки по типам)
      if (Platform.OS === 'web') {
        // @ts-ignore - Используем Web Audio API
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContext();
        
        switch (selectedSoundId) {
          case 'beep_classic':
            // Классический тройной БИП
            await playWebBeepPattern(audioContext, [
              {freq: 800, duration: 0.15, gap: 0.1},
              {freq: 800, duration: 0.15, gap: 0.1}, 
              {freq: 800, duration: 0.15, gap: 0}
            ], volume);
            break;
            
          case 'voice_male':
            // Имитация мужского голоса - низкие частоты
            await playWebVoicePattern(audioContext, 'male', volume);
            break;
            
          case 'voice_female':
            // Имитация женского голоса - высокие частоты
            await playWebVoicePattern(audioContext, 'female', volume);
            break;
            
          case 'chime_soft':
            // Мягкие колокольчики - высокие частоты с fade
            await playWebChimePattern(audioContext, volume);
            break;
            
          case 'horn_urgent':
            // Срочный сигнал - долгие низкие гудки
            await playWebHornPattern(audioContext, volume);
            break;
            
          default:
            // Fallback к классическому
            await playWebBeepPattern(audioContext, [
              {freq: 800, duration: 0.15, gap: 0.1},
              {freq: 800, duration: 0.15, gap: 0.1}, 
              {freq: 800, duration: 0.15, gap: 0}
            ], volume);
        }
        
        console.log(`🔊 Web Audio warning sound played: ${selectedSoundId}`);
        return;
      }

      // На мобильных устройствах используем expo-av
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      // Простой звуковой сигнал для мобильных (пока базовый)
      const { sound } = await Audio.Sound.createAsync(
        { 
          uri: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvGUgBSuG0O/AaykEK4nS8LljIAUug8rz0LljIAUiiM7t2o0zCQ==' 
        },
        {
          shouldPlay: false,
          volume: volume,
          rate: 1.0,
        }
      );

      soundRef.current = sound;
      
      // Воспроизводим звук
      await sound.playAsync();
      console.log(`🔊 Mobile warning sound played: ${selectedSoundId}`);
      
    } catch (error) {
      console.error('Sound play error:', error);
      console.log('🔊 Sound system: Warning beep (simulated)');
    }
  };
  
  // Вспомогательные функции для Web Audio
  const playWebBeepPattern = async (audioContext: AudioContext, pattern: {freq: number, duration: number, gap: number}[], volume: number) => {
    let currentTime = audioContext.currentTime;
    
    pattern.forEach((note, index) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      
      osc.connect(gain);
      gain.connect(audioContext.destination);
      
      osc.frequency.setValueAtTime(note.freq, currentTime);
      osc.type = 'sine';
      gain.gain.setValueAtTime(volume * 0.5, currentTime);
      gain.gain.setValueAtTime(0, currentTime + note.duration);
      
      osc.start(currentTime);
      osc.stop(currentTime + note.duration);
      
      currentTime += note.duration + note.gap;
    });
  };
  
  const playWebVoicePattern = async (audioContext: AudioContext, gender: 'male' | 'female', volume: number) => {
    // Имитируем речь через модуляцию частоты
    const baseFreq = gender === 'male' ? 120 : 200; // Основная частота голоса
    const pattern = [
      {freq: baseFreq * 2, duration: 0.2}, // "Вни"
      {freq: baseFreq * 1.5, duration: 0.15}, // "ма"  
      {freq: baseFreq * 1.8, duration: 0.2}, // "ние"
      {freq: baseFreq * 1.2, duration: 0.3}, // "препят"
      {freq: baseFreq * 1.6, duration: 0.25}, // "ствие"
    ];
    
    let currentTime = audioContext.currentTime;
    pattern.forEach(note => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      
      osc.connect(gain);
      gain.connect(audioContext.destination);
      
      osc.frequency.setValueAtTime(note.freq, currentTime);
      osc.type = 'sawtooth'; // Более голосоподобный тембр
      gain.gain.setValueAtTime(volume * 0.3, currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, currentTime + note.duration);
      
      osc.start(currentTime);
      osc.stop(currentTime + note.duration);
      
      currentTime += note.duration + 0.05;
    });
  };
  
  const playWebChimePattern = async (audioContext: AudioContext, volume: number) => {
    // Колокольчики - высокие чистые частоты с гармониками
    const notes = [1200, 1400, 1600]; // До, Ми, Соль в высокой октаве
    
    notes.forEach((freq, index) => {
      const startTime = audioContext.currentTime + (index * 0.3);
      
      // Основной тон
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      
      osc.connect(gain);
      gain.connect(audioContext.destination);
      
      osc.frequency.setValueAtTime(freq, startTime);
      osc.type = 'sine';
      gain.gain.setValueAtTime(volume * 0.4, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 1.0);
      
      osc.start(startTime);
      osc.stop(startTime + 1.0);
      
      // Гармоника для богатства звука
      const osc2 = audioContext.createOscillator();
      const gain2 = audioContext.createGain();
      
      osc2.connect(gain2);
      gain2.connect(audioContext.destination);
      
      osc2.frequency.setValueAtTime(freq * 2, startTime);
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(volume * 0.2, startTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, startTime + 0.8);
      
      osc2.start(startTime);
      osc2.stop(startTime + 0.8);
    });
  };
  
  const playWebHornPattern = async (audioContext: AudioContext, volume: number) => {
    // Срочный гудок - низкие частоты, долгие сигналы
    const pattern = [
      {freq: 400, duration: 0.6, gap: 0.2},
      {freq: 350, duration: 0.6, gap: 0.2},
      {freq: 400, duration: 0.8, gap: 0}
    ];
    
    let currentTime = audioContext.currentTime;
    
    pattern.forEach(note => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      
      osc.connect(gain);
      gain.connect(audioContext.destination);
      
      osc.frequency.setValueAtTime(note.freq, currentTime);
      osc.type = 'square'; // Более грубый звук для срочности
      gain.gain.setValueAtTime(volume * 0.6, currentTime);
      gain.gain.setValueAtTime(0, currentTime + note.duration);
      
      osc.start(currentTime);
      osc.stop(currentTime + note.duration);
      
      currentTime += note.duration + note.gap;
    });
  };

  const triggerInitialWarning = async (warning: WarningState) => {
    if (!audioEnabled) return;

    try {
      // Первое предупреждение - голосовое сообщение с типом препятствия и дистанцией
      const hazardName = HAZARD_NAMES[warning.hazard.type] || 'препятствие';
      const distance = Math.round(warning.distanceToHazard);
      
      console.log(`🗣️ Initial warning: ${hazardName} через ${distance} метров`);
      
      // Используем голосовое предупреждение (мужской или женский)
      const voiceType = appSettings.selectedSoundId === 'voice_female' ? 'female' : 'male';
      await playVoiceWarning(`Внимание! ${hazardName} через ${distance} метров`, voiceType);
      
      // Визуальная индикация
      if (vibrationEnabled) {
        triggerVibration();
      }
      
    } catch (error) {
      console.error('Initial warning error:', error);
    }
  };

  const triggerEscalatedWarning = async (warning: WarningState) => {
    if (!audioEnabled) return;

    try {
      const hazardName = HAZARD_NAMES[warning.hazard.type] || 'препятствие';
      const distance = Math.round(warning.distanceToHazard);
      const intensity = getWarningIntensity(warning.warningLevel, warning.timeToHazard);
      
      console.log(`🚨 Escalated warning: ${hazardName} ${distance}м, level: ${warning.warningLevel}, intensity: ${intensity}`);
      
      // Голосовое предупреждение + зуммер с нарастающей интенсивностью
      const voiceType = appSettings.selectedSoundId === 'voice_female' ? 'female' : 'male';
      
      // Сначала голос
      await playVoiceWarning(`Снизьте скорость! ${hazardName} ${distance} метров!`, voiceType);
      
      // Затем зуммер с интенсивностью в зависимости от близости
      setTimeout(() => {
        playEscalatingBeep(intensity);
      }, 1500);
      
      // Вибрация с увеличенной интенсивностью
      if (vibrationEnabled) {
        triggerEscalatedVibration(intensity);
      }
      
    } catch (error) {
      console.error('Escalated warning error:', error);
    }
  };

  const getWarningIntensity = (level: WarningState['warningLevel'], timeToHazard: number): number => {
    switch (level) {
      case 'critical': return 1.0;
      case 'urgent': return 0.8;
      case 'caution': return 0.6;
      default: return 0.4;
    }
  };

  const playVoiceWarning = async (message: string, gender: 'male' | 'female') => {
    const volume = (appSettings.warningVolume || 0.8) * 1.2; // Увеличиваем громкость для важных сообщений
    
    if (Platform.OS === 'web') {
      // Web Audio API - имитация речи
      // @ts-ignore
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContext();
      
      await playWebVoicePattern(audioContext, gender, volume);
      console.log(`🗣️ Web voice: "${message}" (${gender})`);
    } else {
      // На мобильном можно использовать Text-to-Speech API
      console.log(`🗣️ Mobile voice: "${message}" (${gender})`);
      // Fallback к базовому звуку
      await playBuiltInSound('voice_' + gender, volume);
    }
  };

  const playBuiltInSound = async (soundType: string, volume: number) => {
    try {
      // Простая реализация встроенных звуков для мобильных устройств
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      // Базовый звуковой сигнал (можно расширить для разных типов)
      const { sound } = await Audio.Sound.createAsync(
        { 
          uri: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvGUgBSuG0O/AaykEK4nS8LljIAUug8rz0LljIAUiiM7t2o0zCQ==' 
        },
        {
          shouldPlay: false,
          volume: volume,
          rate: soundType.includes('female') ? 1.2 : 0.8, // Изменяем тон для женского/мужского голоса
        }
      );

      soundRef.current = sound;
      await sound.playAsync();
      console.log(`🔊 Built-in sound played: ${soundType}`);
      
    } catch (error) {
      console.error('Built-in sound error:', error);
    }
  };

  const playEscalatingBeep = async (intensity: number) => {
    const volume = (appSettings.warningVolume || 0.8) * intensity;
    const frequency = 400 + (intensity * 400); // От 400Hz до 800Hz
    const beepCount = Math.round(2 + intensity * 4); // От 2 до 6 сигналов
    
    if (Platform.OS === 'web') {
      // @ts-ignore
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContext();
      
      // Создаем последовательность beep с уменьшающимися интервалами
      const baseInterval = 0.3 - (intensity * 0.15); // От 0.3с до 0.15с между сигналами
      
      for (let i = 0; i < beepCount; i++) {
        const startTime = audioContext.currentTime + (i * baseInterval);
        const currentIntensity = intensity + (i * 0.1); // Нарастающая интенсивность
        
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.frequency.setValueAtTime(frequency + (i * 50), startTime);
        osc.type = 'square'; // Более резкий звук для критических предупреждений
        gain.gain.setValueAtTime(volume * Math.min(1.0, currentIntensity), startTime);
        gain.gain.setValueAtTime(0, startTime + 0.15);
        
        osc.start(startTime);
        osc.stop(startTime + 0.15);
      }
      
      console.log(`📯 Escalating beep: ${beepCount} beeps, intensity: ${intensity.toFixed(1)}`);
    }
  };

  const triggerEscalatedVibration = (intensity: number) => {
    if (!vibrationEnabled || Platform.OS === 'web') return;
    
    // Создаем паттерн вибрации в зависимости от интенсивности
    const basePattern = [100, 50, 100, 50, 100];
    const intensityPattern = basePattern.map(duration => Math.round(duration * (1 + intensity)));
    
    Vibration.vibrate(intensityPattern);
    console.log(`📳 Escalated vibration: intensity ${intensity.toFixed(1)}`);
  };

  const testWarning = async () => {
    console.log('🚨 Testing smart warning system...');
    
    // Создаем тестовое препятствие
    const testHazard: RoadHazard = {
      id: 'test_hazard',
      type: 'pothole',
      latitude: currentLocation ? currentLocation.coords.latitude + 0.001 : 55.7558,
      longitude: currentLocation ? currentLocation.coords.longitude + 0.001 : 37.6176,
      severity: 'high',
      description: 'Тестовая яма на дороге'
    };
    
    const distance = currentLocation ? 
      calculateDistance(
        currentLocation.coords.latitude,
        currentLocation.coords.longitude,
        testHazard.latitude,
        testHazard.longitude
      ) : 150;
    
    const testSpeed = Math.max(currentSpeed, 50); // Имитируем скорость для демонстрации
    const timeToHazard = getTimeToHazard(distance, testSpeed);
    
    // Создаем тестовое предупреждение
    const testWarning: WarningState = {
      hazard: { ...testHazard, distance },
      distanceToHazard: distance,
      timeToHazard,
      currentSpeed: testSpeed,
      warningLevel: getWarningLevel(timeToHazard, testHazard.severity),
      hasUserReacted: false,
      initialSpeed: testSpeed,
      lastWarningTime: Date.now()
    };
    
    console.log(`🚨 Test warning: ${testHazard.description} in ${distance.toFixed(0)}m (${timeToHazard.toFixed(1)}s)`);
    
    // Демонстрируем первоначальное предупреждение
    await triggerInitialWarning(testWarning);
    
    // Через 3 секунды демонстрируем эскалированное предупреждение
    setTimeout(async () => {
      const escalatedWarning = {
        ...testWarning,
        warningLevel: 'urgent' as const,
        distanceToHazard: distance * 0.7,
        timeToHazard: timeToHazard * 0.7
      };
      
      console.log('🚨 Demonstrating escalated warning (user did not react)...');
      await triggerEscalatedWarning(escalatedWarning);
    }, 4000);
    
    // Показываем визуальное уведомление
    Alert.alert(
      '🚨 УМНАЯ СИСТЕМА ПРЕДУПРЕЖДЕНИЙ',
      `Демонстрация:\n\n` +
      `1️⃣ Первое предупреждение: "${HAZARD_NAMES[testHazard.type]} через ${Math.round(distance)} метров"\n\n` +
      `2️⃣ Через 4 секунды: Эскалированное предупреждение с зуммером\n\n` +
      `📊 Анализ: скорость ${testSpeed.toFixed(1)} км/ч, время до препятствия ${timeToHazard.toFixed(1)} сек`,
      [{ text: 'Понятно', style: 'default' }]
    );
  };

  const handleTrackingToggle = () => {
    if (isTracking) {
      stopTracking();
    } else {
      startTracking();
    }
  };

  const getRoadConditionColor = (score: number) => {
    if (score >= 80) return '#4CAF50';
    if (score >= 60) return '#FF9800';
    if (score >= 40) return '#FF5722';
    return '#F44336';
  };

  const getRoadConditionText = (score: number) => {
    if (score >= 80) return 'Отличная дорога';
    if (score >= 60) return 'Хорошая дорога';
    if (score >= 40) return 'Удовлетворительная';
    return 'Плохая дорога';
  };

  const getGPSStatusColor = () => {
    if (!isTracking) return '#888';
    if (gpsAccuracy <= 5) return '#4CAF50';
    if (gpsAccuracy <= 15) return '#FF9800';
    return '#F44336';
  };

  const getGPSStatusText = () => {
    if (locationError) return 'Ошибка GPS';
    if (!isTracking) return 'GPS выключен';
    if (gpsAccuracy <= 5) return 'Отличный сигнал';
    if (gpsAccuracy <= 15) return 'Хороший сигнал';
    return 'Слабый сигнал';
  };

  const getWarningColor = (level: WarningState['warningLevel']) => {
    switch (level) {
      case 'critical': return '#F44336';
      case 'urgent': return '#FF5722';
      case 'caution': return '#FF9800';
      default: return '#FFC107';
    }
  };

  const getWarningLevelText = (level: WarningState['warningLevel']) => {
    switch (level) {
      case 'critical': return 'КРИТИЧНО';
      case 'urgent': return 'СРОЧНО';
      case 'caution': return 'ОСТОРОЖНО';
      default: return 'ВНИМАНИЕ';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="car-sport" size={32} color="#4CAF50" />
        <Text style={styles.title}>Good Road</Text>
        <TouchableOpacity 
          onPress={() => {
            console.log('Navigating to settings from header...');
            try {
              router.push('/settings');
            } catch (error) {
              console.error('Header navigation error:', error);
              if (Platform.OS === 'web') {
                window.location.href = '/settings';
              }
            }
          }}
          style={styles.settingsButton}
        >
          <Ionicons name="settings" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* GPS Status Banner */}
        <View style={[styles.statusBanner, { borderLeftColor: getGPSStatusColor() }]}>
          <Ionicons name="radio" size={24} color={getGPSStatusColor()} />
          <View style={styles.bannerContent}>
            <Text style={styles.bannerTitle}>GPS Статус: {getGPSStatusText()}</Text>
            <Text style={styles.bannerText}>
              {isTracking ? (
                `📡 ${satelliteCount} спутников • Точность: ±${gpsAccuracy.toFixed(1)}м`
              ) : (
                'Нажмите "Начать мониторинг" для активации GPS'
              )}
            </Text>
          </View>
        </View>

        {/* Active Warnings */}
        {activeWarnings.length > 0 && (
          <View style={styles.warningsContainer}>
            <Text style={styles.warningsTitle}>🚨 Активные предупреждения</Text>
            {activeWarnings.map((warning) => (
              <View key={warning.hazard.id} style={[
                styles.warningCard,
                { borderLeftColor: getWarningColor(warning.warningLevel) }
              ]}>
                <View style={styles.warningHeader}>
                  <Text style={styles.warningType}>
                    {HAZARD_NAMES[warning.hazard.type] || 'препятствие'}
                  </Text>
                  <Text style={[
                    styles.warningLevel,
                    { color: getWarningColor(warning.warningLevel) }
                  ]}>
                    {getWarningLevelText(warning.warningLevel)}
                  </Text>
                </View>
                <Text style={styles.warningDistance}>
                  📍 {Math.round(warning.distanceToHazard)}м | ⏱️ {warning.timeToHazard.toFixed(1)}с
                </Text>
                <Text style={styles.warningReaction}>
                  {warning.hasUserReacted ? '✅ Реакция водителя' : '⚠️ Снизьте скорость!'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Road Condition Display with Direction Indicator */}
        <View style={styles.conditionCard}>
          <View style={[styles.conditionIndicator, { backgroundColor: getRoadConditionColor(roadConditionScore) }]}>
            <Text style={styles.conditionScore}>{Math.round(roadConditionScore)}</Text>
          </View>
          <View style={styles.conditionInfo}>
            <Text style={styles.conditionTitle}>Качество дороги</Text>
            
            {/* Direction Indicator */}
            {closestWarning && (
              <View style={styles.directionIndicator}>
                <View 
                  style={[
                    styles.directionArrow,
                    { 
                      transform: [{ rotate: `${warningDirection}deg` }],
                      backgroundColor: closestWarning.severity === 'critical' ? '#F44336' :
                                     closestWarning.severity === 'high' ? '#FF5722' :
                                     closestWarning.severity === 'medium' ? '#FF9800' : '#4CAF50'
                    }
                  ]}
                >
                  <Text style={styles.arrowText}>▲</Text>
                </View>
                <View style={styles.warningInfo}>
                  <Text style={styles.warningType}>
                    {HAZARD_NAMES[closestWarning.hazardType] || closestWarning.hazardType}
                  </Text>
                  <Text style={styles.warningDistance}>
                    {warningDistance < 1000 ? 
                      `${Math.round(warningDistance)}м` : 
                      `${(warningDistance/1000).toFixed(1)}км`}
                  </Text>
                </View>
              </View>
            )}
            
            {/* Offline Indicator */}
            {isOffline && (
              <View style={styles.offlineIndicator}>
                <Ionicons name="cloud-offline" size={16} color="#FF9800" />
                <Text style={styles.offlineText}>Offline режим</Text>
              </View>
            )}
            
            <Text style={[styles.conditionText, { color: getRoadConditionColor(roadConditionScore) }]}>
              {getRoadConditionText(roadConditionScore)}
            </Text>
          </View>
        </View>

        {/* Tracking Control */}
        <View style={styles.controlCard}>
          <TouchableOpacity
            style={[styles.trackingButton, { 
              backgroundColor: isTracking ? '#F44336' : '#4CAF50',
              opacity: isLoading ? 0.7 : 1 
            }]}
            onPress={handleTrackingToggle}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons 
                name={isTracking ? "stop" : "play"} 
                size={24} 
                color="white" 
              />
            )}
            <Text style={styles.buttonText}>
              {isLoading ? 'Подключение к GPS...' : 
               isTracking ? 'Остановить мониторинг' : 'Начать мониторинг'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Status Cards */}
        <View style={styles.statusGrid}>
          {/* GPS Card */}
          <View style={styles.statusCard}>
            <Ionicons name="location" size={24} color={getGPSStatusColor()} />
            <Text style={styles.statusTitle}>GPS</Text>
            <Text style={[styles.statusValue, { color: getGPSStatusColor() }]}>
              {getGPSStatusText()}
            </Text>
            <Text style={styles.statusSubtitle}>
              {isTracking ? `${satelliteCount} спутников` : 'Неактивен'}
            </Text>
          </View>

          {/* Speed Card */}
          <View style={styles.statusCard}>
            <Ionicons name="speedometer" size={24} color="#2196F3" />
            <Text style={styles.statusTitle}>Скорость</Text>
            <Text style={[styles.statusValue, { 
              color: currentSpeed > 0 ? '#4CAF50' : '#888',
              fontSize: 18
            }]}>
              {currentSpeed.toFixed(1)} км/ч
            </Text>
            <Text style={styles.statusSubtitle}>
              {currentSpeed > 0 ? 'В движении' : 'Стоим'}
            </Text>
          </View>
        </View>

        {/* Real-time Location Info */}
        {currentLocation && (
          <View style={styles.locationCard}>
            <Text style={styles.locationTitle}>📍 Текущая позиция</Text>
            <Text style={styles.locationText}>
              Широта: {currentLocation.coords.latitude.toFixed(6)}°
            </Text>
            <Text style={styles.locationText}>
              Долгота: {currentLocation.coords.longitude.toFixed(6)}°
            </Text>
            <Text style={styles.locationText}>
              Высота: {(currentLocation.coords.altitude || 0).toFixed(1)} м
            </Text>
            <Text style={styles.locationText}>
              Направление: {(currentLocation.coords.heading || 0).toFixed(0)}°
            </Text>
          </View>
        )}

        {/* Audio Settings */}
        <View style={styles.quickSettingsCard}>
          <Text style={styles.settingsTitle}>🔊 Звуковые настройки</Text>
          
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
          style={[styles.testButton, { 
            backgroundColor: audioEnabled ? '#FF5722' : '#666' 
          }]}
          onPress={testWarning}
        >
          <Ionicons name="volume-high" size={20} color="white" />
          <Text style={styles.testButtonText}>
            🚨 ТЕСТОВОЕ ПРЕДУПРЕЖДЕНИЕ
          </Text>
        </TouchableOpacity>

        {/* Settings Navigation */}
        <TouchableOpacity 
          style={styles.settingsNavButton}
          onPress={() => {
            console.log('Navigating to settings...');
            try {
              router.push('/settings');
            } catch (error) {
              console.error('Navigation error:', error);
              // Fallback: redirect with window location
              if (Platform.OS === 'web') {
                window.location.href = '/settings';
              }
            }
          }}
        >
          <Ionicons name="settings-outline" size={20} color="white" />
          <Text style={styles.settingsNavText}>Подробные настройки предупреждений</Text>
          <Ionicons name="chevron-forward" size={20} color="#888" />
        </TouchableOpacity>

        {/* Admin Panel Navigation */}
        <TouchableOpacity 
          style={[styles.settingsNavButton, { backgroundColor: '#FF9800' }]}
          onPress={() => {
            console.log('Navigating to admin panel...');
            try {
              router.push('/admin');
            } catch (error) {
              console.error('Admin navigation error:', error);
              if (Platform.OS === 'web') {
                window.location.href = '/admin';
              }
            }
          }}
        >
          <Ionicons name="analytics" size={20} color="white" />
          <Text style={styles.settingsNavText}>Административная панель</Text>
          <Ionicons name="chevron-forward" size={20} color="white" />
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
  statusBanner: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 4,
  },
  bannerContent: {
    flex: 1,
    marginLeft: 12,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  bannerText: {
    fontSize: 14,
    color: '#888',
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
    fontWeight: '600',
    marginTop: 4,
  },
  statusSubtitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  locationCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  locationTitle: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 8,
  },
  locationText: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
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
    padding: 18,
    borderRadius: 12,
    marginBottom: 16,
  },
  testButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
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
  warningsContainer: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  warningsTitle: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 12,
  },
  warningCard: {
    backgroundColor: '#333',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
  },
  warningHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  warningType: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  warningLevel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  warningDistance: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  warningReaction: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '500',
  },
  directionIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    padding: 8,
    backgroundColor: '#333',
    borderRadius: 8,
  },
  directionArrow: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  arrowText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  warningInfo: {
    flex: 1,
  },
  offlineIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
    padding: 6,
    backgroundColor: '#444',
    borderRadius: 6,
  },
  offlineText: {
    color: '#FF9800',
    fontSize: 12,
    marginLeft: 4,
    fontWeight: '500',
  },
});