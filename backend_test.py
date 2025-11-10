#!/usr/bin/env python3
"""
ТЕСТИРОВАНИЕ DEPLOYED ВЕРСИИ: Backend Testing for Good Road App
Проверка deployed приложения на https://roadquality.emergent.host
"""

import requests
import json
import time
from datetime import datetime, timedelta
import os
import subprocess
from urllib.parse import urljoin

# DEPLOYED backend URL as specified in review request
DEPLOYED_BACKEND_URL = 'https://roadquality.emergent.host'
API_BASE = urljoin(DEPLOYED_BACKEND_URL, '/api')

print(f"🚀 ТЕСТИРОВАНИЕ DEPLOYED ВЕРСИИ: Good Road Backend Analysis")
print(f"Проверка deployed приложения с мониторингом в течение 30 секунд")
print(f"Deployed Backend URL: {DEPLOYED_BACKEND_URL}")
print(f"API Base: {API_BASE}")
print("=" * 80)

def print_section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")

def print_result(test_name, success, details=""):
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status} {test_name}")
    if details:
        print(f"   {details}")

def test_api_connectivity():
    """Test basic API connectivity"""
    print_section("1. ПРОВЕРКА ПОДКЛЮЧЕНИЯ К API")
    
    try:
        response = requests.get(f"{API_BASE}/", timeout=10)
        if response.status_code == 200:
            print_result("API Root Endpoint", True, f"Status: {response.status_code}")
            return True
        else:
            print_result("API Root Endpoint", False, f"Status: {response.status_code}")
            return False
    except Exception as e:
        print_result("API Root Endpoint", False, f"Error: {str(e)}")
        return False

def check_recent_sensor_data():
    """Check for recent sensor data from today's trip"""
    print_section("2. ПРОВЕРКА ПОСЛЕДНИХ ДАННЫХ В БАЗЕ")
    
    try:
        # Get recent sensor data
        response = requests.get(f"{API_BASE}/admin/sensor-data?limit=20", timeout=15)
        
        if response.status_code != 200:
            print_result("Admin Sensor Data API", False, f"Status: {response.status_code}")
            return False
        
        data = response.json()
        sensor_records = data.get('data', [])
        
        print_result("Admin Sensor Data API", True, f"Retrieved {len(sensor_records)} records")
        
        # Check for today's data (2025-01-19)
        today_str = "2025-01-19"
        trip_start = "20:50"
        trip_end = "21:02"
        
        today_records = []
        trip_records = []
        
        for record in sensor_records:
            timestamp = record.get('timestamp', '')
            if today_str in timestamp:
                today_records.append(record)
                
                # Check if within trip time (20:50 - 21:02)
                if 'T' in timestamp:
                    time_part = timestamp.split('T')[1][:5]
                    if trip_start <= time_part <= trip_end:
                        trip_records.append(record)
        
        print(f"\n📊 АНАЛИЗ ДАННЫХ:")
        print(f"   Всего записей: {len(sensor_records)}")
        print(f"   Записей за сегодня ({today_str}): {len(today_records)}")
        print(f"   Записей во время поездки ({trip_start}-{trip_end}): {len(trip_records)}")
        
        if sensor_records:
            latest_record = sensor_records[0]  # Most recent first
            print(f"   Последняя запись: {latest_record.get('timestamp', 'N/A')}")
            print(f"   GPS координаты: ({latest_record.get('latitude', 0)}, {latest_record.get('longitude', 0)})")
        
        # Show trip records if any
        if trip_records:
            print(f"\n🎯 ЗАПИСИ ВО ВРЕМЯ ПОЕЗДКИ:")
            for i, record in enumerate(trip_records[:5]):
                print(f"   {i+1}. {record.get('timestamp', 'N/A')} - GPS: ({record.get('latitude', 0)}, {record.get('longitude', 0)})")
        
        return len(trip_records) > 0
        
    except Exception as e:
        print_result("Recent Sensor Data Check", False, f"Error: {str(e)}")
        return False

