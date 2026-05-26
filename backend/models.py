import uuid
from datetime import datetime
from typing import Dict, List, Optional, Union

from pydantic import BaseModel, Field


class AccelerometerReading(BaseModel):
    x: float
    y: float
    z: float
    timestamp: Optional[int] = None


class RawSensorData(BaseModel):
    deviceId: str
    timestamp: int
    gps: Dict[str, object]
    accelerometer: Union[List[AccelerometerReading], Dict[str, float]]
    userReported: Optional[bool] = False
    eventType: Optional[str] = None
    severity: Optional[int] = None


class RawDataBatch(BaseModel):
    deviceId: str
    data: List[RawSensorData]


class ProcessedEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    deviceId: str
    timestamp: datetime
    eventType: str
    severity: int
    confidence: float
    latitude: float
    longitude: float
    speed: float
    accelerometer_data: Dict[str, float]
    roadType: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class UserWarning(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    deviceId: str
    eventType: str
    severity: int
    latitude: float
    longitude: float
    distance: float
    message: str
    expiresAt: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LimitsConfig(BaseModel):
    clusters_default_limit: int = 1000
    clusters_max_limit: int = 50000
    sensor_data_default_limit: int = 1000
    sensor_data_max_limit: int = 100000
    clusters_active_limit: int = 1000
    csv_export_default_limit: int = 10000
    csv_export_max_limit: int = 100000
