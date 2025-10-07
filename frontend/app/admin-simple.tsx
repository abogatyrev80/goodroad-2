import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
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

      // Загружаем данные и статистику параллельно
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8001';
      console.log('🌐 Backend URL:', backendUrl);
      
      const [sensorResponse, statsResponse] = await Promise.all([
        fetch(`${backendUrl}/api/admin/sensor-data`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        }),
        fetch(`${backendUrl}/api/admin/analytics`, {
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
        const sensorData = await sensorResponse.json();
        console.log('✅ Sensor data loaded:', sensorData.data?.length || 0, 'points');
        
        if (sensorData.data && Array.isArray(sensorData.data)) {
          const formattedData: SensorDataPoint[] = sensorData.data.map((item: any) => ({
            id: item._id || item.id,
            latitude: item.latitude,
            longitude: item.longitude,
            timestamp: item.timestamp,
            speed: item.speed || 0,
            accuracy: item.accuracy || 0,
            accelerometer: item.accelerometer || { x: 0, y: 0, z: 0 },
            roadQuality: item.road_quality_score || 50,
            hazardType: item.hazard_type,
            severity: item.severity || 'medium',
            isVerified: item.is_verified || false,
            adminNotes: item.admin_notes || ''
          }));
          
          setSensorData(formattedData);
        }
      } else {
        console.error('❌ Sensor data request failed:', sensorResponse.status);
        Alert.alert('Ошибка', `Не удалось загрузить данные датчиков: ${sensorResponse.status}`);
      }

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        console.log('✅ Stats loaded:', statsData);
        
        setStats({
          totalPoints: statsData.total_points || 0,
          verifiedPoints: statsData.verified_points || 0,
          hazardPoints: statsData.hazard_points || 0,
          avgRoadQuality: statsData.avg_road_quality || 0
        });
      } else {
        console.error('❌ Stats request failed:', statsResponse.status);
      }

    } catch (error: any) {
      console.error('❌ Admin data loading error:', error);
      
      // Show fallback demo data for web version
      if (Platform.OS === 'web') {
        console.log('🌐 Using demo data for web preview...');
        
        // Demo sensor data
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
            adminNotes: ''
          }
        ];
        
        setSensorData(demoData);
        setStats({
          totalPoints: 22,
          verifiedPoints: 4,
          hazardPoints: 3,
          avgRoadQuality: 76.5
        });
        
      } else {
        Alert.alert(
          'Ошибка загрузки', 
          `Произошла ошибка при загрузке данных: ${error.message || error}`
        );
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
  };

  const updatePointVerification = async (pointId: string, verified: boolean) => {
    try {
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8001';
      const response = await fetch(`${backendUrl}/api/admin/sensor-data/${pointId}`, {
        method: 'PATCH',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_verified: verified }),
      });

      if (response.ok) {
        // Обновляем локальные данные
        setSensorData(prev => 
          prev.map(point => 
            point.id === pointId ? { ...point, isVerified: verified } : point
          )
        );
        
        // Обновляем статистику
        setStats(prev => ({
          ...prev,
          verifiedPoints: verified ? prev.verifiedPoints + 1 : prev.verifiedPoints - 1
        }));
        
        Alert.alert('Успешно', verified ? 'Точка верифицирована' : 'Верификация отменена');
      } else {
        Alert.alert('Ошибка', `Не удалось обновить статус: ${response.status}`);
      }
    } catch (error: any) {
      console.error('❌ Verification update error:', error);
      Alert.alert('Ошибка', 'Не удалось обновить статус верификации');
    }
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
    <TouchableOpacity
      key={point.id}
      style={[styles.dataPointCard, { borderLeftColor: getPointColor(point) }]}
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
        <View style={[styles.statusBadge, { 
          backgroundColor: point.isVerified ? '#4CAF50' : '#FFC107' 
        }]}>
          <Text style={styles.statusText}>
            {point.isVerified ? 'Верифицировано' : 'Требует проверки'}
          </Text>
        </View>
      </View>
      
      <Text style={styles.dataPointLocation}>
        📍 {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
      </Text>
      
      <View style={styles.dataPointStats}>
        <Text style={styles.statItem}>🚗 {point.speed.toFixed(1)} км/ч</Text>
        <Text style={styles.statItem}>🛣️ {point.roadQuality}%</Text>
        <Text style={styles.statItem}>📡 ±{point.accuracy.toFixed(1)}м</Text>
      </View>
      
      {point.hazardType && (
        <Text style={[styles.hazardType, { color: getPointColor(point) }]}>
          ⚠️ {point.hazardType} ({point.severity})
        </Text>
      )}
    </TouchableOpacity>
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
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Административная панель</Text>
        <TouchableOpacity onPress={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? (
            <ActivityIndicator size={20} color="#4CAF50" />
          ) : (
            <Ionicons name="refresh" size={24} color="#ffffff" />
          )}
        </TouchableOpacity>
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

      {/* Details Modal */}
      {selectedPoint && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Детали точки данных</Text>
              <TouchableOpacity onPress={() => setShowDetails(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
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
                <Text style={styles.detailLabel}>Качество дороги:</Text>
                <Text style={[styles.detailValue, { color: getPointColor(selectedPoint) }]}>
                  {selectedPoint.roadQuality}% ({selectedPoint.roadQuality > 70 ? 'Хорошее' : selectedPoint.roadQuality > 40 ? 'Среднее' : 'Плохое'})
                </Text>
              </View>
              
              <TouchableOpacity
                style={[styles.verifyButton, selectedPoint.isVerified && styles.verifyButtonActive]}
                onPress={() => {
                  updatePointVerification(selectedPoint.id, !selectedPoint.isVerified);
                  setSelectedPoint({ ...selectedPoint, isVerified: !selectedPoint.isVerified });
                }}
              >
                <Ionicons 
                  name={selectedPoint.isVerified ? "checkmark-circle" : "checkmark-circle-outline"} 
                  size={20} 
                  color={selectedPoint.isVerified ? "white" : "#4CAF50"} 
                />
                <Text style={[styles.verifyButtonText, selectedPoint.isVerified && { color: 'white' }]}>
                  {selectedPoint.isVerified ? 'Верифицировано' : 'Верифицировать'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
            
            <TouchableOpacity 
              style={styles.closeButton}
              onPress={() => setShowDetails(false)}
            >
              <Text style={styles.closeButtonText}>Закрыть</Text>
            </TouchableOpacity>
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
});