#!/usr/bin/env python3
"""
Скрипт для анализа собранных данных из поездки
Показывает сырые данные акселерометра, GPS треки, статистику
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timedelta
import json

MONGO_URL = 'mongodb://localhost:27017'
DB_NAME = 'test_database'

async def analyze_trip():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    
    print("=" * 80)
    print("📊 АНАЛИЗ ДАННЫХ ПОЕЗДКИ")
    print("=" * 80)
    
    # Получаем все данные за последний час
    time_threshold = datetime.utcnow() - timedelta(hours=1)
    
    conditions = await db.road_conditions.find(
        {"created_at": {"$gte": time_threshold}}
    ).sort("created_at", 1).to_list(length=10000)
    
    print(f"\n✅ Собрано записей за последний час: {len(conditions)}")
    
    if not conditions:
        print("❌ Нет данных за последний час")
        client.close()
        return
    
    # Группируем по типу события
    event_types = {}
    for cond in conditions:
        event_type = cond.get('event_type', 'unknown')
        if event_type not in event_types:
            event_types[event_type] = []
        event_types[event_type].append(cond)
    
    print(f"\n📋 Типы событий:")
    for event_type, items in event_types.items():
        print(f"   - {event_type}: {len(items)} записей")
    
    # Статистика по скорости
    speeds = [c.get('speed', 0) for c in conditions if c.get('speed') is not None]
    if speeds:
        print(f"\n🚗 Скорость:")
        print(f"   Мин: {min(speeds):.1f} км/ч")
        print(f"   Макс: {max(speeds):.1f} км/ч")
        print(f"   Средняя: {sum(speeds)/len(speeds):.1f} км/ч")
    
    # Статистика акселерометра
    print(f"\n📊 Данные акселерометра:")
    
    # Проверяем наличие сырых данных x, y, z
    has_raw_data = any(
        c.get('accelerometer_x') is not None or
        c.get('accelerometer_y') is not None or
        c.get('accelerometer_z') is not None
        for c in conditions
    )
    
    if has_raw_data:
        print("   ✅ Сырые данные (x, y, z) присутствуют!")
        
        x_values = [c.get('accelerometer_x', 0) for c in conditions if c.get('accelerometer_x') is not None]
        y_values = [c.get('accelerometer_y', 0) for c in conditions if c.get('accelerometer_y') is not None]
        z_values = [c.get('accelerometer_z', 0) for c in conditions if c.get('accelerometer_z') is not None]
        
        if x_values:
            print(f"   X: мин={min(x_values):.3f}, макс={max(x_values):.3f}, средн={sum(x_values)/len(x_values):.3f}")
        if y_values:
            print(f"   Y: мин={min(y_values):.3f}, макс={max(y_values):.3f}, средн={sum(y_values)/len(y_values):.3f}")
        if z_values:
            print(f"   Z: мин={min(z_values):.3f}, макс={max(z_values):.3f}, средн={sum(z_values)/len(z_values):.3f}")
    else:
        print("   ⚠️  Сырые данные (x, y, z) отсутствуют - старая версия backend")
    
    # Статистика magnitude
    magnitudes = [c.get('accelerometer_magnitude', 0) for c in conditions if c.get('accelerometer_magnitude')]
    if magnitudes:
        print(f"\n   Magnitude:")
        print(f"   Мин: {min(magnitudes):.3f}")
        print(f"   Макс: {max(magnitudes):.3f}")
        print(f"   Средняя: {sum(magnitudes)/len(magnitudes):.3f}")
    
    # GPS трек
    print(f"\n📍 GPS трек:")
    unique_coords = set()
    for c in conditions:
        lat = c.get('latitude')
        lon = c.get('longitude')
        if lat and lon:
            unique_coords.add((round(lat, 6), round(lon, 6)))
    
    print(f"   Уникальных точек: {len(unique_coords)}")
    
    if len(unique_coords) > 0:
        lats = [coord[0] for coord in unique_coords]
        lons = [coord[1] for coord in unique_coords]
        print(f"   Широта: {min(lats):.6f} - {max(lats):.6f}")
        print(f"   Долгота: {min(lons):.6f} - {max(lons):.6f}")
    
    # Временной диапазон
    print(f"\n🕐 Временной диапазон:")
    timestamps = [c.get('created_at') for c in conditions if c.get('created_at')]
    if timestamps:
        print(f"   Начало: {min(timestamps)}")
        print(f"   Конец: {max(timestamps)}")
        duration = (max(timestamps) - min(timestamps)).total_seconds()
        print(f"   Длительность: {duration/60:.1f} минут")
    
    # Показываем примеры последних записей
    print(f"\n📋 Последние 5 записей:")
    for i, cond in enumerate(conditions[-5:], 1):
        print(f"\n{i}. Время: {cond.get('created_at', 'N/A')}")
        print(f"   GPS: ({cond.get('latitude', 0):.6f}, {cond.get('longitude', 0):.6f})")
        print(f"   Тип: {cond.get('event_type', 'N/A')}")
        print(f"   Скорость: {cond.get('speed', 0):.1f} км/ч")
        
        if has_raw_data:
            x = cond.get('accelerometer_x', 0)
            y = cond.get('accelerometer_y', 0)
            z = cond.get('accelerometer_z', 0)
            print(f"   Accel (x,y,z): ({x:.3f}, {y:.3f}, {z:.3f})")
        
        mag = cond.get('accelerometer_magnitude', 0)
        print(f"   Magnitude: {mag:.3f}")
    
    print("\n" + "=" * 80)
    
    client.close()

if __name__ == "__main__":
    asyncio.run(analyze_trip())
