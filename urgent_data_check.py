#!/usr/bin/env python3
"""
URGENT DATA VERIFICATION - October 19, 2025
Specific tests requested in review_request
"""

import requests
import json
from datetime import datetime
import os

# Backend URL
BACKEND_URL = "https://safepath-16.preview.emergentagent.com/api"

def test_latest_5_records():
    """GET /api/admin/sensor-data?limit=5 - получить последние 5 записей"""
    print("🔍 TEST 1: GET /api/admin/sensor-data?limit=5")
    print("=" * 60)
    
    try:
        response = requests.get(f"{BACKEND_URL}/admin/sensor-data?limit=5", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ SUCCESS: Retrieved {len(data['data'])} records")
            print(f"📊 Total records in database: {data['total']}")
            
            # Analyze timestamps for October 19, 2025
            today = "2025-10-19"
            today_count = 0
            
            print(f"\n📅 АНАЛИЗ TIMESTAMP - ЕСТЬ ЛИ ЗАПИСИ ЗА СЕГОДНЯ ({today}):")
            print("-" * 50)
            
            for i, record in enumerate(data['data'], 1):
                timestamp = record['timestamp']
                gps = f"({record['latitude']}, {record['longitude']})"
                
                # Check if record is from today
                is_today = today in timestamp
                if is_today:
                    today_count += 1
                    status = "🎉 СЕГОДНЯ!"
                else:
                    status = "📅 Старая"
                
                print(f"Запись {i}: {timestamp} | GPS: {gps} | {status}")
            
            print(f"\n📊 РЕЗУЛЬТАТ АНАЛИЗА:")
            print(f"Записей за сегодня (19 октября 2025): {today_count}")
            print(f"Общее количество записей в базе: {data['total']}")
            
            if today_count > 0:
                print(f"🎉 ОТЛИЧНО! Найдено {today_count} новых записей за сегодня!")
            else:
                print(f"⚠️  НЕТ НОВЫХ ДАННЫХ за сегодня")
            
            return {
                'success': True,
                'total_records': data['total'],
                'today_records': today_count,
                'records': data['data']
            }
            
        else:
            print(f"❌ ОШИБКА: HTTP {response.status_code}")
            return {'success': False, 'error': f"HTTP {response.status_code}"}
            
    except Exception as e:
        print(f"❌ ОШИБКА: {str(e)}")
        return {'success': False, 'error': str(e)}

def test_analytics_total_points():
    """GET /api/admin/analytics - обновилась ли статистика total_points?"""
    print("\n🔍 TEST 2: GET /api/admin/analytics")
    print("=" * 60)
    
    try:
        response = requests.get(f"{BACKEND_URL}/admin/analytics", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            
            current_total = data['total_points']
            previous_total = 20  # Было 20 до исправления
            
            print(f"✅ SUCCESS: Analytics retrieved")
            print(f"\n📊 СРАВНЕНИЕ С ПРЕДЫДУЩИМ АНАЛИЗОМ:")
            print(f"Было до исправления: {previous_total} точек")
            print(f"Сейчас в базе: {current_total} точек")
            
            if current_total > previous_total:
                new_points = current_total - previous_total
                print(f"🎉 НОВЫЕ ДАННЫЕ ОБНАРУЖЕНЫ: +{new_points} новых точек!")
                print(f"✅ total_points ОБНОВИЛСЯ с {previous_total} до {current_total}")
            elif current_total == previous_total:
                print(f"⚠️  НЕТ ИЗМЕНЕНИЙ: total_points остался {current_total}")
            else:
                print(f"📉 УМЕНЬШЕНИЕ: total_points уменьшился на {previous_total - current_total}")
            
            print(f"\n📈 ДОПОЛНИТЕЛЬНАЯ СТАТИСТИКА:")
            print(f"Проверенные точки: {data['verified_points']}")
            print(f"Точки с опасностями: {data['hazard_points']}")
            print(f"Активность за 7 дней: {data['recent_points_7d']}")
            print(f"Средняя оценка дороги: {data['avg_road_quality']}")
            
            return {
                'success': True,
                'current_total': current_total,
                'previous_total': previous_total,
                'new_points': max(0, current_total - previous_total),
                'recent_7d': data['recent_points_7d']
            }
            
        else:
            print(f"❌ ОШИБКА: HTTP {response.status_code}")
            return {'success': False, 'error': f"HTTP {response.status_code}"}
            
    except Exception as e:
        print(f"❌ ОШИБКА: {str(e)}")
        return {'success': False, 'error': str(e)}

def main():
    """Основная функция проверки"""
    print("🚨 СРОЧНАЯ ПРОВЕРКА ДАННЫХ - 19 октября 2025")
    print("Проверяем: поступают ли новые данные после исправления сервисов")
    print("=" * 80)
    
    # Тест 1: Последние 5 записей
    sensor_result = test_latest_5_records()
    
    # Тест 2: Аналитика total_points
    analytics_result = test_analytics_total_points()
    
    # Итоговый анализ
    print("\n" + "=" * 80)
    print("🎯 ИТОГОВЫЙ АНАЛИЗ ПРОВЕРКИ")
    print("=" * 80)
    
    if sensor_result['success'] and analytics_result['success']:
        today_records = sensor_result['today_records']
        new_points = analytics_result['new_points']
        current_total = analytics_result['current_total']
        recent_7d = analytics_result['recent_7d']
        
        print(f"✅ Оба API работают корректно")
        
        print(f"\n📊 КЛЮЧЕВЫЕ РЕЗУЛЬТАТЫ:")
        print(f"📈 Общее количество точек: {current_total}")
        print(f"🆕 Новых точек с момента исправления: {new_points}")
        print(f"📅 Записей за сегодня (19.10.2025): {today_records}")
        print(f"📊 Активность за 7 дней: {recent_7d}")
        
        print(f"\n🎯 ОТВЕТ НА ВОПРОС:")
        if today_records > 0:
            print(f"🎉 ДА! Новые данные ПОСТУПАЮТ!")
            print(f"   ✅ Найдено {today_records} записей с timestamp 19 октября 2025")
            print(f"   ✅ total_points увеличился с 20 до {current_total} (+{new_points})")
            print(f"   ✅ Исправления отправки данных РАБОТАЮТ!")
        elif new_points > 0:
            print(f"🔄 ЧАСТИЧНО: Есть новые данные, но не за сегодня")
            print(f"   ✅ total_points увеличился с 20 до {current_total} (+{new_points})")
            print(f"   ⚠️  Но нет записей именно за 19 октября 2025")
        else:
            print(f"❌ НЕТ: Новые данные НЕ поступают")
            print(f"   ❌ total_points остался {current_total} (без изменений)")
            print(f"   ❌ Нет записей за 19 октября 2025")
            print(f"   🚨 Исправления могут НЕ работать")
        
        print(f"\n📱 ПРОВЕРКА GPS И АКСЕЛЕРОМЕТРА:")
        if sensor_result['records']:
            for i, record in enumerate(sensor_result['records'][:3], 1):
                if "2025-10-19" in record['timestamp']:
                    gps = f"({record['latitude']}, {record['longitude']})"
                    accel = record['accelerometer']
                    print(f"   Запись {i}: GPS {gps}, Акселерометр (x:{accel['x']}, y:{accel['y']}, z:{accel['z']})")
        
    else:
        print(f"❌ ОШИБКИ API:")
        if not sensor_result['success']:
            print(f"   - Sensor data API: {sensor_result.get('error', 'Неизвестная ошибка')}")
        if not analytics_result['success']:
            print(f"   - Analytics API: {analytics_result.get('error', 'Неизвестная ошибка')}")
    
    print("\n" + "=" * 80)

if __name__ == "__main__":
    main()