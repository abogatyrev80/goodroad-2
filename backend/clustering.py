"""
Модуль кластеризации препятствий
Объединяет близкие события от разных устройств в один кластер
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import math
import uuid
from collections import Counter


class ObstacleClusterer:
    """
    Класс для кластеризации событий о препятствиях
    """
    
    def __init__(self, db):
        self.db = db
        self.CLUSTER_RADIUS = 3.0   # метров - УМЕНЬШЕНО до 3м для точной группировки (было 8, потом 15, потом 20)
        self.DEFAULT_TTL_DAYS = 15  # дней - время жизни кластера
        self.MIN_CONFIDENCE = 0.80  # минимальная уверенность для нового кластера (повышено с 0.70)
        self.MIN_REPORT_COUNT = 3  # минимум отчётов для "подтверждённого" кластера
        self.CONFIDENCE_INCREMENT = 0.05  # прирост уверенности за каждое подтверждение
        
    def haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """
        Вычисляет расстояние между двумя GPS координатами (формула Haversine)
        Возвращает расстояние в метрах
        """
        R = 6371000  # Радиус Земли в метрах
        
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)
        
        a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        
        return R * c
    
    async def find_nearby_cluster(
        self, 
        latitude: float, 
        longitude: float, 
        event_type: str
    ) -> Optional[Dict]:
        """
        Находит ближайший активный кластер в радиусе CLUSTER_RADIUS метров
        
        Args:
            latitude: широта события
            longitude: долгота события
            event_type: тип события (для фильтрации похожих)
            
        Returns:
            Кластер или None если не найден
        """
        # Получаем все активные кластеры
        clusters = await self.db.obstacle_clusters.find({
            "status": "active"
        }).to_list(length=None)
        
        # Ищем ближайший кластер в радиусе
        nearest_cluster = None
        min_distance = float('inf')
        
        for cluster in clusters:
            distance = self.haversine_distance(
                latitude, longitude,
                cluster['location']['latitude'],
                cluster['location']['longitude']
            )
            
            if distance < self.CLUSTER_RADIUS and distance < min_distance:
                # Проверяем совместимость типов событий
                if self._are_types_compatible(event_type, cluster['obstacleType']):
                    min_distance = distance
                    nearest_cluster = cluster
        
        return nearest_cluster
    
    def _are_types_compatible(self, type1: str, type2: str) -> bool:
        """
        Проверяет совместимы ли два типа событий для объединения в кластер
        """
        # Группы совместимых типов
        compatible_groups = [
            {'pothole', 'bump'},           # Ямы и неровности
            {'speed_bump'},                # Лежачие полицейские (отдельно)
            {'braking'},                   # Торможения (отдельно)
            {'vibration'},                 # Вибрации (отдельно)
        ]
        
        for group in compatible_groups:
            if type1 in group and type2 in group:
                return True
        
        return False
    
    def _calculate_confidence(self, report_count: int) -> float:
        """
        Вычисляет уверенность на основе количества подтверждений
        
        Formula: confidence = 0.70 + (reportCount - 1) * 0.05
        Max: 0.99
        """
        confidence = self.MIN_CONFIDENCE + (report_count - 1) * self.CONFIDENCE_INCREMENT
        return min(0.99, confidence)
    
    def _determine_obstacle_type(self, event_types: List[str]) -> str:
        """
        Определяет консолидированный тип препятствия на основе всех событий
        
        Логика:
        - Если 70%+ событий одного типа → этот тип
        - Иначе → самый опасный тип
        """
        if not event_types:
            return 'unknown'
        
        type_counts = Counter(event_types)
        total = len(event_types)
        most_common_type, most_common_count = type_counts.most_common(1)[0]
        
        # Если 70%+ одного типа
        if most_common_count / total >= 0.7:
            return most_common_type
        
        # Иначе выбираем самый опасный
        danger_order = ['pothole', 'speed_bump', 'bump', 'braking', 'vibration']
        for danger_type in danger_order:
            if danger_type in type_counts:
                return danger_type
        
        return most_common_type
    
    async def create_cluster(
        self,
        event: Dict,
        device_id: str
    ) -> str:
        """
        Создает новый кластер препятствий
        
        Args:
            event: событие (с полями eventType, severity, confidence, latitude, longitude, speed)
            device_id: ID устройства
            
        Returns:
            ID созданного кластера
        """
        cluster_id = str(uuid.uuid4())
        
        cluster = {
            "_id": cluster_id,
            "obstacleType": event['eventType'],
            "location": {
                "latitude": event['latitude'],
                "longitude": event['longitude'],
                "radius": self.CLUSTER_RADIUS
            },
            "severity": {
                "average": event['severity'],
                "max": event['severity'],
                "min": event['severity'],
                "mode": event['severity'],
                "history": [event['severity']]  # История для вычисления mode
            },
            "confidence": self._calculate_confidence(1),
            "reportCount": 1,
            "devices": [device_id],
            "firstReported": datetime.utcnow(),
            "lastReported": datetime.utcnow(),
            "status": "active",
            "expiresAt": datetime.utcnow() + timedelta(days=self.DEFAULT_TTL_DAYS),
            "verifiedBy": None,
            "roadInfo": {
                "avgSpeed": event['speed'],
                "speedVariance": 0,
                "speeds": [event['speed']]  # История скоростей
            },
            "created_at": datetime.utcnow()
        }
        
        await self.db.obstacle_clusters.insert_one(cluster)
        print(f"✅ Создан новый кластер {cluster_id}: {event['eventType']} at ({event['latitude']:.5f}, {event['longitude']:.5f})")
        
        return cluster_id
    
    async def update_cluster(
        self,
        cluster: Dict,
        event: Dict,
        device_id: str
    ) -> str:
        """
        Обновляет существующий кластер новым событием
        
        Args:
            cluster: существующий кластер
            event: новое событие
            device_id: ID устройства
            
        Returns:
            ID кластера
        """
        cluster_id = cluster['_id']
        
        # Обновляем счетчик отчетов
        new_report_count = cluster['reportCount'] + 1
        
        # Добавляем устройство если уникальное
        devices = cluster['devices']
        if device_id not in devices:
            devices.append(device_id)
        
        # Обновляем severity
        severity_history = cluster['severity']['history']
        severity_history.append(event['severity'])
        
        severity_counter = Counter(severity_history)
        mode_severity = severity_counter.most_common(1)[0][0]
        
        new_severity = {
            "average": sum(severity_history) / len(severity_history),
            "max": min(cluster['severity']['max'], event['severity']),  # min потому что 1=critical, 5=info
            "min": max(cluster['severity']['min'], event['severity']),
            "mode": mode_severity,
            "history": severity_history
        }
        
        # Обновляем информацию о дороге
        speeds = cluster['roadInfo']['speeds']
        speeds.append(event['speed'])
        
        avg_speed = sum(speeds) / len(speeds)
        speed_variance = sum((s - avg_speed)**2 for s in speeds) / len(speeds)
        
        new_road_info = {
            "avgSpeed": avg_speed,
            "speedVariance": speed_variance,
            "speeds": speeds
        }
        
        # Пересчитываем тип препятствия (может измениться с новыми данными)
        all_types = [cluster['obstacleType']] * (new_report_count - 1) + [event['eventType']]
        new_obstacle_type = self._determine_obstacle_type(all_types)
        
        # Обновляем кластер
        await self.db.obstacle_clusters.update_one(
            {"_id": cluster_id},
            {
                "$set": {
                    "obstacleType": new_obstacle_type,
                    "severity": new_severity,
                    "confidence": self._calculate_confidence(new_report_count),
                    "reportCount": new_report_count,
                    "devices": devices,
                    "lastReported": datetime.utcnow(),
                    "expiresAt": datetime.utcnow() + timedelta(days=self.DEFAULT_TTL_DAYS),  # Обновить TTL
                    "roadInfo": new_road_info
                }
            }
        )
        
        print(f"✅ Обновлен кластер {cluster_id}: reportCount={new_report_count}, confidence={self._calculate_confidence(new_report_count):.2f}")
        
        return cluster_id
    
    async def process_event(
        self,
        event: Dict,
        device_id: str
    ) -> str:
        """
        Обрабатывает событие: находит кластер или создает новый
        
        Args:
            event: событие с полями eventType, severity, latitude, longitude, speed, etc.
            device_id: ID устройства
            
        Returns:
            ID кластера (новый или существующий)
        """
        # Ищем ближайший кластер
        nearby_cluster = await self.find_nearby_cluster(
            event['latitude'],
            event['longitude'],
            event['eventType']
        )
        
        if nearby_cluster:
            # Обновляем существующий кластер
            cluster_id = await self.update_cluster(nearby_cluster, event, device_id)
        else:
            # Создаем новый кластер
            cluster_id = await self.create_cluster(event, device_id)
        
        return cluster_id
    
    async def get_active_clusters(self, limit: int = 1000) -> List[Dict]:
        """
        Получает все активные кластеры
        """
        clusters = await self.db.obstacle_clusters.find({
            "status": "active",
            "expiresAt": {"$gt": datetime.utcnow()}
        }).sort("lastReported", -1).limit(limit).to_list(length=None)
        
        return clusters
    
    async def expire_old_clusters(self):
        """
        Помечает устаревшие кластеры как expired
        """
        result = await self.db.obstacle_clusters.update_many(
            {
                "status": "active",
                "expiresAt": {"$lt": datetime.utcnow()}
            },
            {
                "$set": {"status": "expired"}
            }
        )
        
        if result.modified_count > 0:
            print(f"⏰ Помечено {result.modified_count} кластеров как expired")
        
        return result.modified_count
