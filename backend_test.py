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

def check_current_deployed_state():
    """Check current state of deployed backend"""
    print_section("2. ПРОВЕРКА ТЕКУЩЕГО СОСТОЯНИЯ DEPLOYED BACKEND")
    
    try:
        # Get analytics first
        analytics_response = requests.get(f"{API_BASE}/admin/analytics", timeout=15)
        
        if analytics_response.status_code != 200:
            print_result("Admin Analytics API", False, f"Status: {analytics_response.status_code}")
            return None
        
        analytics = analytics_response.json()
        print_result("Admin Analytics API", True, "Successfully retrieved analytics")
        
        print(f"\n📊 ТЕКУЩЕЕ СОСТОЯНИЕ БАЗЫ ДАННЫХ:")
        print(f"   Всего точек данных: {analytics.get('total_points', 0)}")
        print(f"   Проверенных точек: {analytics.get('verified_points', 0)}")
        print(f"   Точек с препятствиями: {analytics.get('hazard_points', 0)}")
        print(f"   Средняя оценка дороги: {analytics.get('avg_road_quality', 0)}")
        print(f"   Активность за 7 дней: {analytics.get('recent_points_7d', 0)}")
        
        # Get latest sensor data
        sensor_response = requests.get(f"{API_BASE}/admin/sensor-data?limit=10", timeout=15)
        
        if sensor_response.status_code != 200:
            print_result("Admin Sensor Data API", False, f"Status: {sensor_response.status_code}")
            return analytics
        
        sensor_data = sensor_response.json()
        sensor_records = sensor_data.get('data', [])
        
        print_result("Admin Sensor Data API", True, f"Retrieved {len(sensor_records)} records")
        
        if sensor_records:
            latest_record = sensor_records[0]  # Most recent first
            print(f"\n📍 ПОСЛЕДНЯЯ ЗАПИСЬ:")
            print(f"   Время: {latest_record.get('timestamp', 'N/A')}")
            print(f"   Device ID: {latest_record.get('deviceId', 'N/A')}")
            print(f"   GPS координаты: ({latest_record.get('latitude', 0)}, {latest_record.get('longitude', 0)})")
            
            # Check if today's data exists
            today = datetime.now().date()
            today_count = 0
            for record in sensor_records:
                try:
                    record_date = datetime.fromisoformat(record['timestamp'].replace('Z', '+00:00')).date()
                    if record_date == today:
                        today_count += 1
                except:
                    continue
            
            print(f"   Записей за сегодня: {today_count}")
        else:
            print(f"\n📍 База данных пуста")
        
        return {
            'analytics': analytics,
            'sensor_data': sensor_data,
            'latest_record': sensor_records[0] if sensor_records else None
        }
        
    except Exception as e:
        print_result("Current State Check", False, f"Error: {str(e)}")
        return None

def monitor_deployed_backend_30_seconds():
    """Monitor deployed backend for 30 seconds checking at 10, 20, 30 second intervals"""
    print_section("3. МОНИТОРИНГ В ТЕЧЕНИЕ 30 СЕКУНД")
    
    # Get initial state
    print("📊 Получение начального состояния...")
    initial_response = requests.get(f"{API_BASE}/admin/analytics", timeout=15)
    
    if initial_response.status_code != 200:
        print_result("Initial Analytics", False, f"Status: {initial_response.status_code}")
        return False
    
    initial_analytics = initial_response.json()
    initial_total = initial_analytics.get('total_points', 0)
    
    print(f"   Начальное количество точек: {initial_total}")
    print(f"   Начало мониторинга: {datetime.now().strftime('%H:%M:%S')}")
    
    start_time = time.time()
    check_intervals = [10, 20, 30]
    new_data_detected = False
    
    for interval in check_intervals:
        # Wait until the interval time
        elapsed = time.time() - start_time
        wait_time = interval - elapsed
        
        if wait_time > 0:
            print(f"\n⏳ Ожидание до {interval}с проверки... ({wait_time:.1f}с)")
            time.sleep(wait_time)
        
        # Check current state
        current_time = datetime.now().strftime('%H:%M:%S')
        print(f"\n🔍 ПРОВЕРКА НА {interval}с ({current_time}):")
        
        try:
            response = requests.get(f"{API_BASE}/admin/analytics", timeout=10)
            
            if response.status_code == 200:
                current_analytics = response.json()
                current_total = current_analytics.get('total_points', 0)
                change = current_total - initial_total
                
                print(f"   Текущее количество точек: {current_total}")
                
                if change > 0:
                    print(f"   🎉 ОБНАРУЖЕНЫ НОВЫЕ ДАННЫЕ! +{change} точек")
                    new_data_detected = True
                    
                    # Get latest data to show details
                    sensor_response = requests.get(f"{API_BASE}/admin/sensor-data?limit=5", timeout=10)
                    if sensor_response.status_code == 200:
                        sensor_data = sensor_response.json()
                        latest_records = sensor_data.get('data', [])
                        if latest_records:
                            latest = latest_records[0]
                            print(f"   Последняя запись: {latest.get('timestamp', 'N/A')}")
                            print(f"   Device ID: {latest.get('deviceId', 'N/A')}")
                elif change == 0:
                    print(f"   📊 Изменений нет (остается {current_total})")
                else:
                    print(f"   ⚠️  Количество уменьшилось на {abs(change)} (возможна очистка данных)")
                    
            else:
                print(f"   ❌ Ошибка получения данных: {response.status_code}")
                
        except Exception as e:
            print(f"   ❌ Ошибка при проверке: {str(e)}")
    
    print(f"\n📋 РЕЗУЛЬТАТ МОНИТОРИНГА:")
    if new_data_detected:
        print("   ✅ Deployed приложение АКТИВНО отправляет данные")
    else:
        print("   ❌ Новых данных не обнаружено за 30 секунд")
        print("   Возможные причины:")
        print("     - Мобильное приложение не используется")
        print("     - Проблемы с сетевым подключением")
        print("     - React hooks stale closure bug")
        print("     - Фоновые задачи не работают")
    
    return new_data_detected