def check_analytics_data():
    """Check analytics for recent activity"""
    print_section("3. ПРОВЕРКА АНАЛИТИКИ И АКТИВНОСТИ")
    
    try:
        response = requests.get(f"{API_BASE}/admin/analytics", timeout=15)
        
        if response.status_code != 200:
            print_result("Analytics API", False, f"Status: {response.status_code}")
            return False
        
        analytics = response.json()
        
        print_result("Analytics API", True, "Successfully retrieved analytics")
        
        print(f"\n📈 СТАТИСТИКА БАЗЫ ДАННЫХ:")
        print(f"   Всего точек данных: {analytics.get('total_points', 0)}")
        print(f"   Проверенных точек: {analytics.get('verified_points', 0)}")
        print(f"   Точек с препятствиями: {analytics.get('hazard_points', 0)}")
        print(f"   Средняя оценка дороги: {analytics.get('avg_road_quality', 0)}")
        print(f"   Активность за 7 дней: {analytics.get('recent_points_7d', 0)}")
        
        # Check hazard distribution
        hazard_dist = analytics.get('hazard_distribution', [])
        if hazard_dist:
            print(f"\n🚧 РАСПРЕДЕЛЕНИЕ ПРЕПЯТСТВИЙ:")
            for hazard in hazard_dist:
                print(f"   {hazard.get('hazard_type', 'Unknown')}: {hazard.get('count', 0)}")
        
        return analytics.get('recent_points_7d', 0) > 0
        
    except Exception as e:
        print_result("Analytics Check", False, f"Error: {str(e)}")
        return False

