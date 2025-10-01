import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
// Cross-platform storage solution
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, HazardType } from '../app/settings';

export const storage = {
  getString: async (key: string) => {
    return await AsyncStorage.getItem(key);
  },
  set: async (key: string, value: string) => {
    return await AsyncStorage.setItem(key, value);
  },
  delete: async (key: string) => {
    return await AsyncStorage.removeItem(key);
  }
};

// Default hazard types with optimized configuration
const defaultHazardTypes: HazardType[] = [
  { id: 'pothole', name: 'Ямы', icon: 'alert-circle', enabled: true, criticalDistance: 50 },
  { id: 'speed_bump', name: 'Лежачие полицейские', icon: 'triangle', enabled: true, criticalDistance: 30 },
  { id: 'road_defect', name: 'Дефекты покрытия', icon: 'warning', enabled: true, criticalDistance: 40 },
  { id: 'pedestrian_crossing', name: 'Пешеходные переходы', icon: 'walk', enabled: true, criticalDistance: 60 },
  { id: 'railway_crossing', name: 'ЖД переезды', icon: 'train', enabled: true, criticalDistance: 100 },
  { id: 'unpaved_road', name: 'Грунтовое покрытие', icon: 'trail-sign', enabled: true, criticalDistance: 70 },
  { id: 'construction', name: 'Дорожные работы', icon: 'construct', enabled: true, criticalDistance: 80 },
];

const defaultSettings: AppSettings = {
  audioWarnings: true,
  vibrationWarnings: true,
  warningVolume: 0.8,
  speedThreshold: 15,
  minWarningDistance: 30,
  maxWarningDistance: 200,
  warningCooldown: 5,
  hazardTypes: defaultHazardTypes,
};

// Location and tracking data interface
export interface LocationData {
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  accuracy: number;
  timestamp: number;
}

export interface Hazard {
  id: string;
  type: string;
  latitude: number;
  longitude: number;
  severity: 'low' | 'medium' | 'high';
  distance?: number;
  confidence?: number;
}

// Optimized store interface
interface AppStore {
  // Settings
  settings: AppSettings;
  loadSettings: () => void;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  resetSettings: () => void;
  
  // Tracking state
  isTracking: boolean;
  setTracking: (tracking: boolean) => void;
  
  // Location data
  currentLocation: LocationData | null;
  locationHistory: LocationData[];
  updateLocation: (location: LocationData) => void;
  clearLocationHistory: () => void;
  
  // Road conditions
  roadConditionScore: number;
  updateRoadScore: (score: number) => void;
  
  // Hazards and warnings
  activeHazards: Hazard[];
  warningHistory: Array<{ hazard: Hazard; timestamp: number }>;
  addHazard: (hazard: Hazard) => void;
  removeHazard: (hazardId: string) => void;
  clearHazards: () => void;
  
  // Performance metrics
  lastWarningTime: number;
  dataProcessingStats: {
    totalDataPoints: number;
    lastSyncTime: number;
    syncErrors: number;
  };
  updateStats: (stats: Partial<AppStore['dataProcessingStats']>) => void;
}

// Memoized calculation functions
const calculateRoadCondition = (locationHistory: LocationData[]): number => {
  if (locationHistory.length < 5) return 75;
  
  const recentData = locationHistory.slice(-20);
  const speedVariations = recentData.map((loc, i) => 
    i > 0 ? Math.abs(loc.speed - recentData[i - 1].speed) : 0
  );
  
  const avgSpeedVariation = speedVariations.reduce((a, b) => a + b, 0) / speedVariations.length;
  const score = Math.max(0, Math.min(100, 100 - (avgSpeedVariation * 10)));
  
  return score;
};

// Optimized distance calculation using fast approximation for nearby points
export const fastDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat = (lat1 + lat2) / 2 * Math.PI / 180;
  
  const dx = dLon * R * Math.cos(lat);
  const dy = dLat * R;
  
  return Math.sqrt(dx * dx + dy * dy);
};

// Create optimized store with persistence
export const useAppStore = create<AppStore>()(
  subscribeWithSelector((set, get) => ({
    // Settings
    settings: defaultSettings,
    
    loadSettings: async () => {
      try {
        const stored = await storage.getString('app_settings');
        if (stored) {
          const parsed = JSON.parse(stored);
          set({ settings: { ...defaultSettings, ...parsed } });
        }
      } catch (error) {
        console.error('Error loading settings:', error);
        // Fallback to defaults
        set({ settings: defaultSettings });
      }
    },
    
    updateSettings: async (newSettings) => {
      const updatedSettings = { ...get().settings, ...newSettings };
      set({ settings: updatedSettings });
      
      try {
        await storage.set('app_settings', JSON.stringify(updatedSettings));
      } catch (error) {
        console.error('Error saving settings:', error);
      }
    },
    
    resetSettings: async () => {
      set({ settings: defaultSettings });
      await storage.delete('app_settings');
    },
    
    // Tracking state
    isTracking: false,
    setTracking: (tracking) => set({ isTracking: tracking }),
    
    // Location data with optimized updates
    currentLocation: null,
    locationHistory: [],
    
    updateLocation: (location) => {
      const { locationHistory, settings } = get();
      
      // Limit history size for performance (keep last 100 points)
      const newHistory = [...locationHistory.slice(-99), location];
      
      // Calculate road condition only when needed
      const newScore = calculateRoadCondition(newHistory);
      
      set({ 
        currentLocation: location,
        locationHistory: newHistory,
        roadConditionScore: newScore
      });
    },
    
    clearLocationHistory: () => set({ locationHistory: [] }),
    
    // Road conditions
    roadConditionScore: 75,
    updateRoadScore: (score) => set({ roadConditionScore: score }),
    
    // Hazards with optimized management
    activeHazards: [],
    warningHistory: [],
    lastWarningTime: 0,
    
    addHazard: (hazard) => {
      const { activeHazards, settings } = get();
      const now = Date.now();
      
      // Check if similar hazard already exists nearby
      const existingSimilar = activeHazards.find(h => 
        h.type === hazard.type && 
        fastDistance(h.latitude, h.longitude, hazard.latitude, hazard.longitude) < 100
      );
      
      if (!existingSimilar) {
        const newHazards = [...activeHazards, hazard];
        set({ 
          activeHazards: newHazards,
          warningHistory: [...get().warningHistory, { hazard, timestamp: now }].slice(-50), // Keep last 50
          lastWarningTime: now
        });
      }
    },
    
    removeHazard: (hazardId) => {
      set({ 
        activeHazards: get().activeHazards.filter(h => h.id !== hazardId)
      });
    },
    
    clearHazards: () => set({ activeHazards: [], warningHistory: [] }),
    
    // Performance stats
    dataProcessingStats: {
      totalDataPoints: 0,
      lastSyncTime: 0,
      syncErrors: 0,
    },
    
    updateStats: (stats) => {
      set({ 
        dataProcessingStats: { ...get().dataProcessingStats, ...stats }
      });
    },
  }))
);

// Auto-persist critical data
useAppStore.subscribe(
  (state) => state.settings,
  async (settings) => {
    try {
      await storage.set('app_settings', JSON.stringify(settings));
    } catch (error) {
      console.error('Error persisting settings:', error);
    }
  },
  { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
);

// Performance monitoring
useAppStore.subscribe(
  (state) => state.dataProcessingStats,
  (stats) => {
    // Log performance metrics for debugging
    if (__DEV__) {
      console.log('Performance stats:', stats);
    }
  }
);

export default useAppStore;