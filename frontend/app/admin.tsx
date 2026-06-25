import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

// Типы данных для административной панели
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

interface MapFilters {
  dateRange: 'today' | 'week' | 'month' | 'all';
  showVerified: boolean;
  showUnverified: boolean;
  hazardTypes: string[];
  minRoadQuality: number;
  maxRoadQuality: number;
}

export default function AdminPanel() {
  // Состояние данных
  const [sensorData, setSensorData] = useState<SensorDataPoint[]>([]);
  const [filteredData, setFilteredData] = useState<SensorDataPoint[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<SensorDataPoint | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Состояние фильтров
  const [filters, setFilters] = useState<MapFilters>({
    dateRange: 'week',
    showVerified: true,
    showUnverified: true,
    hazardTypes: [],
    minRoadQuality: 0,
    maxRoadQuality: 100
  });
  
  // UI состояние
  const [showFilters, setShowFilters] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  
  // Ref для карты
  const mapRef = useRef<any>(null);

  useEffect(() => {
    loadSensorData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [sensorData, filters]);

  const loadSensorData = async () => {
    try {
      setIsLoading(true);
      
      // Используем правильный URL для Expo dev server
      const apiUrl = '/api/admin/sensor-data';
      
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });
      
      
      if (response.ok) {
        const data = await response.json();
        
        if (data && data.data && Array.isArray(data.data)) {
          const formattedData: SensorDataPoint[] = data.data.map((item: any) => ({
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
        } else {
          console.error('❌ Invalid data structure received:', data);
          Alert.alert('Ошибка', 'Неверная структура данных от сервера');
        }
      } else {
        const errorText = await response.text();
        console.error(`❌ HTTP Error ${response.status}: ${response.statusText}`);
        console.error('Error details:', errorText);
        Alert.alert('Ошибка сервера', `HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error: any) {
      console.error('❌ Network/fetch error:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      
      if (error.name === 'TypeError' && error.message.includes('Network request failed')) {
        Alert.alert(
          'Ошибка подключения', 
          'Не удалось подключиться к серверу. Проверьте:\n\n' +
          '• Запущен ли backend сервер\n' +
          '• Правильность настроек прокси\n' +
          '• Подключение к интернету'
        );
      } else {
        Alert.alert('Ошибка', `Произошла ошибка: ${error.message || error}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...sensorData];
    
    // Фильтр по дате
    const now = new Date();
    const filterDate = new Date();
    switch (filters.dateRange) {
      case 'today':
        filterDate.setDate(now.getDate());
        break;
      case 'week':
        filterDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        filterDate.setMonth(now.getMonth() - 1);
        break;
      default:
        filterDate.setFullYear(2020); // Показать все
    }
    
    filtered = filtered.filter(point => 
      new Date(point.timestamp) >= filterDate
    );
    
    // Фильтр по статусу верификации
    if (!filters.showVerified) {
      filtered = filtered.filter(point => !point.isVerified);
    }
    if (!filters.showUnverified) {
      filtered = filtered.filter(point => point.isVerified);
    }
    
    // Фильтр по качеству дороги
    filtered = filtered.filter(point => 
      point.roadQuality >= filters.minRoadQuality && 
      point.roadQuality <= filters.maxRoadQuality
    );
    
    setFilteredData(filtered);
  };

  const updatePointClassification = async (pointId: string, updates: Partial<SensorDataPoint>) => {
    try {
      
      // Преобразуем camelCase в snake_case для backend
      const backendUpdates: any = {};
      if ('isVerified' in updates) backendUpdates.is_verified = updates.isVerified;
      if ('hazardType' in updates) backendUpdates.hazard_type = updates.hazardType;
      if ('severity' in updates) backendUpdates.severity = updates.severity;
      if ('adminNotes' in updates) backendUpdates.admin_notes = updates.adminNotes;
      
      
      // Используем прямой запрос к локальному backend
      const apiUrl = `/api/admin/sensor-data/${pointId}`;
      
      const response = await fetch(apiUrl, {
        method: 'PATCH',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(backendUpdates),
      });
      
      
      if (response.ok) {
        const result = await response.json();
        
        // Обновляем локальные данные
        setSensorData(prev => 
          prev.map(point => 
            point.id === pointId ? { ...point, ...updates } : point
          )
        );
        
        Alert.alert('Успешно', 'Данные обновлены');
      } else {
        const errorText = await response.text();
        console.error('❌ Update failed:', errorText);
        Alert.alert('Ошибка', `Не удалось обновить данные: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Update error:', error);
      Alert.alert('Ошибка', 'Ошибка соединения с сервером');
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

  const renderMap = () => {
    if (Platform.OS === 'web') {
      // Web версия с Google Maps
      return (
        <div 
          id="map" 
          style={{
            width: '100%',
            height: '400px',
            backgroundColor: '#333',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '16px',
            position: 'relative'
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🗺️</div>
            <div>Карта с данными датчиков</div>
            <div style={{ fontSize: '14px', color: '#888', marginTop: '8px' }}>
              {filteredData.length} точек данных
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '16px' }}>
              В production версии здесь будет интерактивная карта Google Maps/Яндекс
            </div>
          </div>
          
          {/* Симуляция точек на карте */}
          {filteredData.slice(0, 10).map((point, index) => (
            <div
              key={point.id}
              style={{
                position: 'absolute',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: getPointColor(point),
                left: `${20 + (index % 5) * 15}%`,
                top: `${30 + Math.floor(index / 5) * 20}%`,
                cursor: 'pointer',
                border: '2px solid white',
                boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
              }}
              onClick={() => setSelectedPoint(point)}
              title={`Качество дороги: ${point.roadQuality}%${point.hazardType ? `, Тип: ${point.hazardType}` : ''}`}
            />
          ))}
        </div>
      );
    } else {
      // Мобильная версия - заглушка для карты
      return (
        <View style={styles.mapPlaceholder}>
          <Ionicons name="map" size={48} color="#666" />
          <Text style={styles.mapPlaceholderText}>Карта с данными датчиков</Text>
          <Text style={styles.mapPlaceholderSubtext}>
            {filteredData.length} точек данных
          </Text>
        </View>
      );
    }
  };

  const renderDataPoint = (point: SensorDataPoint, index: number) => (
    <TouchableOpacity
      key={point.id}
      style={[styles.dataPointCard, { borderLeftColor: getPointColor(point) }]}
      onPress={() => setSelectedPoint(point)}
    >
      <View style={styles.dataPointHeader}>
        <Text style={styles.dataPointTime}>
          {new Date(point.timestamp).toLocaleDateString('ru-RU')} {new Date(point.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: point.isVerified ? '#4CAF50' : '#FFC107' }]}>
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

  const renderDetailsModal = () => (
    <Modal
      visible={showDetails && selectedPoint !== null}
      transparent
      animationType="slide"
      onRequestClose={() => setShowDetails(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Детали точки данных</Text>
            <TouchableOpacity onPress={() => setShowDetails(false)}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          
          {selectedPoint && (
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
                <Text style={styles.detailLabel}>Данные движения:</Text>
                <Text style={styles.detailValue}>
                  Скорость: {selectedPoint.speed.toFixed(1)} км/ч{'\n'}
                  Точность GPS: ±{selectedPoint.accuracy.toFixed(1)}м
                </Text>
              </View>
              
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Акселерометр:</Text>
                <Text style={styles.detailValue}>
                  X: {selectedPoint.accelerometer.x.toFixed(3)}{'\n'}
                  Y: {selectedPoint.accelerometer.y.toFixed(3)}{'\n'}
                  Z: {selectedPoint.accelerometer.z.toFixed(3)}
                </Text>
              </View>
              
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Качество дороги:</Text>
                <Text style={[styles.detailValue, { color: getPointColor(selectedPoint) }]}>
                  {selectedPoint.roadQuality}% ({selectedPoint.roadQuality > 70 ? 'Хорошее' : selectedPoint.roadQuality > 40 ? 'Среднее' : 'Плохое'})
                </Text>
              </View>
              
              <View style={styles.classificationSection}>
                <Text style={styles.sectionTitle}>Классификация администратора</Text>
                
                <TouchableOpacity
                  style={[styles.verifyButton, selectedPoint.isVerified && styles.verifyButtonActive]}
                  onPress={() => {
                    updatePointClassification(selectedPoint.id, { isVerified: !selectedPoint.isVerified });
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
                
                <View style={styles.hazardClassification}>
                  <Text style={styles.classificationLabel}>Тип препятствия:</Text>
                  <View style={styles.hazardButtons}>
                    {['pothole', 'speed_bump', 'road_defect', 'construction'].map(hazard => (
                      <TouchableOpacity
                        key={hazard}
                        style={[
                          styles.hazardButton,
                          selectedPoint.hazardType === hazard && styles.hazardButtonActive
                        ]}
                        onPress={() => {
                          const updates = { hazardType: selectedPoint.hazardType === hazard ? '' : hazard };
                          updatePointClassification(selectedPoint.id, updates);
                          setSelectedPoint({ ...selectedPoint, ...updates });
                        }}
                      >
                        <Text style={[
                          styles.hazardButtonText,
                          selectedPoint.hazardType === hazard && { color: 'white' }
                        ]}>
                          {hazard === 'pothole' ? 'Яма' :
                           hazard === 'speed_bump' ? 'Лежачий полицейский' :
                           hazard === 'road_defect' ? 'Дефект' :
                           'Работы'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Административная панель</Text>
        <TouchableOpacity onPress={() => setShowFilters(true)}>
          <Ionicons name="filter" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Statistics */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{sensorData.length}</Text>
            <Text style={styles.statLabel}>Всего точек</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{sensorData.filter(p => p.isVerified).length}</Text>
            <Text style={styles.statLabel}>Верифицировано</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{sensorData.filter(p => p.hazardType).length}</Text>
            <Text style={styles.statLabel}>Препятствий</Text>
          </View>
        </View>

        {/* Debug Section */}
        <View style={[styles.statsContainer, { marginBottom: 16 }]}>
          <TouchableOpacity 
            style={[styles.statCard, { backgroundColor: '#FF9800' }]}
            onPress={async () => {
              Alert.alert('Тест API', 'Тестируем подключение к backend...');
              try {
                const testUrl = '/api/admin/analytics';
                const response = await fetch(testUrl);
                const data = await response.json();
                Alert.alert('API Тест', `Статус: ${response.status}\nДанные: ${JSON.stringify(data).substring(0, 100)}...`);
              } catch (error) {
                console.error('API test error:', error);
                Alert.alert('API Ошибка', `${error.message || error}`);
              }
            }}
          >
            <Text style={[styles.statNumber, { fontSize: 16 }]}>🔧</Text>
            <Text style={styles.statLabel}>Тест API</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.statCard, { backgroundColor: '#4CAF50' }]}
            onPress={() => {
              loadSensorData();
            }}
          >
            <Text style={[styles.statNumber, { fontSize: 16 }]}>🔄</Text>
            <Text style={styles.statLabel}>Обновить</Text>
          </TouchableOpacity>
        </View>

        {/* Map Section */}
        <View style={styles.mapSection}>
          <Text style={styles.sectionTitle}>🗺️ Карта данных датчиков</Text>
          
          {Platform.OS === 'web' ? (
            <TouchableOpacity 
              style={styles.mapWebButton}
              onPress={() => {
                const mapUrl = `${window.location.origin}/admin-map.html`;
                window.open(mapUrl, '_blank');
              }}
            >
              <View style={styles.mapPlaceholder}>
                <Ionicons name="map" size={48} color="#4CAF50" />
                <Text style={styles.mapPlaceholderText}>Открыть интерактивную карту</Text>
                <Text style={styles.mapPlaceholderSubtext}>
                  {filteredData.length} точек данных
                </Text>
                <View style={styles.openMapButton}>
                  <Ionicons name="open-outline" size={16} color="white" />
                  <Text style={styles.openMapText}>Открыть в новом окне</Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            renderMap()
          )}
        </View>

        {/* Data Points List */}
        <View style={styles.dataSection}>
          <Text style={styles.sectionTitle}>
            📊 Данные датчиков ({filteredData.length})
          </Text>
          
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Загрузка данных...</Text>
            </View>
          ) : filteredData.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Нет данных для отображения</Text>
            </View>
          ) : (
            filteredData.slice(0, 50).map(renderDataPoint)
          )}
        </View>
      </ScrollView>
      
      {selectedPoint && (
        <TouchableOpacity 
          style={styles.detailsButton}
          onPress={() => setShowDetails(true)}
        >
          <Text style={styles.detailsButtonText}>Показать детали</Text>
          <Ionicons name="chevron-up" size={20} color="white" />
        </TouchableOpacity>
      )}

      {renderDetailsModal()}
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
  mapSection: {
    marginBottom: 24,
  },
  mapPlaceholder: {
    height: 400,
    backgroundColor: '#333',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPlaceholderText: {
    fontSize: 16,
    color: '#ffffff',
    marginTop: 12,
  },
  mapPlaceholderSubtext: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
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
  detailsButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: '#4CAF50',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  detailsButtonText: {
    color: 'white',
    fontWeight: '600',
    marginRight: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
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
  classificationSection: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
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
  hazardClassification: {
    marginTop: 8,
  },
  classificationLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
  },
  hazardButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hazardButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#666',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  hazardButtonActive: {
    backgroundColor: '#FF9800',
    borderColor: '#FF9800',
  },
  hazardButtonText: {
    fontSize: 12,
    color: '#666',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    fontSize: 16,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
  },
  mapWebButton: {
    width: '100%',
  },
  openMapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 12,
  },
  openMapText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
});