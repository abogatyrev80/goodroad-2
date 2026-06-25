"""
ML Processor для анализа сырых данных и классификации событий
Портирует логику из EventDetector.ts на Python для серверной обработки
"""

import logging
import math
import os
import time
from typing import List, Dict, Tuple, Optional
from datetime import datetime, timedelta

from services.geo import calculate_distance
from ml_stats import get_ml_stats_tracker

logger = logging.getLogger(__name__)


class EventClassifier:
    """Классификатор событий на основе данных акселерометра"""
    
    def __init__(self):
        # ОПТИМИЗИРОВАННЫЕ пороги (08.12.2025)
        # Обновлено: повышены пороги для уменьшения ложных срабатываний
        # Baseline: Z=0.440±0.097 м/с², magnitude=1.049±0.044 м/с²
        self.thresholds = {
            # Базовый уровень (из реальных данных)
            'baseline': {
                'z_mean': 0.440,         # Средний уровень Z (телефон ~63° от горизонтали)
                'z_std': 0.097,          # Стандартное отклонение
                'magnitude_mean': 1.049, # Средняя magnitude
                'magnitude_std': 0.044   # Стандартное отклонение magnitude
            },
            
            # 〰️ Неровность/бугор (самый частый тип - базовый порог)
            'bump': {
                'deltaZ': 0.35,          # ПОВЫШЕНО ДО 0.35 (было 0.20) - СТРОЖЕ!
                'magnitude': 1.25,       # ПОВЫШЕНО до 1.25 (было 1.15)
                'min_speed': 2.0         # минимум 7 км/ч
            },
            
            # 🚧 Лежачий полицейский (средняя скорость + плавное изменение)
            'speed_bump': {
                'deltaZ': 0.45,          # ПОВЫШЕНО ДО 0.45 (было 0.30) - СТРОЖЕ!
                'deltaY': 0.20,          # ПОВЫШЕНО до 0.20 (было 0.15)
                'magnitude': 1.35,       # ПОВЫШЕНО до 1.35 (было 1.22)
                'max_speed': 18.0,       # 65 км/ч
                'min_speed': 3.0         # 11 км/ч
            },
            
            # Яма в дороге (высокая скорость + резкий удар)
            'pothole': {
                'deltaZ': 0.55,          # ПОВЫШЕНО ДО 0.55 (было 0.40) - СТРОЖЕ!
                'deltaY': 0.45,          # ПОВЫШЕНО до 0.45 (было 0.35)
                'magnitude': 1.50,       # ПОВЫШЕНО до 1.50 (было 1.35)
                'min_speed': 16.0        # 58 км/ч
            },
            
            # 🚗 Резкое торможение (изменение продольного ускорения)
            'braking': {
                'deltaY': 0.20,          # ПОВЫШЕНО с 0.15
                'magnitude': 1.15,       # ПОВЫШЕНО
                'min_speed': 5.0         # м/с (~18 км/ч)
            },
            
            # 〰️〰️ Вибрация/плохое покрытие (высокая вариативность)
            'vibration': {
                'variance': 0.015,       # Исправлено: было std_magnitude, теперь variance
                'magnitude': 1.12,       # ПОВЫШЕНО
                'min_duration': 2        # минимум 2 секунды вибрации
            },
            
            # Уровни серьёзности (severity levels)
            'severity_levels': {
                'critical': 0.35,        # ПОВЫШЕНО: 3.5σ (ΔZ > 0.35)
                'high': 0.30,            # ПОВЫШЕНО: 3.0σ (ΔZ > 0.30)
                'medium': 0.25,          # ПОВЫШЕНО: 2.5σ (ΔZ > 0.25)
                'low': 0.20              # ПОВЫШЕНО: 2.0σ (ΔZ > 0.20)
            }
        }
        
        # История для расчета дельт и вариации
        self.history_size = 10
        self.device_history: Dict[str, List[Dict]] = {}
        self.neural_classifier = NeuralEventClassifier(
            enabled=True,
            model_path=os.getenv('NEURAL_MODEL_PATH')
        )
    
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
        
        # 1.  ЯМА (самые строгие условия - высокая скорость + резкий удар)
        if (speed >= self.thresholds['pothole']['min_speed'] and
            abs(deltaZ) > self.thresholds['pothole']['deltaZ'] and 
            abs(deltaY) > self.thresholds['pothole']['deltaY'] and
            magnitude > self.thresholds['pothole']['magnitude']):
            severity = self._calculate_severity(magnitude, 1.25, 1.40)
            return ('pothole', severity, 0.90)
        
        # 2. 🚧 ЛЕЖАЧИЙ ПОЛИЦЕЙСКИЙ (средняя скорость + плавное изменение)
        if (self.thresholds['speed_bump']['min_speed'] <= speed <= self.thresholds['speed_bump']['max_speed'] and
            abs(deltaZ) > self.thresholds['speed_bump']['deltaZ'] and
            magnitude > self.thresholds['speed_bump']['magnitude']):
            severity = self._calculate_severity(magnitude, 1.15, 1.30)
            return ('speed_bump', severity, 0.85)
        
        # 3. 🚗 РЕЗКОЕ ТОРМОЖЕНИЕ (продольное изменение)
        if (speed > self.thresholds['braking']['min_speed'] and
            abs(deltaY) > self.thresholds['braking']['deltaY'] and 
            magnitude > self.thresholds['braking']['magnitude']):
            severity = self._calculate_severity(magnitude, 1.10, 1.25)
            return ('braking', severity, 0.80)
        
        # 4. 〰️〰️ ВИБРАЦИЯ (высокая вариация без резких скачков)
        if (variance > self.thresholds['vibration']['variance'] and 
            magnitude > self.thresholds['vibration']['magnitude']):
            severity = self._calculate_severity(variance, 0.015, 0.030)
            return ('vibration', severity, 0.75)
        
        # 5. 〰️ НЕРОВНОСТЬ/БУГОР (базовое отклонение - самое частое)
        if (abs(deltaZ) > self.thresholds['bump']['deltaZ'] and 
            magnitude > self.thresholds['bump']['magnitude']):
            severity = self._calculate_severity(magnitude, 1.08, 1.20)
            return ('bump', severity, 0.70)
        
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
        Анализирует массив высокочастотных данных акселерометра
        
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
        
        # Анализируем паттерны (форма сигнала)
        patterns = self._analyze_patterns(x_values, y_values, z_values)
        stats['patterns'] = patterns  # Добавляем результаты анализа паттернов в stats
        
        min_neural_conf = float(os.getenv("NEURAL_MIN_CONFIDENCE", "0.35"))

        neural_raw = None
        neural_latency_ms = 0.0
        if self.neural_classifier.is_available():
            t0 = time.perf_counter()
            neural_raw = self.neural_classifier.classify_with_neural_network(
                accelerometer_data, speed
            )
            neural_latency_ms = (time.perf_counter() - t0) * 1000

        neural_event = neural_raw
        if (
            neural_event
            and neural_event.get("confidence", 0) < min_neural_conf
        ):
            neural_event = None

        heuristic_event = self._classify_from_stats(stats, speed)
        heuristic_type = (
            heuristic_event.get("eventType") if heuristic_event else None
        )

        event = neural_event if neural_event else heuristic_event
        final_method = (
            "neural_network"
            if neural_event
            else (
                heuristic_event.get("detection_method", "heuristic")
                if heuristic_event
                else "none"
            )
        )

        tracker = get_ml_stats_tracker()
        if tracker and self.neural_classifier.is_available():
            tracker.record_sync(
                device_id=device_id,
                neural_type=neural_raw.get("eventType") if neural_raw else None,
                neural_confidence=(
                    neural_raw.get("confidence") if neural_raw else None
                ),
                heuristic_type=heuristic_type,
                final_type=event.get("eventType") if event else None,
                final_method=final_method,
                speed=speed,
                sample_count=len(accelerometer_data),
                latency_ms=neural_latency_ms,
            )

        if event:
            event['device_id'] = device_id
            event['sample_count'] = len(accelerometer_data)
            event['duration_ms'] = accelerometer_data[-1]['timestamp'] - accelerometer_data[0]['timestamp']
        
        return event

    def has_neural_network(self) -> bool:
        """Проверяет наличие загруженной нейросетевой модели."""
        return self.neural_classifier.is_available()
    
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
    
    def _detect_pothole_pattern(self, z_values: List[float], threshold: float = 0.04) -> Tuple[bool, float]:
        """
        ДЕТЕКТОР ПАТТЕРНА "ЯМА" (POTHOLE)
        ЯМА: машина ПАДАЕТ ВНИЗ (Z↓), потом ВЫХОДИТ ВВЕРХ (Z↑)
        Паттерн: ↓↓↓ резко вниз (падение в яму) → ↑↑↑ резко вверх (выход из ямы)
        
        Args:
            z_values: массив значений по оси Z
            threshold: минимальная скорость изменения для обнаружения (снижен до 0.04)
            
        Returns:
            (обнаружен, максимальная_интенсивность)
        """
        if len(z_values) < 5:
            return False, 0.0
        
        max_pothole_intensity = 0.0
        
        for i in range(2, len(z_values) - 2):
            # Вычисляем скорость изменения (производная)
            falling_rate = z_values[i] - z_values[i-2]   # Падение в яму (должно быть ОТРИЦАТЕЛЬНЫМ)
            rising_rate = z_values[i+2] - z_values[i]    # Выход из ямы (должно быть ПОЛОЖИТЕЛЬНЫМ)
            
            # Паттерн ямы: резкое падение вниз + резкий выход вверх
            if falling_rate < -threshold and rising_rate > threshold:
                pothole_intensity = abs(falling_rate) + rising_rate
                max_pothole_intensity = max(max_pothole_intensity, pothole_intensity)
        
        detected = max_pothole_intensity > threshold * 1.5  # Снижен порог с 2.0 до 1.5
        return detected, max_pothole_intensity
    
    def _detect_speedbump_pattern(self, z_values: List[float], threshold: float = 0.04) -> Tuple[bool, float]:
        """
        ДЕТЕКТОР ПАТТЕРНА "ЛЕЖАЧИЙ ПОЛИЦЕЙСКИЙ" (SPEED BUMP)
        ЛЕЖАЧИЙ: машина ПОДНИМАЕТСЯ ВВЕРХ (Z↑), потом СПУСКАЕТСЯ ВНИЗ (Z↓)
        Паттерн: ↑↑↑ резко вверх (въезд на бугор) → ↓↓↓ резко вниз (съезд с бугра)
        
        Args:
            z_values: массив значений по оси Z
            threshold: минимальная скорость изменения для обнаружения (снижен до 0.04)
            
        Returns:
            (обнаружен, максимальная_интенсивность)
        """
        if len(z_values) < 5:
            return False, 0.0
        
        max_bump_intensity = 0.0
        
        for i in range(2, len(z_values) - 2):
            # Вычисляем скорость изменения (производная)
            rising_rate = z_values[i] - z_values[i-2]    # Подъем на бугор (должно быть ПОЛОЖИТЕЛЬНЫМ)
            falling_rate = z_values[i+2] - z_values[i]   # Спуск с бугра (должно быть ОТРИЦАТЕЛЬНЫМ)
            
            # Паттерн лежачего: резкий подъем вверх + резкий спуск вниз
            if rising_rate > threshold and falling_rate < -threshold:
                bump_intensity = rising_rate + abs(falling_rate)
                max_bump_intensity = max(max_bump_intensity, bump_intensity)
        
        detected = max_bump_intensity > threshold * 1.5  # Снижен порог с 2.0 до 1.5
        return detected, max_bump_intensity
    
    def _detect_wave_pattern(self, z_values: List[float], threshold: float = 0.06) -> Tuple[bool, float]:
        """
        ДЕТЕКТОР ПАТТЕРНА "ВОЛНА"
        Ищет плавную волну в последовательности (характерно для лежачего полицейского)
        Паттерн: ↗ плавно вверх → ↘ плавно вниз ИЛИ наоборот
        
        Args:
            z_values: массив значений по оси Z
            threshold: минимальный тренд для обнаружения
            
        Returns:
            (обнаружен, амплитуда_волны)
        """
        if len(z_values) < 10:
            return False, 0.0
        
        # Делим массив на 3 части: начало, пик, конец
        third = len(z_values) // 3
        
        start_avg = sum(z_values[:third]) / third
        middle_avg = sum(z_values[third:2*third]) / third
        end_avg = sum(z_values[2*third:]) / (len(z_values) - 2*third)
        
        # Проверяем паттерн "волна": подъем → пик → спуск
        rising_trend = middle_avg - start_avg
        falling_trend = end_avg - middle_avg
        
        # Волна в обоих направлениях:
        # Вариант 1: вверх-вниз (↗↘)
        # Вариант 2: вниз-вверх (↘↗)
        wave_up_down = (rising_trend > threshold and falling_trend < -threshold)
        wave_down_up = (rising_trend < -threshold and falling_trend > threshold)
        
        wave_detected = wave_up_down or wave_down_up
        wave_amplitude = abs(rising_trend) + abs(falling_trend)
        
        return wave_detected, wave_amplitude
    
    def _detect_vibration_pattern(self, magnitude_values: List[float]) -> Tuple[bool, float]:
        """
        ДЕТЕКТОР ПАТТЕРНА "ВИБРАЦИЯ"
        Ищет постоянные высокочастотные колебания (плохое покрытие)
        
        Args:
            magnitude_values: массив значений magnitude
            
        Returns:
            (обнаружен, интенсивность_вибрации)
        """
        if len(magnitude_values) < 10:
            return False, 0.0
        
        # Подсчитываем количество изменений направления (зиг-заг паттерн)
        direction_changes = 0
        for i in range(1, len(magnitude_values) - 1):
            prev_diff = magnitude_values[i] - magnitude_values[i-1]
            next_diff = magnitude_values[i+1] - magnitude_values[i]
            
            # Изменение направления
            if prev_diff * next_diff < 0:
                direction_changes += 1
        
        # Высокая частота изменений = вибрация
        vibration_frequency = direction_changes / len(magnitude_values)
        vibration_detected = vibration_frequency > 0.3  # >30% точек меняют направление
        
        return vibration_detected, vibration_frequency
    
    def _analyze_patterns(self, x_values: List[float], y_values: List[float], z_values: List[float]) -> Dict:
        """
        АНАЛИЗ ВСЕХ ПАТТЕРНОВ
        Анализирует форму сигнала для определения типа события
        
        Returns:
            Dictionary с результатами анализа всех паттернов
        """
        # Вычисляем magnitude для каждого значения
        magnitudes = [
            math.sqrt(x**2 + y**2 + z**2)
            for x, y, z in zip(x_values, y_values, z_values)
        ]
        
        # Детектируем паттерны (ТЕПЕРЬ РАЗДЕЛЬНО для ЯМ и ЛЕЖАЧИХ!)
        pothole_detected, pothole_intensity = self._detect_pothole_pattern(z_values)
        speedbump_detected, speedbump_intensity = self._detect_speedbump_pattern(z_values)
        wave_detected, wave_amplitude = self._detect_wave_pattern(z_values)
        vibration_detected, vibration_freq = self._detect_vibration_pattern(magnitudes)
        
        return {
            'pothole': {
                'detected': pothole_detected,
                'intensity': pothole_intensity,
                'note': f'Pothole pattern (↓↑): падение {pothole_intensity:.2f}' if pothole_detected else None
            },
            'speedbump': {
                'detected': speedbump_detected,
                'intensity': speedbump_intensity,
                'note': f'Speed bump pattern (↑↓): подъем {speedbump_intensity:.2f}' if speedbump_detected else None
            },
            'wave': {
                'detected': wave_detected,
                'amplitude': wave_amplitude,
                'note': f'Wave pattern detected (amplitude={wave_amplitude:.2f})' if wave_detected else None
            },
            'vibration': {
                'detected': vibration_detected,
                'frequency': vibration_freq,
                'note': f'Vibration pattern detected (freq={vibration_freq:.2f})' if vibration_detected else None
            }
        }
    
    def _classify_from_stats(self, stats: Dict, speed: float) -> Optional[Dict]:
        """
        УЛУЧШЕННАЯ классификация на основе статистики + анализа паттернов
        Использует форму сигнала для более точного определения типа события
        """
        
        baseline_z = self.thresholds['baseline']['z_mean']
        
        # Вычисляем отклонение Z от базового уровня
        delta_z = abs(stats['max_z'] - baseline_z)
        
        # ПРИОРИТЕТ 1: АНАЛИЗ ПАТТЕРНОВ (новая логика)
        # Паттерны дают более точную классификацию и работают при низкой скорости
        patterns = stats.get('patterns', {})
        
        if patterns:
            # УЛУЧШЕННАЯ ЛОГИКА: оба паттерна могут быть обнаружены одновременно
            # Выбираем тот, у которого интенсивность выше
            pothole_pattern = patterns.get('pothole', {})
            speedbump_pattern = patterns.get('speedbump', {})
            
            pothole_detected = pothole_pattern.get('detected', False)
            speedbump_detected = speedbump_pattern.get('detected', False)
            pothole_intensity = pothole_pattern.get('intensity', 0)
            speedbump_intensity = speedbump_pattern.get('intensity', 0)
            
            # Если оба паттерна обнаружены - выбираем по интенсивности
            if pothole_detected and speedbump_detected:
                # Если разница менее 15% - предпочитаем speed_bump (чаще встречается)
                intensity_diff = abs(pothole_intensity - speedbump_intensity)
                if intensity_diff < 0.05:  # Разница менее 0.05
                    # Предпочитаем speed_bump если примерно равны
                    detected_type = 'speed_bump'
                    intensity = speedbump_intensity
                else:
                    # Иначе выбираем с большей интенсивностью
                    detected_type = 'speed_bump' if speedbump_intensity > pothole_intensity else 'pothole'
                    intensity = max(speedbump_intensity, pothole_intensity)
            elif speedbump_detected:
                detected_type = 'speed_bump'
                intensity = speedbump_intensity
            elif pothole_detected:
                detected_type = 'pothole'
                intensity = pothole_intensity
            else:
                detected_type = None
                intensity = 0
            
            # 🚧 ЛЕЖАЧИЙ ПОЛИЦЕЙСКИЙ обнаружен
            if detected_type == 'speed_bump':
                # Определяем severity по интенсивности лежачего
                if intensity > 0.40:
                    severity = 1  # Critical
                elif intensity > 0.28:
                    severity = 2  # High
                elif intensity > 0.18:
                    severity = 3  # Medium
                else:
                    severity = 4  # Low
                
                return {
                    'eventType': 'speed_bump',
                    'severity': severity,
                    'confidence': 0.90,  # Очень высокая уверенность
                    'magnitude': stats['max_magnitude'],
                    'delta_z': delta_z,
                    'speedbump_intensity': intensity,
                    'detection_method': 'pattern_analysis',
                    'note': f'Speed bump pattern (↑↓): подъем {intensity:.2f}'
                }
            
            # ЯМА обнаружена
            elif detected_type == 'pothole':
                # Определяем severity по интенсивности ямы
                if intensity > 0.35:
                    severity = 1  # Critical
                elif intensity > 0.28:
                    severity = 2  # High
                elif intensity > 0.18:
                    severity = 3  # Medium
                else:
                    severity = 4  # Low
                
                return {
                    'eventType': 'pothole',
                    'severity': severity,
                    'confidence': 0.88,  # Высокая уверенность для паттернов
                    'magnitude': stats['max_magnitude'],
                    'delta_z': delta_z,
                    'pothole_intensity': intensity,
                    'detection_method': 'pattern_analysis',
                    'note': f'Pothole pattern (↓↑): падение {intensity:.2f}'
                }
            
            # 🌊 ПАТТЕРН "ВОЛНА" - характерно для плавных неровностей
            # Плавный подъем → пик → плавный спуск
            wave_pattern = patterns.get('wave', {})
            if wave_pattern.get('detected', False):
                wave_amplitude = wave_pattern.get('amplitude', 0)
                
                # Определяем severity по амплитуде волны
                if wave_amplitude > 0.24:
                    severity = 1  # Critical
                elif wave_amplitude > 0.18:
                    severity = 2  # High
                elif wave_amplitude > 0.14:
                    severity = 3  # Medium
                else:
                    severity = 4  # Low
                
                return {
                    'eventType': 'wave',
                    'severity': severity,
                    'confidence': 0.85,
                    'magnitude': stats['max_magnitude'],
                    'delta_z': delta_z,
                    'wave_amplitude': wave_amplitude,
                    'detection_method': 'pattern_analysis',
                    'note': wave_pattern.get('note', f'Wave pattern detected (amplitude={wave_amplitude:.3f})')
                }
            
            # 〰️〰️ ПАТТЕРН "ВИБРАЦИЯ" - плохое покрытие
            # Высокочастотные колебания
            vibration_pattern = patterns.get('vibration', {})
            if vibration_pattern.get('detected', False) and speed > 3:
                vibration_frequency = vibration_pattern.get('frequency', 0)
                
                severity = 3 if vibration_frequency > 0.4 else 4
                
                return {
                    'eventType': 'vibration',
                    'severity': severity,
                    'confidence': 0.75,
                    'magnitude': stats['mean_magnitude'],
                    'vibration_frequency': vibration_frequency,
                    'detection_method': 'pattern_analysis',
                    'note': vibration_pattern.get('note', f'Vibration pattern detected (freq={vibration_frequency:.2f})')
                }
        
        # ПРИОРИТЕТ 2: КЛАССИЧЕСКАЯ ЛОГИКА (на основе порогов)
        # Используется если паттерны не обнаружены
        
        # 🚧 ЛЕЖАЧИЙ ПОЛИЦЕЙСКИЙ: средняя скорость (10-45 км/ч) + вертикальное отклонение
        speed_bump_threshold = self.thresholds['speed_bump']
        if (delta_z >= speed_bump_threshold['deltaZ'] and 
            speed_bump_threshold['min_speed'] < speed < speed_bump_threshold['max_speed'] and
            stats['max_magnitude'] >= speed_bump_threshold['magnitude']):
            
            return {
                'eventType': 'speed_bump',
                'severity': self._calculate_severity_from_delta_z(delta_z),
                'confidence': 0.85,
                'magnitude': stats['max_magnitude'],
                'delta_z': delta_z,
                'speed': speed,
                'note': 'Speed bump detected: moderate speed + vertical impact'
            }
        
        # ЯМА: высокая скорость (>45 км/ч) + вертикальное отклонение
        pothole_threshold = self.thresholds['pothole']
        if (delta_z >= pothole_threshold['deltaZ'] and 
            speed >= pothole_threshold['min_speed'] and
            stats['max_magnitude'] >= pothole_threshold['magnitude']):
            
            return {
                'eventType': 'pothole',
                'severity': self._calculate_severity_from_delta_z(delta_z),
                'confidence': 0.80,
                'magnitude': stats['max_magnitude'],
                'delta_z': delta_z,
                'speed': speed,
                'note': 'Pothole detected: high speed + vertical impact'
            }
        
        # 〰️ НЕРОВНОСТЬ: любая скорость, умеренное отклонение
        bump_threshold = self.thresholds['bump']
        if (delta_z >= bump_threshold['deltaZ'] and 
            stats['max_magnitude'] >= bump_threshold['magnitude']):
            
            return {
                'eventType': 'bump',
                'severity': self._calculate_severity_from_delta_z(delta_z),
                'confidence': 0.70,
                'magnitude': stats['max_magnitude'],
                'delta_z': delta_z,
                'note': 'Road bump detected'
            }
        
        # 🚗 ТОРМОЖЕНИЕ: изменение продольного ускорения (Y-ось)
        braking_threshold = self.thresholds['braking']
        if (stats['range_y'] >= braking_threshold['deltaY'] and 
            stats['max_magnitude'] >= braking_threshold['magnitude'] and 
            speed >= braking_threshold['min_speed']):
            
            return {
                'eventType': 'braking',
                'severity': self._calculate_severity(stats['range_y'], 0.15, 0.30),
                'confidence': 0.75,
                'magnitude': stats['max_magnitude'],
                'delta_y': stats['range_y'],
                'note': 'Hard braking detected'
            }
        
        # 〰️〰️ ВИБРАЦИЯ: плохое покрытие, высокая вариативность
        vibration_threshold = self.thresholds['vibration']
        if (stats['std_magnitude'] >= vibration_threshold['variance'] and 
            speed > 3 and
            stats['max_magnitude'] >= vibration_threshold['magnitude']):
            
            return {
                'eventType': 'vibration',
                'severity': self._calculate_severity(stats['std_magnitude'], 0.08, 0.15),
                'confidence': 0.65,
                'magnitude': stats['mean_magnitude'],
                'variance': stats['std_magnitude'],
                'note': 'Poor road surface detected'
            }
        
        return None
    
    def _calculate_severity_from_delta_z(self, delta_z: float, min_val: float = None, max_val: float = None) -> int:
        """
        Вычисляет severity (1-5) на основе отклонения Z от baseline
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
        logger.info("Пороги обновлены: %s", self.thresholds)

class NeuralEventClassifier:
    """
    Класс для интеграции нейросетевого анализа с текущим EventClassifier
    Поддерживает несколько бэкендов: PyTorch, ONNX, Remote GPU
    """
    
    def __init__(self, enabled: bool = True, model_path: Optional[str] = None):
        self.enabled = enabled
        self.model_path = model_path
        self.nn_classifier = None
        self._nn_backend = None
        self._load_error = None
        self._backend = None
        
        if self.enabled:
            self.initialize_neural_network()
        
    def initialize_neural_network(self):
        """Инициализация нейросети с выбором бэкенда."""
        if not self.enabled:
            return
        
        if not self.model_path or not os.path.exists(self.model_path):
            self.nn_classifier = None
            self._load_error = 'Neural model path is not configured or file does not exist'
            return

        path = self.model_path

        use_backend = os.getenv('NN_USE_NN_BACKEND', 'false').lower() == 'true'
        if use_backend:
            try:
                from nn_backend import create_backend
                backend = create_backend()
                backend.load(path)
                self._nn_backend = backend
                self._backend = backend.name
                self._load_error = None
                return
            except Exception as exc:
                self._load_error = f'nn_backend failed: {exc}, falling back to legacy'

        try:
            if path.endswith('.pt'):
                from accel_nn import AccelClassifier

                classifier = AccelClassifier()
                classifier.load(path)
                self.nn_classifier = classifier
                self._backend = 'pytorch'
                return
            if path.endswith('.keras') or os.path.isdir(path):
                from neural_classifier import NeuralAccelerometerClassifier

                classifier = NeuralAccelerometerClassifier()
                classifier.load_model(path)
                self.nn_classifier = classifier
                self._backend = 'keras'
                return
            self.nn_classifier = None
            self._load_error = f'Unsupported model format: {path}'
        except Exception as exc:
            self.nn_classifier = None
            self._load_error = str(exc)
    
    def classify_with_neural_network(self, accelerometer_data: List[Dict], speed: float) -> Optional[Dict]:
        """
        Классификация с использованием нейронной сети
        Возвращает словарь с результатами классификации
        """
        if not self.is_available():
            return None
        
        try:
            if self._nn_backend is not None:
                import numpy as np
                from accel_nn import _pad_or_trim_window

                arr = np.array(
                    [[d["x"], d["y"], d["z"]] for d in accelerometer_data],
                    dtype=np.float32,
                )
                if len(arr) < 1:
                    return None

                window_size = getattr(self._nn_backend, 'window_size', 32)
                window = _pad_or_trim_window(arr, window_size)
                window = window[np.newaxis, ...]

                idx, confidence = self._nn_backend.predict(window)
                from ml_constants import INDEX_TO_EVENT
                event_type = INDEX_TO_EVENT.get(idx, 'unknown')
            else:
                event_type, confidence = self.nn_classifier.predict(accelerometer_data)
        except Exception:
            return None
        
        if event_type in ('unknown', 'normal'):
            return None
        
        if confidence >= 0.90:
            severity = 1
        elif confidence >= 0.80:
            severity = 2
        elif confidence >= 0.70:
            severity = 3
        else:
            severity = 4
        
        return {
            'eventType': event_type,
            'severity': severity,
            'confidence': float(confidence),
            'speed': speed,
            'detection_method': 'neural_network',
            'note': f'Neural classifier detected {event_type} (confidence={confidence:.2f})'
        }

    def is_available(self) -> bool:
        """Возвращает True, если нейросетевая модель успешно загружена."""
        if self._nn_backend is not None:
            return self._nn_backend.is_available()
        if self.nn_classifier is None:
            return False
        if getattr(self, '_backend', None) == 'pytorch':
            return getattr(self.nn_classifier, 'model', None) is not None
        return getattr(self.nn_classifier, 'model', None) is not None

    def get_model_info(self) -> Dict:
        info = {
            "enabled": self.enabled,
            "available": self.is_available(),
            "path": self.model_path,
            "backend": getattr(self, "_backend", None),
            "load_error": self._load_error,
            "min_confidence": float(os.getenv("NEURAL_MIN_CONFIDENCE", "0.35")),
        }
        if self._nn_backend is not None:
            info["backend"] = self._nn_backend.name
        elif self.is_available() and getattr(self, "_backend", None) == "pytorch":
            info["window_size"] = getattr(self.nn_classifier, "window_size", None)
        return info

    def reload(self, model_path: Optional[str] = None) -> Dict:
        if model_path:
            self.model_path = model_path
        self.nn_classifier = None
        self._nn_backend = None
        self._load_error = None
        self._backend = None
        self.initialize_neural_network()
        return self.get_model_info()



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
        
        if distance < 1:
            return f"{severity_text}: {event_text} рядом с вами"
        return f"{severity_text}: {event_text} через {int(distance)}м"
    
    def _calculate_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        return calculate_distance(lat1, lon1, lat2, lon2)
