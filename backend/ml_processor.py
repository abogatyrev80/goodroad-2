"""
ML Processor для анализа сырых данных и классификации событий
Портирует логику из EventDetector.ts на Python для серверной обработки
"""

import math
from typing import List, Dict, Tuple, Optional
from datetime import datetime, timedelta


class EventClassifier:
    """Классификатор событий на основе данных акселерометра"""
    
    def __init__(self):
        # Пороги чувствительности (можно адаптировать под устройство)
        self.thresholds = {
            'pothole': {'deltaY': 3.0, 'deltaZ': 2.5, 'magnitude': 12.0},
            'braking': {'deltaY': 2.0, 'magnitude': 11.0},
            'bump': {'deltaZ': 2.0, 'magnitude': 11.5},
            'vibration': {'variance': 0.8, 'magnitude': 10.5}
        }
        
        # История для расчета дельт и вариации
        self.history_size = 10
        self.device_history: Dict[str, List[Dict]] = {}
    
    def analyze_data_point(
        self,
        device_id: str,
        accel_x: float,
        accel_y: float,
        accel_z: float,
        speed: float
    ) -> Optional[Dict]:
        """
        Анализирует одну точку данных и возвращает классифицированное событие
        
        Returns:
            Dict с событием или None если событие не обнаружено
        """
        
        # Инициализация истории для устройства
        if device_id not in self.device_history:
            self.device_history[device_id] = []
        
        history = self.device_history[device_id]
        
        # Вычисление magnitude
        magnitude = math.sqrt(accel_x**2 + accel_y**2 + accel_z**2)
        
        # Добавляем в историю
        data_point = {
            'x': accel_x,
            'y': accel_y,
            'z': accel_z,
            'magnitude': magnitude,
            'timestamp': datetime.utcnow()
        }
        
        history.append(data_point)
        
        # Ограничиваем размер истории
        if len(history) > self.history_size:
            history.pop(0)
        
        # Нужно минимум 3 точки для анализа
        if len(history) < 3:
            return None
        
        # Вычисляем дельты
        deltaY = accel_y - history[-2]['y']
        deltaZ = accel_z - history[-2]['z']
        deltaX = accel_x - history[-2]['x']
        
        # Вычисляем variance
        if len(history) >= 5:
            magnitudes = [p['magnitude'] for p in history[-5:]]
            mean_magnitude = sum(magnitudes) / len(magnitudes)
            variance = sum((m - mean_magnitude) ** 2 for m in magnitudes) / len(magnitudes)
        else:
            variance = 0
        
        # Определяем тип дороги (упрощенная логика)
        road_type = self._determine_road_type(magnitude, variance, speed)
        
        # Классификация события
        event_type, severity, confidence = self._classify_event(
            magnitude, deltaY, deltaZ, variance, speed
        )
        
        # Возвращаем событие только если оно значимое
        if event_type != 'normal':
            return {
                'eventType': event_type,
                'severity': severity,
                'confidence': confidence,
                'roadType': road_type,
                'accelerometer': {
                    'x': accel_x,
                    'y': accel_y,
                    'z': accel_z,
                    'magnitude': magnitude,
                    'deltaX': deltaX,
                    'deltaY': deltaY,
                    'deltaZ': deltaZ,
                    'variance': variance
                }
            }
        
        return None
    
    def _classify_event(
        self,
        magnitude: float,
        deltaY: float,
        deltaZ: float,
        variance: float,
        speed: float
    ) -> Tuple[str, int, float]:
        """
        Классифицирует событие на основе данных
        
        Returns:
            (event_type, severity, confidence)
        """
        
        # Потенциальная яма (резкое изменение по Y и Z)
        if (abs(deltaY) > self.thresholds['pothole']['deltaY'] and 
            abs(deltaZ) > self.thresholds['pothole']['deltaZ'] and
            magnitude > self.thresholds['pothole']['magnitude']):
            severity = self._calculate_severity(magnitude, 12.0, 16.0)
            return ('pothole', severity, 0.85)
        
        # Резкое торможение (большое изменение по Y при движении)
        if (abs(deltaY) > self.thresholds['braking']['deltaY'] and 
            magnitude > self.thresholds['braking']['magnitude'] and
            speed > 5):
            severity = self._calculate_severity(magnitude, 11.0, 15.0)
            return ('braking', severity, 0.80)
        
        # Неровность/бугор (изменение по Z)
        if (abs(deltaZ) > self.thresholds['bump']['deltaZ'] and 
            magnitude > self.thresholds['bump']['magnitude']):
            severity = self._calculate_severity(magnitude, 11.5, 15.0)
            return ('bump', severity, 0.75)
        
        # Вибрация/плохое покрытие (высокая вариация)
        if (variance > self.thresholds['vibration']['variance'] and 
            magnitude > self.thresholds['vibration']['magnitude']):
            severity = self._calculate_severity(variance, 0.8, 2.0)
            return ('vibration', severity, 0.70)
        
        return ('normal', 5, 0.60)
    
    def _calculate_severity(self, value: float, min_val: float, max_val: float) -> int:
        """Вычисляет severity (1-5) на основе значения"""
        if value < min_val:
            return 5  # Low severity
        elif value > max_val:
            return 1  # Critical severity
        else:
            # Линейная интерполяция
            ratio = (value - min_val) / (max_val - min_val)
            severity = 5 - int(ratio * 4)
            return max(1, min(5, severity))
    
    def _determine_road_type(self, magnitude: float, variance: float, speed: float) -> str:
        """Определяет тип дороги на основе паттернов"""
        if variance > 1.5:
            return 'gravel'
        elif magnitude > 11.0:
            return 'dirt'
        elif variance < 0.3 and magnitude < 10.5:
            return 'asphalt'
        else:
            return 'unknown'
    
    def update_thresholds(self, device_id: str, new_thresholds: Dict):
        """Обновляет пороги для конкретного устройства (адаптация)"""
        # TODO: Реализовать персональные пороги для устройств
        pass


