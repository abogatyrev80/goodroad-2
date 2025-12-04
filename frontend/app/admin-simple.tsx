import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

// Простые типы данных без зависимостей от offline модулей
interface SensorDataPoint {
  id: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  speed: number;
  accuracy: number;
  accelerometer: {
    x: number;
    y: number;
    z: number;
  };
  roadQuality: number;
  hazardType?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  isVerified: boolean;
  adminNotes?: string;
}

interface AdminStats {
  totalPoints: number;
  verifiedPoints: number;
  hazardPoints: number;
  avgRoadQuality: number;
}

export default function AdminPanelSimple() {
  // Состояние данных
  const [sensorData, setSensorData] = useState<SensorDataPoint[]>([]);
  const [stats, setStats] = useState<AdminStats>({
    totalPoints: 0,
    verifiedPoints: 0,
    hazardPoints: 0,
    avgRoadQuality: 0
  });
  const [selectedPoint, setSelectedPoint] = useState<SensorDataPoint | null>(null);
  
  // UI состояние
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      console.log('🔄 Loading admin data...');

      // Try to load real data from backend first
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 
                        Constants.expoConfig?.extra?.backendUrl || 
                        'https://roadquality.emergent.host';
      console.log('🌐 Backend URL:', backendUrl);
      console.log('🔧 Backend URL source:', process.env.EXPO_PUBLIC_BACKEND_URL ? 'env' : 'app.json');
      console.log('🔗 Полный URL для запроса данных:', `${backendUrl}/api/admin/sensor-data`);
      console.log('🔗 Полный URL для запроса статистики:', `${backendUrl}/api/admin/analytics`);
      
      // 🆕 Загружаем данные и статистику параллельно (V2 endpoints)
      const [sensorResponse, statsResponse] = await Promise.all([
        fetch(`${backendUrl}/api/admin/v2/raw-data?limit=100`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        }),
        fetch(`${backendUrl}/api/admin/v2/analytics`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        })
      ]);

      console.log('📊 Sensor response status:', sensorResponse.status);
      console.log('📈 Stats response status:', statsResponse.status);

      if (sensorResponse.ok) {
        const result = await sensorResponse.json();
        console.log('✅ Raw data response:', result);
        console.log('✅ Sensor data loaded:', result.data?.length || 0, 'points');
        
        // V2 API возвращает {total, limit, skip, returned, data: [...]}
        if (result.data && Array.isArray(result.data)) {
          const formattedData: SensorDataPoint[] = result.data.map((point: any) => ({
            id: point._id || String(Math.random()),
            latitude: point.latitude || 0,
            longitude: point.longitude || 0,
            timestamp: point.timestamp,
            speed: point.speed || 0,
            accuracy: point.accuracy || 0,
            accelerometer: {
              x: point.accelerometer_x || 0,
              y: point.accelerometer_y || 0,
              z: point.accelerometer_z || 0
            },
            roadQuality: 50, // В raw_sensor_data нет road_quality_score
            hazardType: undefined,
            severity: 'medium',
            isVerified: false,
            adminNotes: ''
          }));
          
          setSensorData(formattedData);
          console.log('✅ Formatted sensor data set:', formattedData.length, 'points');
        }
      } else {
        console.error('❌ Sensor data request failed:', sensorResponse.status);
      }

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        console.log('✅ Stats loaded:', statsData);
        
        // V2 API возвращает {summary: {raw_data_points, processed_events, active_warnings}, ...}
        setStats({
          totalPoints: statsData.summary?.raw_data_points || 0,
          verifiedPoints: 0, // raw_sensor_data не имеет верификации
          hazardPoints: statsData.summary?.processed_events || 0,
          avgRoadQuality: 0 // raw_sensor_data не имеет road quality score
        });
      } else {
        console.error('❌ Stats request failed:', statsResponse.status);
      }

    } catch (error: any) {
      console.error('❌ Admin data loading error:', error);
      console.error('❌ Детали ошибки:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      
      // Show fallback demo data if API fails
      console.log('🌐 Loading demo data due to API error...');
      console.log('⚠️ ВНИМАНИЕ: Показываются ДЕМО-данные, не реальные данные с сервера!');
        
      const demoData: SensorDataPoint[] = [
        {
          id: 'demo_1',
          latitude: 55.7558,
          longitude: 37.6176,
          timestamp: new Date().toISOString(),
          speed: 45.2,
          accuracy: 3.5,
          accelerometer: { x: 0.1, y: 0.2, z: 9.8 },
          roadQuality: 85,
          hazardType: undefined,
          severity: 'medium',
          isVerified: true,
          adminNotes: 'Demo data point'
        },
        {
          id: 'demo_2', 
          latitude: 55.7568,
          longitude: 37.6186,
          timestamp: new Date(Date.now() - 300000).toISOString(),
          speed: 32.1,
          accuracy: 5.2,
          accelerometer: { x: 0.3, y: -0.1, z: 9.7 },
          roadQuality: 42,
          hazardType: 'pothole',
          severity: 'high',
          isVerified: false,
          adminNotes: 'Requires verification'
        }
      ];
        
      setSensorData(demoData);
      setStats({
        totalPoints: 22,
        verifiedPoints: 4,
        hazardPoints: 3,
        avgRoadQuality: 76.5
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
  };

  // Верификация недоступна для raw_sensor_data (это просто сырые данные без классификации)
  // Верификация работает только с processed_events
  const updatePointVerification = async (pointId: string, verified: boolean) => {
    Alert.alert(
      'Недоступно', 
      'Верификация недоступна для сырых данных. Эти данные не классифицированы и не содержат информации о событиях.'
    );
  };

  const getPointColor = (point: SensorDataPoint): string => {
    if (!point.isVerified) return '#FFC107'; // Желтый - неверифицированные
    
    if (point.hazardType) {
      switch (point.severity) {
        case 'critical': return '#F44336'; // Красный
        case 'high': return '#FF5722';     // Темно-оранжевый  
        case 'medium': return '#FF9800';   // Оранжевый
        default: return '#4CAF50';         // Зеленый
      }
    }
    
    // Цвет по качеству дороги
    if (point.roadQuality < 30) return '#F44336';      // Красный - плохо
    if (point.roadQuality < 60) return '#FF9800';      // Оранжевый - средне  
    return '#4CAF50';                                   // Зеленый - хорошо
  };

  const renderDataPoint = (point: SensorDataPoint) => (
    <Pressable
      key={point.id}
      style={[styles.dataPointCard, { borderLeftColor: '#4CAF50' }]}
      onPress={() => {
        setSelectedPoint(point);
        setShowDetails(true);
      }}
    >
      <View style={styles.dataPointHeader}>
        <Text style={styles.dataPointTime}>
          {new Date(point.timestamp).toLocaleDateString('ru-RU')} {' '}
          {new Date(point.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: '#2196F3' }]}>
          <Text style={styles.statusText}>Сырые данные</Text>
        </View>
      </View>
      
      <Text style={styles.dataPointLocation}>
        📍 {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
      </Text>
      
      <View style={styles.dataPointStats}>
        <Text style={styles.statItem}>🚗 {point.speed.toFixed(1)} км/ч</Text>
        <Text style={styles.statItem}>📡 ±{point.accuracy.toFixed(1)}м</Text>
        <Text style={styles.statItem}>📊 ({point.accelerometer.x.toFixed(2)}, {point.accelerometer.y.toFixed(2)}, {point.accelerometer.z.toFixed(2)})</Text>
      </View>
    </Pressable>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Загрузка административных данных...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable 
          onPress={() => {
            try {
              console.log('🔙 Попытка выхода из админ панели...');
              if (router.canGoBack()) {
                router.back();
              } else {
                console.log('📍 История пуста, переход на главную...');
                router.push('/');
              }
            } catch (error) {
              console.error('❌ Ошибка при выходе:', error);
              // Fallback: попытка перейти на главную страницу
              try {
                router.push('/');
              } catch (fallbackError) {
                console.error('❌ Fallback не сработал:', fallbackError);
              }
            }
          }}
          style={styles.headerButton}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Административная панель</Text>
        <Pressable onPress={handleRefresh} disabled={isRefreshing} style={styles.headerButton}>
          {isRefreshing ? (
            <ActivityIndicator size={20} color="#4CAF50" />
          ) : (
            <Ionicons name="refresh" size={20} color="#ffffff" />
          )}
        </Pressable>
      </View>

      <ScrollView style={styles.content}>
        {/* Statistics */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.totalPoints}</Text>
            <Text style={styles.statLabel}>Всего точек</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.verifiedPoints}</Text>
            <Text style={styles.statLabel}>Верифицировано</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.hazardPoints}</Text>
            <Text style={styles.statLabel}>Препятствий</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.avgRoadQuality.toFixed(1)}%</Text>
            <Text style={styles.statLabel}>Ср. качество</Text>
          </View>
        </View>

        {/* Sound Settings Button */}
        <Pressable
          style={styles.soundSettingsButton}
          onPress={() => {
            try {
              router.push('/sound-settings');
            } catch (error) {
              console.error('Navigation error:', error);
            }
          }}
        >
          <View style={styles.soundSettingsContent}>
            <View style={styles.soundSettingsLeft}>
              <Ionicons name="volume-high" size={24} color="#4CAF50" />
              <View style={styles.soundSettingsText}>
                <Text style={styles.soundSettingsTitle}>🔊 Звуковые оповещения</Text>
                <Text style={styles.soundSettingsSubtitle}>
                  Настройте звуки для разных типов событий
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#888" />
          </View>
        </Pressable>

        {/* Data Points List */}
        <View style={styles.dataSection}>
          <Text style={styles.sectionTitle}>
            📊 Данные датчиков ({sensorData.length})
          </Text>
          
          {sensorData.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Нет данных для отображения</Text>
            </View>
          ) : (
            sensorData.slice(0, 50).map(renderDataPoint)
          )}
        </View>
      </ScrollView>
      
      {/* Version Info Footer */}
      <View style={styles.versionInfo}>
        <Text style={styles.versionText}>Good Road v2.0.0</Text>
        <Text style={styles.versionSubtext}>
          Build: {new Date().toLocaleDateString('ru-RU')} | 
          Platform: {Platform.OS === 'web' ? 'Web' : 'Mobile'}
        </Text>
      </View>

      {/* Details Modal */}
      {selectedPoint && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Детали точки данных</Text>
              <Pressable onPress={() => setShowDetails(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </Pressable>
            </View>
            
            <ScrollView style={styles.modalScroll}>
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Координаты:</Text>
                <Text style={styles.detailValue}>
                  {selectedPoint.latitude.toFixed(6)}, {selectedPoint.longitude.toFixed(6)}
                </Text>
              </View>
              
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Время записи:</Text>
                <Text style={styles.detailValue}>
                  {new Date(selectedPoint.timestamp).toLocaleString('ru-RU')}
                </Text>
              </View>
              
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Скорость:</Text>
                <Text style={styles.detailValue}>
                  {selectedPoint.speed.toFixed(1)} км/ч
                </Text>
              </View>
              
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Точность GPS:</Text>
                <Text style={styles.detailValue}>
                  ±{selectedPoint.accuracy.toFixed(1)} метров
                </Text>
              </View>
              
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Акселерометр (x, y, z):</Text>
                <Text style={styles.detailValue}>
                  X: {selectedPoint.accelerometer.x.toFixed(3)} м/с²{'\n'}
                  Y: {selectedPoint.accelerometer.y.toFixed(3)} м/с²{'\n'}
                  Z: {selectedPoint.accelerometer.z.toFixed(3)} м/с²
                </Text>
              </View>
              
              <View style={[styles.infoBox, { backgroundColor: '#2196F3' }]}>
                <Text style={styles.infoText}>
                  ℹ️ Это сырые данные без классификации событий
                </Text>
              </View>
            </ScrollView>
            
            <Pressable 
              style={styles.closeButton}
              onPress={() => setShowDetails(false)}
            >
              <Text style={styles.closeButtonText}>Закрыть</Text>
            </Pressable>
          </View>
        </View>
      )}
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
    paddingVertical: 12,
    backgroundColor: '#2a2a2a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    marginLeft: 12,
    padding: 4,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    fontSize: 16,
    color: '#888',
    marginTop: 12,
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 16,
  },
  dataSection: {
    marginBottom: 80,
  },
  dataPointCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
  },
  dataPointHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dataPointTime: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 10,
    color: '#1a1a1a',
    fontWeight: '600',
  },
  dataPointLocation: {
    fontSize: 13,
    color: '#888',
    marginBottom: 8,
  },
  dataPointStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    fontSize: 12,
    color: '#666',
  },
  hazardType: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 8,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  soundSettingsButton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    marginBottom: 16,
    marginHorizontal: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  soundSettingsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  soundSettingsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  soundSettingsText: {
    marginLeft: 12,
    flex: 1,
  },
  soundSettingsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  soundSettingsSubtitle: {
    fontSize: 13,
    color: '#888',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  modalScroll: {
    padding: 20,
    maxHeight: 300,
  },
  detailSection: {
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    color: '#ffffff',
    lineHeight: 20,
  },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  verifyButtonActive: {
    backgroundColor: '#4CAF50',
  },
  verifyButtonText: {
    marginLeft: 8,
    fontSize: 15,
    fontWeight: '500',
    color: '#4CAF50',
  },
  closeButton: {
    backgroundColor: '#2a2a2a',
    padding: 16,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  versionInfo: {
    backgroundColor: '#2a2a2a',
    padding: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#333',
    marginTop: 16,
  },
  versionText: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  versionSubtext: {
    color: '#888',
    fontSize: 11,
    textAlign: 'center',
  },
  infoBox: {
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  infoText: {
    color: '#ffffff',
    fontSize: 13,
    textAlign: 'center',
  },
});