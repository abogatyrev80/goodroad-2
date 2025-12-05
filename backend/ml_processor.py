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
        # 🆕 ОПТИМИЗИРОВАННЫЕ пороги на основе анализа реальных данных (04.12.2025)
        # Протестировано: успешно обнаружено 10 препятствий (5 лежачих + 5 ям)
        # Baseline: Z=0.440±0.097 м/с², magnitude=1.049±0.044 м/с²
        self.thresholds = {
            # Базовый уровень (из реальных данных)
            'baseline': {
                'z_mean': 0.440,         # Средний уровень Z (телефон ~63° от горизонтали)
                'z_std': 0.097,          # Стандартное отклонение
                'magnitude_mean': 1.049, # Средняя magnitude
                'magnitude_std': 0.044   # Стандартное отклонение magnitude
            },
            
            # 🚧 Лежачий полицейский (средняя скорость + вертикальное отклонение)
            'speed_bump': {
                'deltaZ': 0.145,         # 1.5σ - ПОНИЖЕНО для надёжной детекции
                'magnitude': 1.10,       # mean + 1.2σ
                'max_speed': 12.5,       # м/с (~45 км/ч) - расширено
                'min_speed': 2.8         # м/с (~10 км/ч)
            },
            
            # ⚠️ Яма в дороге (высокая скорость + резкий удар)
            'pothole': {
                'deltaZ': 0.145,         # 1.5σ - ПОНИЖЕНО
                'magnitude': 1.10,       # mean + 1.2σ
                'min_speed': 12.5        # м/с (~45 км/ч) - выше чем speed_bump
            },
            
            # 〰️ Неровность/бугор (любая скорость)
            'bump': {
                'deltaZ': 0.145,         # 1.5σ - базовый порог
                'magnitude': 1.10        # mean + 1.2σ
            },
            
            # 🚗 Резкое торможение (изменение продольного ускорения)
            'braking': {
                'deltaY': 0.15,          # Изменение Y
                'magnitude': 1.10,
                'min_speed': 5.0         # м/с (~18 км/ч)
            },
            
            # 〰️〰️ Вибрация/плохое покрытие (высокая вариативность)
            'vibration': {
                'std_magnitude': 0.08,   # std > 1.8x baseline
                'magnitude': 1.08,
                'min_duration': 2        # минимум 2 секунды вибрации
            },
            
            # 🎯 Уровни серьёзности (severity levels)
            'severity_levels': {
                'critical': 0.291,       # 3.0σ (ΔZ > 0.291)
                'high': 0.243,           # 2.5σ (ΔZ > 0.243)
                'medium': 0.194,         # 2.0σ (ΔZ > 0.194)
                'low': 0.145             # 1.5σ (ΔZ > 0.145)
            }
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
    
    def analyze_accelerometer_array(
        self,
        device_id: str,
        accelerometer_data: List[Dict],
        speed: float
    ) -> Optional[Dict]:
        """
        🆕 Анализирует массив высокочастотных данных акселерометра
        
        Args:
            device_id: ID устройства
            accelerometer_data: Массив значений [{x, y, z, timestamp}, ...]
            speed: Скорость движения
            
        Returns:
            Dict с событием или None если событие не обнаружено
        """
        if not accelerometer_data or len(accelerometer_data) == 0:
            return None
        
        # Извлекаем массивы x, y, z
        x_values = [d['x'] for d in accelerometer_data]
        y_values = [d['y'] for d in accelerometer_data]
        z_values = [d['z'] for d in accelerometer_data]
        
        # Вычисляем агрегированные показатели
        stats = self._compute_accelerometer_stats(x_values, y_values, z_values)
        
        # Определяем тип события на основе статистики
        event = self._classify_from_stats(stats, speed)
        
        if event:
            event['device_id'] = device_id
            event['sample_count'] = len(accelerometer_data)
            event['duration_ms'] = accelerometer_data[-1]['timestamp'] - accelerometer_data[0]['timestamp']
        
        return event
    
    def _compute_accelerometer_stats(
        self,
        x_values: List[float],
        y_values: List[float],
        z_values: List[float]
    ) -> Dict:
        """Вычисляет статистику для массива значений акселерометра"""
        
        # Вычисление magnitude для каждого значения
        magnitudes = [
            math.sqrt(x**2 + y**2 + z**2)
            for x, y, z in zip(x_values, y_values, z_values)
        ]
        
        # Статистика
        stats = {
            # Средние значения
            'mean_x': sum(x_values) / len(x_values),
            'mean_y': sum(y_values) / len(y_values),
            'mean_z': sum(z_values) / len(z_values),
            'mean_magnitude': sum(magnitudes) / len(magnitudes),
            
            # Максимумы и минимумы
            'max_x': max(x_values),
            'min_x': min(x_values),
            'max_y': max(y_values),
            'min_y': min(y_values),
            'max_z': max(z_values),
            'min_z': min(z_values),
            'max_magnitude': max(magnitudes),
            'min_magnitude': min(magnitudes),
            
            # Диапазоны (размах)
            'range_x': max(x_values) - min(x_values),
            'range_y': max(y_values) - min(y_values),
            'range_z': max(z_values) - min(z_values),
            'range_magnitude': max(magnitudes) - min(magnitudes),
            
            # Стандартное отклонение (вибрации)
            'std_x': self._calculate_std(x_values),
            'std_y': self._calculate_std(y_values),
            'std_z': self._calculate_std(z_values),
            'std_magnitude': self._calculate_std(magnitudes),
            
            # Количество пиков (резкие изменения)
            'peaks_count': self._count_peaks(magnitudes, threshold=11.0),
        }
        
        return stats
    
    def _calculate_std(self, values: List[float]) -> float:
        """Вычисляет стандартное отклонение"""
        if len(values) < 2:
            return 0.0
        mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / (len(values) - 1)
        return math.sqrt(variance)
    
    def _count_peaks(self, values: List[float], threshold: float) -> int:
        """Подсчитывает количество пиков выше порога"""
        peaks = 0
        for i in range(1, len(values) - 1):
            if values[i] > threshold and values[i] > values[i-1] and values[i] > values[i+1]:
                peaks += 1
        return peaks
    
    def _classify_from_stats(self, stats: Dict, speed: float) -> Optional[Dict]:
        """
        🆕 Классифицирует событие на основе статистики с калиброванными порогами
        Основано на реальных данных (04.12.2025)
        """
        
        baseline_z = self.thresholds['baseline']['z_mean']
        
        # Вычисляем отклонение Z от базового уровня
        delta_z = stats['max_z'] - baseline_z
        
        # 🎯 СПЕЦИАЛЬНАЯ ЛОГИКА: Лежачий полицейский
        # Характеристика: высокое Z-отклонение при НИЗКОЙ скорости
        speed_bump_threshold = self.thresholds['speed_bump']
        if (delta_z > speed_bump_threshold['deltaZ'] and 
            speed_bump_threshold['min_speed'] < speed < speed_bump_threshold['max_speed'] and
            stats['max_magnitude'] > speed_bump_threshold['magnitude']):
            
            return {
                'event_type': 'speed_bump',
                'severity': self._calculate_severity_from_delta_z(delta_z, 0.25, 0.35),
                'confidence': 0.85,
                'magnitude': stats['max_magnitude'],
                'delta_z': delta_z,
                'speed': speed,
                'note': 'Detected by low speed + high Z deviation'
            }
        
        # Обнаружение ямы: высокое Z-отклонение при ВЫСОКОЙ скорости
        pothole_threshold = self.thresholds['pothole']
        if (delta_z > pothole_threshold['deltaZ'] and 
            speed > pothole_threshold['min_speed'] and
            stats['max_magnitude'] > pothole_threshold['magnitude']):
            
            return {
                'event_type': 'pothole',
                'severity': self._calculate_severity_from_delta_z(delta_z, 0.25, 0.40),
                'confidence': 0.80,
                'magnitude': stats['max_magnitude'],
                'delta_z': delta_z,
                'speed': speed,
                'note': 'Detected by high speed + high Z deviation'
            }
        
        # Обнаружение резкого торможения: большой диапазон в Y
        braking_threshold = self.thresholds['braking']
        if (stats['range_y'] > braking_threshold['deltaY'] and 
            stats['max_magnitude'] > braking_threshold['magnitude'] and 
            speed > braking_threshold['min_speed']):
            
            return {
                'event_type': 'braking',
                'severity': self._calculate_severity(stats['range_y'], 0.15, 0.30),
                'confidence': 0.75,
                'magnitude': stats['max_magnitude'],
                'delta_y': stats['range_y'],
            }
        
        # Обнаружение неровности/бугра: умеренное Z-отклонение
        bump_threshold = self.thresholds['bump']
        if (delta_z > bump_threshold['deltaZ'] and 
            stats['max_magnitude'] > bump_threshold['magnitude']):
            
            return {
                'event_type': 'bump',
                'severity': self._calculate_severity_from_delta_z(delta_z, 0.20, 0.30),
                'confidence': 0.70,
                'magnitude': stats['max_magnitude'],
                'delta_z': delta_z,
            }
        
        # Обнаружение вибраций (плохая дорога): высокая вариативность
        vibration_threshold = self.thresholds['vibration']
        if (stats['std_magnitude'] > vibration_threshold['std_magnitude'] and 
            speed > 3 and
            stats['max_magnitude'] > vibration_threshold['magnitude']):
            
            return {
                'event_type': 'vibration',
                'severity': self._calculate_severity(stats['std_magnitude'], 0.08, 0.15),
                'confidence': 0.65,
                'magnitude': stats['mean_magnitude'],
                'variance': stats['std_magnitude'],
            }
        
        return None
    
    def _calculate_severity_from_delta_z(self, delta_z: float, min_val: float = None, max_val: float = None) -> int:
        """
        🆕 Вычисляет severity (1-5) на основе отклонения Z от baseline
        Использует фиксированные пороги из анализа реальных данных
        
        1 = Critical (ΔZ > 0.291 м/с² = 3.0σ)
        2 = High     (ΔZ > 0.243 м/с² = 2.5σ)
        3 = Medium   (ΔZ > 0.194 м/с² = 2.0σ)
        4 = Low      (ΔZ > 0.145 м/с² = 1.5σ)
        5 = Info     (ΔZ <= 0.145 м/с²)
        """
        levels = self.thresholds['severity_levels']
        
        if delta_z >= levels['critical']:
            return 1  # Critical (3.0σ)
        elif delta_z >= levels['high']:
            return 2  # High (2.5σ)
        elif delta_z >= levels['medium']:
            return 3  # Medium (2.0σ)
        elif delta_z >= levels['low']:
            return 4  # Low (1.5σ)
        else:
            return 5  # Info (< 1.5σ)
    
    def get_thresholds(self) -> Dict:
        """Возвращает текущие пороги чувствительности"""
        return self.thresholds.copy()
    
    def update_thresholds(self, new_thresholds: Dict):
        """Обновляет пороги чувствительности"""
        for event_type, thresholds in new_thresholds.items():
            if event_type in self.thresholds:
                self.thresholds[event_type].update(thresholds)
        print(f"✅ Пороги обновлены: {self.thresholds}")


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