class WarningGenerator:
    """Генератор предупреждений для пользователей"""
    
    def __init__(self):
        self.warning_distance = 200  # метров - расстояние для предупреждения
        self.warning_ttl = timedelta(hours=1)  # Время жизни предупреждения
    
    def should_warn_user(
        self,
        user_lat: float,
        user_lng: float,
        event_lat: float,
        event_lng: float,
        event_type: str,
        severity: int
    ) -> Tuple[bool, float]:
        """
        Определяет нужно ли предупредить пользователя
        
        Returns:
            (should_warn, distance)
        """
        distance = self._calculate_distance(user_lat, user_lng, event_lat, event_lng)
        
        # Предупреждаем только о критических событиях в радиусе
        if severity <= 2 and distance <= self.warning_distance:
            return (True, distance)
        
        return (False, distance)
    
    def create_warning_message(self, event_type: str, severity: int, distance: float) -> str:
        """Создает текст предупреждения"""
        severity_text = {
            1: 'КРИТИЧЕСКОЕ',
            2: 'ВЫСОКОЕ',
            3: 'СРЕДНЕЕ'
        }.get(severity, 'НИЗКОЕ')
        
        event_text = {
            'pothole': 'ЯМА',
            'braking': 'РЕЗКОЕ ТОРМОЖЕНИЕ',
            'bump': 'НЕРОВНОСТЬ',
            'vibration': 'ПЛОХОЕ ПОКРЫТИЕ'
        }.get(event_type, 'ОПАСНОСТЬ')
        
        return f"{severity_text}: {event_text} через {int(distance)}м"
    
    def _calculate_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Вычисляет расстояние между координатами (Haversine formula)"""
        R = 6371000  # Радиус Земли в метрах
        
        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lat = math.radians(lat2 - lat1)
        delta_lon = math.radians(lon2 - lon1)
        
        a = (math.sin(delta_lat / 2) ** 2 + 
             math.cos(lat1_rad) * math.cos(lat2_rad) * 
             math.sin(delta_lon / 2) ** 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        
        return R * c
