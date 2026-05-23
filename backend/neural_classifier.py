import numpy as np
import tensorflow as tf
from tensorflow import keras
from sklearn.preprocessing import StandardScaler
from typing import List, Dict, Tuple

class NeuralAccelerometerClassifier:
    """
    Нейросетевой классификатор для анализа данных акселерометра
    """
    
    def __init__(self):
        self.model = None
        self.scaler_x = StandardScaler()
        self.scaler_y = StandardScaler() 
        self.scaler_z = StandardScaler()
        
    def create_model(self, input_shape: Tuple[int, int]):
        """Создает нейронную сеть для классификации событий"""
        model = keras.Sequential([
            # Входной слой
            keras.layers.Input(shape=input_shape),
            
            # Слой внимания (для выделения важных паттернов)
            keras.layers.LSTM(64, return_sequences=True, dropout=0.2),
            keras.layers.LSTM(32, dropout=0.2),
            
            # Полносвязные слои
            keras.layers.Dense(64, activation='relu'),
            keras.layers.Dropout(0.3),
            keras.layers.Dense(32, activation='relu'),
            keras.layers.Dropout(0.2),
            
            # Выходной слой (5 классов: pothole, speed_bump, bump, braking, vibration)
            keras.layers.Dense(5, activation='softmax')
        ])
        
        model.compile(
            optimizer='adam',
            loss='categorical_crossentropy',
            metrics=['accuracy']
        )
        
        self.model = model
        return model
    
    def prepare_data(self, accelerometer_data: List[Dict]) -> np.ndarray:
        """Подготавливает данные для нейросети"""
        if not accelerometer_data:
            return np.array([]).reshape(0, 3)
            
        # Извлекаем значения
        x_values = [d['x'] for d in accelerometer_data]
        y_values = [d['y'] for d in accelerometer_data]
        z_values = [d['z'] for d in accelerometer_data]
        
        # Создаем массив формата (samples, features)
        data_array = np.column_stack((x_values, y_values, z_values))
        
        return data_array
    
    def train(self, X_train: np.ndarray, y_train: np.ndarray):
        """Обучает модель"""
        if X_train.ndim == 2:
            # Преобразуем (samples, features) -> (samples, timesteps=1, features)
            X_train = np.expand_dims(X_train, axis=1)
        elif X_train.ndim != 3:
            raise ValueError(f"Ожидается 2D или 3D массив X_train, получено ndim={X_train.ndim}")
        
        if X_train.shape[2] != 3:
            raise ValueError(f"Ожидается 3 признака (x,y,z), получено {X_train.shape[2]}")
        
        if self.model is None:
            # Автоматическое создание модели
            self.create_model((X_train.shape[1], X_train.shape[2]))
        
        # Обучение
        history = self.model.fit(
            X_train, y_train,
            epochs=50,
            batch_size=32,
            validation_split=0.2,
            verbose=1
        )
        
        return history
    
    def predict(self, accelerometer_data: List[Dict]) -> Tuple[str, float]:
        """
        Предсказывает тип события и уверенность
        
        Returns:
            (event_type, confidence)
        """
        if self.model is None:
            raise ValueError("Модель не обучена")
            
        # Подготовка данных
        data = self.prepare_data(accelerometer_data)
        
        if len(data) == 0:
            return ("unknown", 0.0)
        
        # Предсказание
        predictions = self.model.predict(np.array([data]), verbose=0)
        
        # Определяем класс с наибольшей вероятностью
        max_prob_index = np.argmax(predictions[0])
        confidence = predictions[0][max_prob_index]
        
        # Сопоставляем индекс с типом события
        event_types = ['pothole', 'speed_bump', 'bump', 'braking', 'vibration']
        predicted_type = event_types[max_prob_index] if max_prob_index < len(event_types) else "unknown"
        
        return (predicted_type, float(confidence))
    
    def save_model(self, filepath: str):
        """Сохраняет модель"""
        if self.model is not None:
            self.model.save(filepath)
            
    def load_model(self, filepath: str):
        """Загружает модель"""
        self.model = keras.models.load_model(filepath)

if __name__ == "__main__":
    classifier = NeuralAccelerometerClassifier()
    test_data = [
        {"x": 0.1, "y": 0.2, "z": 9.8},
        {"x": 0.3, "y": -0.5, "z": 9.6},
        {"x": -0.1, "y": 0.8, "z": 10.2},
    ]
    try:
        print(classifier.predict(test_data))
    except Exception as e:
        print(f"Ошибка: {e}")