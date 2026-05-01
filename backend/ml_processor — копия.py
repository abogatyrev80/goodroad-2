from typing import List, Dict, Tuple, Optional
import numpy as np

# ===============================================================
# I. ДЕТЕКТОРЫ: Специализированные модули (Модульность и Чистота)
# Каждый класс отвечает только за один тип дефекта.
# Это делает код масштабируемым.
# ===============================================================

class PotholeDetector:
    """Детектор ям - основан на паттерне резкое падение (Яма) + резкий подъем (Выход)."""
    def __init__(self, threshold: float = 0.04):
        self.threshold = threshold

    def detect(self, z_values: List[float]) -> Tuple[bool, float]:
        if len(z_values) < 5:
            return False, 0.0

        max_pothole_intensity = 0.0
        for i in range(2, len(z_values) - 2):
            # Вычисляем скорость изменения (производная)
            falling_rate = z_values[i] - z_values[i-2]
            rising_rate = z_values[i+2] - z_values[i]

            # Паттерн ямы: резкое падение вниз + резкий выход вверх
            if falling_rate < -self.threshold and rising_rate > self.threshold:
                pothole_intensity = abs(falling_rate) + rising_rate
                max_pothole_intensity = max(max_pothole_intensity, pothole_intensity)

        return max_pothole_intensity > 0.0, max_pothole_intensity


class SpeedBumpDetector:
    """Детектор бугров - основан на паттерне подъем (Въезд) + спуск (Съезд)."""
    def __init__(self, threshold: float = 0.04):
        # Порог остается параметром, который может быть настроен по мере адаптации
        self.threshold = threshold

    def detect(self, z_values: List[float]) -> Tuple[bool, float]:
        if len(z_values) < 5:
            return False, 0.0

        max_bump_intensity = 0.0
        for i in range(2, len(z_values) - 2):
            # Паттерн бугра: резкий подъем (въезд) + резкое падение (съезд)
            rising_rate = z_values[i] - z_values[i-2] # Должно быть ПОЛОЖИТЕЛЬНЫМ
            falling_rate = z_values[i+2] - z_values[i] # Должно быть ОТРИЦАТЕЛЬНЫМ

            # Логика: Удар в обе стороны, что характерно для бугра.
            if rising_rate > 0.1 * self.threshold and falling_rate < -0.1 * self.threshold:
                bump_intensity = abs(rising_rate) + abs(falling_rate)
                max_bump_intensity = max(max_bump_intensity, bump_intensity)

        return max_bump_intensity > 0.0, max_bump_intensity


class VibrationDetector:
    """Детектор вибрации - основан на частоте изменения направления (Цитировано из Citation 2)."""
    def __init__(self, min_freq: float = 0.3):
        self.min_freq = min_freq

    def detect(self, magnitude_values: List[float]) -> Tuple[bool, float]:
        if len(magnitude_values) < 10:
            return False, 0.0

        direction_changes = 0
        for i in range(1, len(magnitude_values) - 1):
            prev_diff = magnitude_values[i] - magnitude_values[i-1]
            next_diff = magnitude_values[i+1] - magnitude_values[i]

            # Изменение направления: знак разности меняется.
            if prev_diff * next_diff < 0:
                direction_changes += 1

        vibration_frequency = direction_changes / len(magnitude_values)
        return vibration_frequency > self.min_freq, vibration_frequency


# ===============================================================
# II. АНАЛИЗАТОР: Оркестратор (Принятие решения и Взвешивание)
# Это главный класс, который связывает все детекторы вместе.
# ===============================================================