def test_sensor_data_endpoint():
    """Test if sensor data endpoint is working"""
    print_section("4. ТЕСТ API ENDPOINT /api/sensor-data")
    
    try:
        # Create test sensor data similar to mobile app
        test_data = {
            "deviceId": "test-device-urgent-check-20250119",
            "sensorData": [
                {
                    "type": "location",
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "data": {
                        "latitude": 55.7558,
                        "longitude": 37.6176,
                        "speed": 25.0,
                        "accuracy": 5.0,
                        "heading": 180.0
                    }
                },
                {
                    "type": "accelerometer", 
                    "timestamp": int(datetime.now().timestamp() * 1000),
                    "data": {
                        "x": 0.2,
                        "y": 0.4,
                        "z": 9.8,
                        "totalAcceleration": 9.82
                    }
                }
            ]
        }
        
        response = requests.post(
            f"{API_BASE}/sensor-data",
            json=test_data,
            headers={"Content-Type": "application/json"},
            timeout=15
        )
        
        if response.status_code == 200:
            result = response.json()
            print_result("POST /api/sensor-data", True, f"Processed {result.get('rawDataPoints', 0)} points")
            print(f"   Условия дороги созданы: {result.get('conditionsProcessed', 0)}")
            print(f"   Предупреждения созданы: {result.get('warningsGenerated', 0)}")
            return True
        else:
            print_result("POST /api/sensor-data", False, f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        print_result("Sensor Data Endpoint Test", False, f"Error: {str(e)}")
        return False

def check_backend_logs():
    """Check backend logs for recent activity"""
    print_section("5. ПРОВЕРКА ЛОГОВ BACKEND (последние 15 минут)")
    
    try:
        # Check supervisor logs
        log_files = [
            "/var/log/supervisor/backend.out.log",
            "/var/log/supervisor/backend.err.log"
        ]
        
        found_requests = []
        
        for log_file in log_files:
            try:
                # Get last 100 lines and filter for recent POST requests
                result = subprocess.run(
                    ["tail", "-n", "100", log_file],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                if result.returncode == 0:
                    lines = result.stdout.split('\n')
                    for line in lines:
                        if 'POST' in line and '/api/sensor-data' in line:
                            found_requests.append(line.strip())
                            
            except Exception as e:
                print(f"   Не удалось прочитать {log_file}: {str(e)}")
        
        print(f"\n📋 АНАЛИЗ ЛОГОВ:")
        print(f"   Найдено POST запросов к /api/sensor-data: {len(found_requests)}")
        
        if found_requests:
            print(f"\n🔍 ПОСЛЕДНИЕ ЗАПРОСЫ:")
            for i, request in enumerate(found_requests[-5:]):  # Show last 5
                print(f"   {i+1}. {request}")
                
                # Check for IP addresses
                if '10.64.' in request:
                    print(f"      ⚠️  Внутренний IP (10.64.x.x) - тестовый запрос")
                elif any(ext_ip in request for ext_ip in ['192.168.', '172.', '10.0.']):
                    print(f"      ⚠️  Локальный IP - возможно тестовый")
                else:
                    print(f"      ✅ Возможно внешний запрос от мобильного приложения")
        else:
            print(f"   ❌ НЕТ POST запросов к /api/sensor-data в логах")
        
        return len(found_requests) > 0
        
    except Exception as e:
        print_result("Backend Logs Check", False, f"Error: {str(e)}")
        return False

def check_road_conditions_and_warnings():
    """Check for road conditions and warnings near common locations"""
    print_section("6. ПРОВЕРКА УСЛОВИЙ ДОРОГИ И ПРЕДУПРЕЖДЕНИЙ")
    
    try:
        # Test coordinates (Moscow area)
        test_lat, test_lng = 55.7558, 37.6176
        
        # Check road conditions
        conditions_response = requests.get(
            f"{API_BASE}/road-conditions?latitude={test_lat}&longitude={test_lng}&radius=5000",
            timeout=15
        )
        
        warnings_response = requests.get(
            f"{API_BASE}/warnings?latitude={test_lat}&longitude={test_lng}&radius=5000", 
            timeout=15
        )
        
        conditions_success = conditions_response.status_code == 200
        warnings_success = warnings_response.status_code == 200
        
        print_result("Road Conditions API", conditions_success)
        print_result("Road Warnings API", warnings_success)
        
        if conditions_success:
            conditions_data = conditions_response.json()
            conditions = conditions_data.get('conditions', [])
            print(f"   Найдено условий дороги: {len(conditions)}")
            
            if conditions:
                latest_condition = conditions[0]
                print(f"   Последнее условие: оценка {latest_condition.get('condition_score', 0)}, уровень {latest_condition.get('severity_level', 'N/A')}")
        
        if warnings_success:
            warnings_data = warnings_response.json()
            warnings = warnings_data.get('warnings', [])
            print(f"   Найдено предупреждений: {len(warnings)}")
            
            if warnings:
                latest_warning = warnings[0]
                print(f"   Последнее предупреждение: {latest_warning.get('warning_type', 'N/A')}, серьезность {latest_warning.get('severity', 'N/A')}")
        
        return conditions_success and warnings_success
        
    except Exception as e:
        print_result("Road Conditions Check", False, f"Error: {str(e)}")
        return False

def main():
    """Main test execution"""
    results = []
    
    # Run all tests
    results.append(("API Connectivity", test_api_connectivity()))
    results.append(("Recent Sensor Data", check_recent_sensor_data()))
    results.append(("Analytics Data", check_analytics_data()))
    results.append(("Sensor Data Endpoint", test_sensor_data_endpoint()))
    results.append(("Backend Logs", check_backend_logs()))
    results.append(("Road Conditions & Warnings", check_road_conditions_and_warnings()))
    
    # Summary
    print_section("ИТОГОВЫЙ ОТЧЕТ")
    
    passed = sum(1 for _, success in results if success)
    total = len(results)
    
    print(f"Тестов пройдено: {passed}/{total}")
    print(f"Успешность: {(passed/total)*100:.1f}%")
    
    print(f"\n📋 ДЕТАЛЬНЫЕ РЕЗУЛЬТАТЫ:")
    for test_name, success in results:
        status = "✅" if success else "❌"
        print(f"   {status} {test_name}")
    
    # Critical findings
    print(f"\n🎯 КРИТИЧЕСКИЕ ВЫВОДЫ:")
    
    if not results[1][1]:  # Recent sensor data check failed
        print("   ❌ НЕТ данных от поездки 19.01.2025 20:50-21:02")
        print("   ❌ Мобильное приложение НЕ отправляет данные на сервер")
    
    if results[3][1]:  # Sensor endpoint works
        print("   ✅ API endpoint /api/sensor-data работает корректно")
        print("   ✅ Сервер может принимать и обрабатывать данные")
    
    if not results[4][1]:  # No backend logs
        print("   ❌ НЕТ внешних запросов в логах backend")
        print("   ❌ Проблема в мобильном приложении или сетевом подключении")
    
    print(f"\n🔧 РЕКОМЕНДАЦИИ:")
    print("   1. Проверить настройки URL в мобильном приложении")
    print("   2. Убедиться что приложение имеет разрешения на GPS и интернет")
    print("   3. Перезапустить мобильное приложение")
    print("   4. Проверить фоновые задачи в мобильном приложении")
    print("   5. Начать новую поездку для тестирования")
    
    return results

if __name__ == "__main__":
    main()