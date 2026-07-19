"""
Admin API - Endpoints для управления данными
Редактирование, фильтрация, удаление кластеров и событий
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorDatabase
import logging
import config as _config

logger = logging.getLogger(__name__)

# Модели данных
class ClusterUpdate(BaseModel):
    """Модель для обновления кластера"""
    obstacleType: Optional[str] = None
    severity_max: Optional[int] = None
    severity_min: Optional[int] = None
    severity_average: Optional[float] = None
    confidence: Optional[float] = None
    status: Optional[str] = None  # 'active', 'expired', 'verified', 'rejected'
    notes: Optional[str] = None

class EventUpdate(BaseModel):
    """Модель для обновления события"""
    eventType: Optional[str] = None
    severity: Optional[int] = None
    confidence: Optional[float] = None
    verified: Optional[bool] = None
    notes: Optional[str] = None

class BulkDeleteRequest(BaseModel):
    """Модель для массового удаления"""
    ids: List[str]
    reason: Optional[str] = None

class BulkUpdateEventsRequest(BaseModel):
    """Массовое обновление событий"""
    ids: List[str]
    eventType: Optional[str] = None
    severity: Optional[int] = None
    notes: Optional[str] = None

class BulkUpdateClustersRequest(BaseModel):
    """Массовое обновление кластеров"""
    ids: List[str]
    obstacleType: Optional[str] = None
    status: Optional[str] = None
    severity_max: Optional[int] = None
    notes: Optional[str] = None

class FilteredQueryRequest(BaseModel):
    """Запрос с фильтрами для выборки"""
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    event_types: Optional[List[str]] = None
    min_severity: Optional[int] = None
    max_severity: Optional[int] = None
    min_confidence: Optional[float] = None
    limit: int = 50000

class SeverityMetrics(BaseModel):
    """Метрики для понимания severity"""
    severity_level: int
    description_ru: str
    description_en: str
    impact_description: str
    magnitude_range: str
    delta_z_range: str
    typical_damage: str
    recommended_speed: int

# Создаем роутер
admin_editor_router = APIRouter(prefix="/api/admin/editor", tags=["Admin Editor"])

# ====================================
# SEVERITY METRICS - Критерии оценки
# ====================================

# Детальные критерии severity для понимания
SEVERITY_METRICS: List[SeverityMetrics] = [
    SeverityMetrics(
        severity_level=1,
        description_ru="Критическая опасность",
        description_en="Critical Danger",
        impact_description="Очень большая яма или препятствие. Высокий риск повреждения автомобиля.",
        magnitude_range=">1.4 м/с² или deltaZ >0.35",
        delta_z_range=">0.35 м/с² вертикального ускорения",
        typical_damage="Повреждение подвески, колес, днища",
        recommended_speed=20
    ),
    SeverityMetrics(
        severity_level=2,
        description_ru="Высокая опасность",
        description_en="High Danger",
        impact_description="Большая яма или лежачий полицейский. Риск повреждения при высокой скорости.",
        magnitude_range="1.25-1.4 м/с² или deltaZ 0.25-0.35",
        delta_z_range="0.25-0.35 м/с²",
        typical_damage="Возможно повреждение подвески",
        recommended_speed=30
    ),
    SeverityMetrics(
        severity_level=3,
        description_ru="Средняя опасность",
        description_en="Medium Danger",
        impact_description="Заметная неровность. Дискомфорт для пассажиров.",
        magnitude_range="1.15-1.25 м/с² или deltaZ 0.18-0.25",
        delta_z_range="0.18-0.25 м/с²",
        typical_damage="Дискомфорт, износ подвески",
        recommended_speed=40
    ),
    SeverityMetrics(
        severity_level=4,
        description_ru="Низкая опасность",
        description_en="Low Danger",
        impact_description="Небольшая неровность. Минимальный дискомфорт.",
        magnitude_range="1.05-1.15 м/с² или deltaZ 0.12-0.18",
        delta_z_range="0.12-0.18 м/с²",
        typical_damage="Легкий дискомфорт",
        recommended_speed=50
    ),
    SeverityMetrics(
        severity_level=5,
        description_ru="Минимальная",
        description_en="Minimal",
        impact_description="Едва заметная неровность.",
        magnitude_range="<1.05 м/с² или deltaZ <0.12",
        delta_z_range="<0.12 м/с²",
        typical_damage="Практически не заметно",
        recommended_speed=60
    )
]

@admin_editor_router.get("/severity-metrics")
async def get_severity_metrics():
    """Получить детальные критерии severity для понимания масштаба"""
    return {
        "metrics": [m.model_dump() for m in SEVERITY_METRICS],
        "explanation": {
            "ru": "Severity (тяжесть) определяется на основе анализа данных акселерометра. "
                  "Чем больше вертикальное ускорение (deltaZ) и общая magnitude, тем выше опасность.",
            "en": "Severity is determined based on accelerometer data analysis. "
                  "Higher vertical acceleration (deltaZ) and magnitude indicate greater danger."
        }
    }

# ====================================
# CLUSTERS - Управление кластерами
# ====================================

def init_admin_editor_routes():
    """Инициализация маршрутов (БД берётся из config через _config.db)"""
    
    @admin_editor_router.get("/clusters/{cluster_id}")
    async def get_cluster_detail(cluster_id: str):
        """Получить детальную информацию о кластере"""
        cluster = await _config.db.obstacle_clusters.find_one({"_id": cluster_id})
        
        if not cluster:
            raise HTTPException(status_code=404, detail="Cluster not found")
        
        # Получаем связанные события
        events = await _config.db.processed_events.find(
            {"clusterId": cluster_id}
        ).sort("timestamp", -1).to_list(100)
        
        # Вычисляем дополнительную статистику
        cluster['_id'] = str(cluster['_id'])
        cluster['events_count'] = len(events)
        cluster['events'] = events
        
        return cluster
    
    @admin_editor_router.put("/clusters/{cluster_id}")
    async def update_cluster(cluster_id: str, update: ClusterUpdate):
        """Обновить параметры кластера"""
        update_data = update.dict(exclude_unset=True)
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        # Добавляем метаданные об изменении
        update_data['lastModified'] = datetime.utcnow()
        update_data['manuallyEdited'] = True
        
        # Обновляем severity если указано
        if any(k in update_data for k in ['severity_max', 'severity_min', 'severity_average']):
            severity_update = {}
            if 'severity_max' in update_data:
                severity_update['max'] = update_data.pop('severity_max')
            if 'severity_min' in update_data:
                severity_update['min'] = update_data.pop('severity_min')
            if 'severity_average' in update_data:
                severity_update['average'] = update_data.pop('severity_average')
            
            if severity_update:
                update_data['severity'] = severity_update
        
        result = await _config.db.obstacle_clusters.update_one(
            {"_id": cluster_id},
            {"$set": update_data}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Cluster not found")
        
        logger.info("Cluster %s updated manually: %s", cluster_id, list(update_data.keys()))
        
        return {"success": True, "updated_fields": list(update_data.keys())}
    
    @admin_editor_router.delete("/clusters/{cluster_id}")
    async def delete_cluster(cluster_id: str, reason: Optional[str] = None):
        """Удалить кластер"""
        # Сначала получаем кластер для логирования
        cluster = await _config.db.obstacle_clusters.find_one({"_id": cluster_id})
        
        if not cluster:
            raise HTTPException(status_code=404, detail="Cluster not found")
        
        # Удаляем кластер
        await _config.db.obstacle_clusters.delete_one({"_id": cluster_id})
        
        # Убираем clusterId из связанных событий
        await _config.db.processed_events.update_many(
            {"clusterId": cluster_id},
            {"$unset": {"clusterId": ""}}
        )
        
        logger.info("Cluster %s deleted. Reason: %s", cluster_id, reason or 'Not specified')
        
        return {"success": True, "deleted_id": cluster_id}
    
    @admin_editor_router.post("/clusters/bulk-delete")
    async def bulk_delete_clusters(request: BulkDeleteRequest):
        """Массовое удаление кластеров"""
        if not request.ids:
            raise HTTPException(status_code=400, detail="No IDs provided")
        
        # Удаляем кластеры
        result = await _config.db.obstacle_clusters.delete_many(
            {"_id": {"$in": request.ids}}
        )
        
        # Убираем clusterId из событий
        await _config.db.processed_events.update_many(
            {"clusterId": {"$in": request.ids}},
            {"$unset": {"clusterId": ""}}
        )
        
        logger.info("Bulk deleted %d clusters. Reason: %s", result.deleted_count, request.reason or 'Not specified')
        
        return {
            "success": True,
            "deleted_count": result.deleted_count
        }
    
    # ====================================
    # EVENTS - Управление событиями
    # ====================================
    
    @admin_editor_router.get("/events/{event_id}")
    async def get_event_detail(event_id: str):
        """Получить детальную информацию о событии"""
        event = await _config.db.processed_events.find_one({"id": event_id})
        
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        
        # Получаем связанный кластер если есть
        if event.get('clusterId'):
            cluster = await _config.db.obstacle_clusters.find_one({"_id": event['clusterId']})
            if cluster:
                event['cluster'] = cluster
        
        return event
    
    @admin_editor_router.put("/events/{event_id}")
    async def update_event(event_id: str, update: EventUpdate):
        """Обновить параметры события"""
        update_data = update.dict(exclude_unset=True)
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        update_data['lastModified'] = datetime.utcnow()
        update_data['manuallyEdited'] = True
        
        result = await _config.db.processed_events.update_one(
            {"id": event_id},
            {"$set": update_data}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Event not found")
        
        logger.info("Event %s updated manually: %s", event_id, list(update_data.keys()))
        
        return {"success": True, "updated_fields": list(update_data.keys())}
    
    @admin_editor_router.delete("/events/{event_id}")
    async def delete_event(event_id: str, reason: Optional[str] = None):
        """Удалить событие"""
        result = await _config.db.processed_events.delete_one({"id": event_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Event not found")
        
        logger.info("Event %s deleted. Reason: %s", event_id, reason or 'Not specified')
        
        return {"success": True, "deleted_id": event_id}
    
    @admin_editor_router.post("/events/bulk-delete")
    async def bulk_delete_events(request: BulkDeleteRequest):
        """Массовое удаление событий"""
        if not request.ids:
            raise HTTPException(status_code=400, detail="No IDs provided")
        
        result = await _config.db.processed_events.delete_many(
            {"id": {"$in": request.ids}}
        )
        
        logger.info("Bulk deleted %d events. Reason: %s", result.deleted_count, request.reason or 'Not specified')
        
        return {
            "success": True,
            "deleted_count": result.deleted_count
        }
    
    @admin_editor_router.post("/events/bulk-update")
    async def bulk_update_events(request: BulkUpdateEventsRequest):
        """Массовое обновление событий (тип, severity, заметки)"""
        if not request.ids:
            raise HTTPException(status_code=400, detail="No IDs provided")
        
        update_fields = {}
        if request.eventType is not None:
            update_fields['eventType'] = request.eventType
        if request.severity is not None:
            update_fields['severity'] = request.severity
        if request.notes is not None:
            update_fields['notes'] = request.notes
        
        if not update_fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        update_fields['lastModified'] = datetime.utcnow()
        update_fields['manuallyEdited'] = True
        
        result = await _config.db.processed_events.update_many(
            {"id": {"$in": request.ids}},
            {"$set": update_fields}
        )
        
        logger.info("Bulk updated %d events: %s", result.modified_count, list(update_fields.keys()))
        
        return {
            "success": True,
            "modified_count": result.modified_count,
            "updated_fields": list(update_fields.keys())
        }
    
    @admin_editor_router.post("/clusters/bulk-update")
    async def bulk_update_clusters(request: BulkUpdateClustersRequest):
        """Массовое обновление кластеров (тип, статус, severity)"""
        if not request.ids:
            raise HTTPException(status_code=400, detail="No IDs provided")
        
        update_fields = {}
        if request.obstacleType is not None:
            update_fields['obstacleType'] = request.obstacleType
        if request.status is not None:
            update_fields['status'] = request.status
        if request.notes is not None:
            update_fields['notes'] = request.notes
        
        severity_update = {}
        if request.severity_max is not None:
            severity_update['max'] = request.severity_max
        
        if not update_fields and not severity_update:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        update_fields['lastModified'] = datetime.utcnow()
        update_fields['manuallyEdited'] = True
        
        if severity_update:
            update_fields['severity'] = severity_update
        
        result = await _config.db.obstacle_clusters.update_many(
            {"_id": {"$in": request.ids}},
            {"$set": update_fields}
        )
        
        logger.info("Bulk updated %d clusters: %s", result.modified_count, list(update_fields.keys()))
        
        return {
            "success": True,
            "modified_count": result.modified_count,
            "updated_fields": list(update_fields.keys())
        }
    
    @admin_editor_router.post("/events/filtered")
    async def get_filtered_events(query: FilteredQueryRequest):
        """Получить события с фильтрами (дата, типы, severity)"""
        mongo_query = {}
        
        if query.date_from or query.date_to:
            ts_filter = {}
            if query.date_from:
                ts_filter['$gte'] = query.date_from
            if query.date_to:
                ts_filter['$lte'] = query.date_to + 'T23:59:59'
            mongo_query['timestamp'] = ts_filter
        
        if query.event_types:
            mongo_query['eventType'] = {'$in': query.event_types}
        
        if query.min_severity is not None or query.max_severity is not None:
            sev_filter = {}
            if query.min_severity is not None:
                sev_filter['$gte'] = query.min_severity
            if query.max_severity is not None:
                sev_filter['$lte'] = query.max_severity
            mongo_query['severity'] = sev_filter
        
        if query.min_confidence is not None:
            mongo_query['confidence'] = {'$gte': query.min_confidence}
        
        limit = min(query.limit, 50000)
        events = await _config.db.processed_events.find(mongo_query).limit(limit).to_list(limit)
        
        for ev in events:
            if '_id' in ev:
                ev['_id'] = str(ev['_id'])
        
        return {
            "total": await _config.db.processed_events.count_documents(mongo_query),
            "returned": len(events),
            "events": events
        }
    
    # ====================================
    # FILTERS - Расширенная фильтрация
    # ====================================
    
    @admin_editor_router.get("/clusters/filter")
    async def filter_clusters(
        obstacle_type: Optional[str] = None,
        min_severity: Optional[int] = None,
        max_severity: Optional[int] = None,
        min_confidence: Optional[float] = None,
        status: Optional[str] = None,
        min_report_count: Optional[int] = None,
        verified_only: bool = False,
        limit: int = Query(100, le=1000)
    ):
        """Расширенная фильтрация кластеров"""
        query = {}
        
        if obstacle_type:
            query['obstacleType'] = obstacle_type
        
        if min_severity:
            query['severity.max'] = {"$gte": min_severity}
        
        if max_severity:
            if 'severity.max' in query:
                query['severity.max']['$lte'] = max_severity
            else:
                query['severity.max'] = {"$lte": max_severity}
        
        if min_confidence:
            query['confidence'] = {"$gte": min_confidence}
        
        if status:
            query['status'] = status
        
        if min_report_count:
            query['reportCount'] = {"$gte": min_report_count}
        
        if verified_only:
            query['status'] = 'verified'
        
        clusters = await _config.db.obstacle_clusters.find(query).limit(limit).to_list(limit)
        
        return {
            "total": await _config.db.obstacle_clusters.count_documents(query),
            "returned": len(clusters),
            "clusters": clusters
        }
    
    return admin_editor_router

# Функция для подключения роутера
def get_admin_editor_router():
    """Получить роутер (БД берётся из config через _config.db)"""
    return init_admin_editor_routes()