def check_latest_sensor_data():
    """Check latest 10 sensor data records with fresh data analysis"""
    print_section("4. ПРОВЕРКА ПОСЛЕДНИХ ДАННЫХ (limit=10)")
    
    try:
        response = requests.get(f"{API_BASE}/admin/sensor-data?limit=10", timeout=15)
        
        if response.status_code != 200:
            print_result("Latest Sensor Data API", False, f"Status: {response.status_code}")
            return False
        
        data = response.json()
        records = data.get('data', [])
        
        print_result("Latest Sensor Data API", True, f"Retrieved {len(records)} records")
        
        if not records:
            print("   ❌ База данных пуста")
            return False
        
        print(f"\n📊 АНАЛИЗ ПОСЛЕДНИХ {len(records)} ЗАПИСЕЙ:")
        
        # Analyze records by date
        today = datetime.now().date()
        date_counts = {}
        device_ids = set()
        
        for record in records:
            try:
                timestamp = record.get('timestamp', '')
                record_date = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).date()
                date_str = record_date.strftime('%Y-%m-%d')
                
                if date_str not in date_counts:
                    date_counts[date_str] = 0
                date_counts[date_str] += 1
                
                device_id = record.get('deviceId', 'unknown')
                device_ids.add(device_id)
                
            except Exception as e:
                print(f"   ⚠️  Ошибка обработки записи: {str(e)}")
        
        # Show date distribution
        print(f"   Распределение по датам:")
        for date_str, count in sorted(date_counts.items(), reverse=True):
            is_today = date_str == today.strftime('%Y-%m-%d')
            marker = "🟢 СЕГОДНЯ" if is_today else ""
            print(f"     {date_str}: {count} записей {marker}")
        
        # Show device IDs
        print(f"   Device ID последних записей:")
        for device_id in sorted(device_ids):
            print(f"     - {device_id}")
        
        # Show latest record details
        latest = records[0]
        print(f"\n📍 САМАЯ ПОСЛЕДНЯЯ ЗАПИСЬ:")
        print(f"   Время: {latest.get('timestamp', 'N/A')}")
        print(f"   Device ID: {latest.get('deviceId', 'N/A')}")
        print(f"   GPS: ({latest.get('latitude', 0)}, {latest.get('longitude', 0)})")
        print(f"   Скорость: {latest.get('speed', 0)} км/ч")
        print(f"   Точность GPS: {latest.get('accuracy', 0)} м")
        
        # Check if there's fresh data (today)
        today_str = today.strftime('%Y-%m-%d')
        has_fresh_data = today_str in date_counts
        
        if has_fresh_data:
            print(f"   ✅ Есть свежие записи с сегодняшней датой ({date_counts[today_str]} записей)")
        else:
            print(f"   ❌ Нет записей с сегодняшней датой")
        
        return has_fresh_data
        
    except Exception as e:
        print_result("Latest Sensor Data Check", False, f"Error: {str(e)}")
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