class RoadDefectAnalyzer:
    """
    Главный процессор. Он принимает сырые данные от разных источников 
    и использует взвешенную систему для принятия итогового решения.
    """
    def __init__(self):
        # Инициализация модулей детекции
        self.pothole_detector = PotholeDetector()
        self.speedbump_detector = SpeedBumpDetector()
        self.vibration_analyzer = VibrationDetector()

    def _calculate_weighted_score(self, base_score: float, magnitude: float, bonus_multiplier: float) -> float:
        """Вычисляемый балл с учетом физической интенсивности (Magnitude)."""
        # Это замена жесткому присвоению confidence = 0.90
        return base_score + (magnitude * bonus_multiplier)

    def analyze(self, speed: float, deltaZ: float, deltaY: float, magnitude_values: List[float], z_values: List[float]) -> Dict:
        """
        Запускает анализ всех паттернов и возвращает наиболее вероятный дефект.
        """
        results = {}

        # 1. Анализ Ям (Highest Priority)
        pothole_detected, intensity = self.pothole_detector.detect(z_values)
        if pothole_detected:
            # Используем magnitude для взвешивания результата
            score = self._calculate_weighted_score(1.25, np.mean(magnitude_values), 1.3)
            results['pothole'] = {'severity': score, 'confidence': 0.90, 'details': f"Интенсивность: {intensity:.2f}"}

        # 2. Анализ Бугров (Speed Bump)
        detected, intensity = self.speedbump_detector.detect(z_values)
        if detected:
            score = self._calculate_weighted_score(1.15, np.mean(magnitude_values), 1.2)
            results['speed_bump'] = {'severity': score, 'confidence': 0.85, 'details': f"Интенсивность: {intensity:.2f}"}

        # 3. Анализ Вибраций (Вне зависимости от Z-оси)
        is_vibrate, freq = self.vibration_analyzer.detect(magnitude_values)
        if is_vibrate:
            score = self._calculate_weighted_score(0.7, np.mean(magnitude_values), 0.5)
            results['vibration'] = {'severity': score, 'confidence': 0.80, 'details': f"Вибрация ({freq*100:.0f}%)"}

        # Финальный вердикт: самый высокий балл побеждает
        if not results:
            return {
                'event_type': 'none', 
                'severity': 0.0, 
                'confidence': 1.0, 
                'details': 'Покрытие в норме.'
            }
        else:
            best_defect = max(results, key=lambda k: results[k]['severity'])
            final_result = results[best_defect]
            return {
                'event_type': best_defect,
                'severity': final_result['severity'],
                'confidence': final_result['confidence'],
                'details': final_result['details']
            }

#==============================================================
# III. ТЕСТИРОВАНИЕ СИСТЕМЫ (Демонстрация работы)
# ===============================================================

def generate_dummy_data(pothole: bool, vibration: bool):
    """Генерирует набор данных для имитации реальных условий."""
    np.random.seed(42) # Для воспроизводимости
    base_z = np.sin(np.linspace(0, 5, 30)) * 0.1 + 0.4 # Базовая синусоида (покрытие)
    
    # Изменяем Z-данные для имитации ямы (если нужно)
    if pothole:
        base_z[10:20] -= 0.6  # Резкое падение в диапазоне 10-20 точек
    
    # Создание массивов данных
    z_values = base_z.tolist()
    magnitude_values = np.random.normal(loc=1.0, scale=0.05, size=len(base_z)).tolist()

    if vibration:
        # Имитация вибрации за счет случайных пиков magnitude в нужных местах
        for i in range(5, 25):
             magnitude_values[i] += np.random.uniform(-0.3, 0.3)


# --- СЦЕНАРИЙ 1: Яма (Успешный запуск детектора ям) ---
print("=====================================================")
print("--- ТЕСТ-СЦЕНАРИЙ 1: Обнаружение ЯМЫ (Позитивный тест)")
z_pothole = generate_dummy_data(pothole=True, vibration=False)['z_values']

analyzer = RoadDefectAnalyzer()
result = analyzer.analyze(speed=15.0, deltaZ=0.0, deltaY=0.0, magnitude_values=np.random.normal(loc=1.0, scale=0.04, size=30).tolist(), z_values=z_pothole)

print("\n[РЕЗУЛЬТАТ] ->", result['event_type'], ": ", result['details'])
print(f"   Вероятность (Severity): {result['severity']:.2f} | Доверие: {result['confidence']*100:.0f}%")

# --- СЦЕНАРИЙ 2: Ноль дефектов (Negative test) ---
print("\n=====================================================")
print("--- ТЕСТ-СЦЕНАРИЙ 2: Нормальное покрытие (Нет дефектов)")
z_normal = generate_dummy_data(pothole=False, vibration=False)['z_values']

analyzer = RoadDefectAnalyzer() # Переинициализация для чистоты теста
result = analyzer.analyze(speed=15.0, deltaZ=0.0, deltaY=0.0, magnitude_values=np.random.normal(loc=1.0, scale=0.04, size=30).tolist(), z_values=z_normal)

print("\n[РЕЗУЛЬТАТ] ->", result['event_type'], ": ", result['details'])
