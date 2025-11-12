#!/usr/bin/env python3
"""
Скрипт для очистки базы данных от тестовых и нулевых записей
Оставляет только реальные данные от мобильного приложения
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv

load_dotenv()

# Подключение к MongoDB
MONGO_URL = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.getenv('DB_NAME', 'test_database')

async def cleanup_database():
    """Очистка базы данных от тестовых и нулевых записей"""
    
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    collection = db['sensor_data']
    
    print("🔍 Анализ базы данных...")
    print(f"📊 MongoDB: {MONGO_URL}")
    print(f"📦 База данных: {DB_NAME}")
    print(f"📁 Коллекция: sensor_data\n")
    
    # Подсчет всех записей
    total_count = await collection.count_documents({})
    print(f"Всего записей в базе: {total_count}")
    
    # Подсчет тестовых записей
    test_count = await collection.count_documents({
        "deviceId": {"$regex": "^test-"}
    })
    print(f"Тестовые записи (deviceId starts with 'test-'): {test_count}")
    
    # Подсчет записей с нулевыми координатами
    zero_coords_count = await collection.count_documents({
        "latitude": 0.0,
        "longitude": 0.0
    })
    print(f"Записи с нулевыми координатами (0.0, 0.0): {zero_coords_count}")
    
    # Подсчет реальных записей (не тестовые и не нулевые координаты)
    real_count = await collection.count_documents({
        "deviceId": {"$not": {"$regex": "^test-"}},
        "$or": [
            {"latitude": {"$ne": 0.0}},
            {"longitude": {"$ne": 0.0}}
        ]
    })
    print(f"Реальные записи (будут сохранены): {real_count}\n")
    
    # Показываем примеры реальных записей
    print("📋 Примеры реальных записей, которые будут сохранены:")
    real_samples = await collection.find(
        {
            "deviceId": {"$not": {"$regex": "^test-"}},
            "$or": [
                {"latitude": {"$ne": 0.0}},
                {"longitude": {"$ne": 0.0}}
            ]
        },
        {"deviceId": 1, "latitude": 1, "longitude": 1, "timestamp": 1}
    ).limit(5).to_list(length=5)
    
    for record in real_samples:
        lat = record.get('latitude', 0.0)
        lng = record.get('longitude', 0.0)
        device = record.get('deviceId', 'unknown')[:30]
        timestamp = record.get('timestamp', 'N/A')
        print(f"  - Device: {device}... GPS: ({lat:.6f}, {lng:.6f}) Time: {timestamp}")
    
    # Подтверждение удаления
    print(f"\n⚠️  ВНИМАНИЕ! Будет удалено {test_count + zero_coords_count} записей:")
    print(f"   - {test_count} тестовых записей")
    print(f"   - {zero_coords_count} записей с нулевыми координатами")
    print(f"✅ Будет сохранено {real_count} реальных записей\n")
    
    response = input("Продолжить удаление? (yes/no): ")
    
    if response.lower() != 'yes':
        print("❌ Отменено")
        client.close()
        return
    
    print("\n🗑️  Удаление тестовых записей...")
    result1 = await collection.delete_many({
        "deviceId": {"$regex": "^test-"}
    })
    print(f"✅ Удалено тестовых записей: {result1.deleted_count}")
    
    print("\n🗑️  Удаление записей с нулевыми координатами...")
    result2 = await collection.delete_many({
        "latitude": 0.0,
        "longitude": 0.0
    })
    print(f"✅ Удалено записей с нулевыми координатами: {result2.deleted_count}")
    
    # Проверка финального состояния
    final_count = await collection.count_documents({})
    print(f"\n📊 Финальная статистика:")
    print(f"   Было записей: {total_count}")
    print(f"   Удалено: {result1.deleted_count + result2.deleted_count}")
    print(f"   Осталось: {final_count}")
    print(f"\n✅ Очистка базы данных завершена!")
    
    client.close()

if __name__ == "__main__":
    asyncio.run(cleanup_database())
