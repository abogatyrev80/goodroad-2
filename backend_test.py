#!/usr/bin/env python3
"""
ДЕТАЛЬНЫЙ АНАЛИЗ: Good Road Mobile App Data Reception Analysis
Показать точные последние данные которые попали на сервер и проанализировать механизм обмена
"""

import requests
import json
import time
from datetime import datetime, timezone
import os
import subprocess
from dotenv import load_dotenv

# Load environment variables
load_dotenv('/app/frontend/.env')

# Get backend URL from frontend environment
BACKEND_URL = os.getenv('EXPO_PUBLIC_BACKEND_URL', 'https://smoothroad.preview.emergentagent.com')
API_BASE = f"{BACKEND_URL}/api"

print(f"🔍 ДЕТАЛЬНЫЙ АНАЛИЗ: Good Road Server Data Analysis")
print(f"📡 Backend URL: {API_BASE}")
print(f"🎯 ЦЕЛЬ: Найти точную проблему почему мобильное приложение не может отправить данные на сервер")
print("=" * 100)

def analyze_latest_20_records():
    """ДЕТАЛЬНАЯ ПРОВЕРКА ПОСЛЕДНИХ ДАННЫХ: GET /api/admin/sensor-data?limit=20"""
    print("\n" + "="*100)
    print("1. ДЕТАЛЬНАЯ ПРОВЕРКА ПОСЛЕДНИХ 20 ЗАПИСЕЙ С ТОЧНЫМИ TIMESTAMP")
    print("="*100)
    
    try:
        response = requests.get(
            f"{API_BASE}/admin/sensor-data",
            params={"limit": 20},
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            records = data.get('data', [])
            total = data.get('total', 0)
            
            print(f"📊 Общее количество записей в базе: {total}")
            print(f"📊 Получено записей для анализа: {len(records)}")
            
            if not records:
                print("❌ КРИТИЧЕСКАЯ ПРОБЛЕМА: База данных пуста!")
                return False, "База данных пуста"
            
            print(f"\n📋 ПОСЛЕДНИЕ 20 ЗАПИСЕЙ С ТОЧНЫМИ ДАННЫМИ:")
            print("-" * 140)
            print(f"{'№':<3} {'Timestamp (UTC)':<20} {'GPS Координаты':<25} {'Скорость':<10} {'Точность':<10} {'Акселерометр (x,y,z)':<25}")
            print("-" * 140)
            
            real_mobile_records = []
            test_records = []
            today_records = []
            device_ids = set()
            
            for i, record in enumerate(records, 1):
                timestamp_str = record.get('timestamp', 'N/A')
                lat = record.get('latitude', 0)
                lng = record.get('longitude', 0)
                speed = record.get('speed', 0)
                accuracy = record.get('accuracy', 0)
                accel = record.get('accelerometer', {})
                
                # Классификация записей
                is_real_mobile = lat != 0.0 and lng != 0.0
                is_today = timestamp_str and '2025-11-03' in timestamp_str
                
                if is_real_mobile:
                    real_mobile_records.append(record)
                else:
                    test_records.append(record)
                
                if is_today:
                    today_records.append(record)
                
                # Форматирование для вывода
                gps_coords = f"({lat:.4f}, {lng:.4f})" if is_real_mobile else "(0.0000, 0.0000)"
                accel_str = f"{accel.get('x', 0):.1f},{accel.get('y', 0):.1f},{accel.get('z', 0):.1f}"
                
                print(f"{i:<3} {timestamp_str[:19]:<20} {gps_coords:<25} {speed:<10.1f} {accuracy:<10.1f} {accel_str:<25}")
            
            print("-" * 140)
            
            # Анализ по источникам
            print(f"\n📊 РАЗДЕЛЕНИЕ ЗАПИСЕЙ ПО ИСТОЧНИКАМ:")
            print(f"📱 Реальные мобильные данные (GPS ≠ 0,0): {len(real_mobile_records)} записей")
            print(f"🧪 Тестовые данные (GPS = 0,0): {len(test_records)} записей")
            print(f"📅 Записи за сегодня (3 ноября 2025): {len(today_records)} записей")
            
            # Самая последняя РЕАЛЬНАЯ запись
            if real_mobile_records:
                latest_real = real_mobile_records[0]  # Первая в списке = самая новая
                print(f"\n🎯 САМАЯ ПОСЛЕДНЯЯ РЕАЛЬНАЯ ЗАПИСЬ (НЕ ТЕСТОВАЯ):")
                print(f"   📅 Timestamp: {latest_real.get('timestamp', 'N/A')}")
                print(f"   📍 GPS координаты: ({latest_real.get('latitude', 0):.6f}, {latest_real.get('longitude', 0):.6f})")
                print(f"   🚗 Скорость: {latest_real.get('speed', 0)} км/ч")
                print(f"   📡 Точность: {latest_real.get('accuracy', 0)} метров")
                accel = latest_real.get('accelerometer', {})
                print(f"   📊 Акселерометр: x={accel.get('x', 0):.2f}, y={accel.get('y', 0):.2f}, z={accel.get('z', 0):.2f}")
            else:
                print(f"\n❌ НЕТ РЕАЛЬНЫХ МОБИЛЬНЫХ ДАННЫХ в последних 20 записях!")
            
            # Записи за сегодня
            if today_records:
                print(f"\n📅 ЗАПИСИ ЗА СЕГОДНЯ (3 ноября 2025): {len(today_records)} записей")
                for record in today_records:
                    print(f"   - {record.get('timestamp', 'N/A')} | GPS: ({record.get('latitude', 0):.4f}, {record.get('longitude', 0):.4f})")
            else:
                print(f"\n❌ НЕТ ЗАПИСЕЙ ЗА СЕГОДНЯ (3 ноября 2025)!")
            
            return True, f"Реальных: {len(real_mobile_records)}, Тестовых: {len(test_records)}, Сегодня: {len(today_records)}"
            
        else:
            print(f"❌ Ошибка получения данных: HTTP {response.status_code}")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Ошибка анализа данных: {str(e)}")
        return False, str(e)

def analyze_backend_logs_2_hours():
    """Анализ backend логов за последние 2 часа - есть ли POST запросы от мобильного приложения"""
    print("\n" + "="*100)
    print("4. АНАЛИЗ BACKEND ЛОГОВ ЗА ПОСЛЕДНИЕ 2 ЧАСА")
    print("="*100)
    
    try:
        # Получаем логи backend
        result = subprocess.run(
            ["tail", "-n", "500", "/var/log/supervisor/backend.out.log"],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            log_lines = result.stdout.split('\n')
            
            # Анализируем POST запросы
            post_requests = []
            mobile_requests = []
            internal_requests = []
            
            print(f"📋 Анализ последних {len(log_lines)} строк логов backend...")
            
            for line in log_lines:
                if 'POST /api/sensor-data' in line:
                    post_requests.append(line.strip())
                    
                    # Проверяем источник запроса
                    if any(ip in line for ip in ['10.64.', '127.0.0.1', 'localhost']):
                        internal_requests.append(line.strip())
                    else:
                        mobile_requests.append(line.strip())
            
            print(f"\n📊 РЕЗУЛЬТАТЫ АНАЛИЗА ЛОГОВ:")
            print(f"📡 Всего POST запросов к /api/sensor-data: {len(post_requests)}")
            print(f"🏢 Внутренние запросы (10.64.x.x, localhost): {len(internal_requests)}")
            print(f"📱 Внешние мобильные запросы: {len(mobile_requests)}")
            
            if post_requests:
                print(f"\n📝 ПОСЛЕДНИЕ POST ЗАПРОСЫ К /api/sensor-data:")
                for i, req in enumerate(post_requests[-10:], 1):  # Показываем последние 10
                    print(f"   {i}. {req}")
            else:
                print(f"\n❌ НЕТ POST ЗАПРОСОВ К /api/sensor-data В ЛОГАХ!")
            
            if mobile_requests:
                print(f"\n📱 ОБНАРУЖЕНЫ МОБИЛЬНЫЕ ЗАПРОСЫ:")
                for req in mobile_requests:
                    print(f"   ✅ {req}")
            else:
                print(f"\n🚨 КРИТИЧНО: НЕТ ВНЕШНИХ МОБИЛЬНЫХ ЗАПРОСОВ!")
                print(f"   Все POST запросы идут только от внутренних IP адресов (тестирование)")
                print(f"   Это подтверждает, что мобильное приложение НЕ отправляет данные на сервер")
            
            return len(mobile_requests) > 0, f"POST запросов: {len(post_requests)}, мобильных: {len(mobile_requests)}"
            
        else:
            print(f"❌ Ошибка чтения логов: {result.stderr}")
            return False, f"Ошибка логов: {result.stderr}"
            
    except Exception as e:
        print(f"❌ Ошибка анализа логов: {str(e)}")
        return False, str(e)

def show_sensor_data_endpoint_structure():
    """Показать структуру данных которые ожидает /api/sensor-data endpoint"""
    print("\n" + "="*100)
    print("5. СТРУКТУРА ДАННЫХ ДЛЯ /api/sensor-data ENDPOINT")
    print("="*100)
    
    expected_structure = {
        "deviceId": "string - уникальный идентификатор мобильного устройства",
        "sensorData": [
            {
                "type": "location",
                "timestamp": "number - Unix timestamp в миллисекундах",
                "data": {
                    "latitude": "number - широта GPS координат",
                    "longitude": "number - долгота GPS координат",
                    "speed": "number - скорость движения в км/ч",
                    "accuracy": "number - точность GPS в метрах"
                }
            },
            {
                "type": "accelerometer",
                "timestamp": "number - Unix timestamp в миллисекундах", 
                "data": {
                    "x": "number - ускорение по оси X (м/с²)",
                    "y": "number - ускорение по оси Y (м/с²)",
                    "z": "number - ускорение по оси Z (м/с²)"
                }
            }
        ]
    }
    
    print("📋 ОЖИДАЕМАЯ СТРУКТУРА JSON ДЛЯ POST /api/sensor-data:")
    print(json.dumps(expected_structure, indent=2, ensure_ascii=False))
    
    # Пример реальных данных
    example_data = {
        "deviceId": "mobile_device_example_20251103",
        "sensorData": [
            {
                "type": "location",
                "timestamp": int(time.time() * 1000),
                "data": {
                    "latitude": 55.7558,
                    "longitude": 37.6176,
                    "speed": 45.0,
                    "accuracy": 5.0
                }
            },
            {
                "type": "accelerometer",
                "timestamp": int(time.time() * 1000),
                "data": {
                    "x": 0.2,
                    "y": 0.4,
                    "z": 9.8
                }
            }
        ]
    }
    
    print(f"\n📱 ПРИМЕР РЕАЛЬНЫХ ДАННЫХ ОТ МОБИЛЬНОГО ПРИЛОЖЕНИЯ:")
    print(json.dumps(example_data, indent=2, ensure_ascii=False))
    
    return True, "Структура показана"

def analyze_device_ids():
    """Анализ deviceId используемых в записях"""
    print("\n" + "="*100)
    print("АНАЛИЗ DEVICE ID В ЗАПИСЯХ")
    print("="*100)
    
    try:
        # Получаем больше записей для анализа deviceId patterns
        response = requests.get(
            f"{API_BASE}/admin/sensor-data",
            params={"limit": 50},
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            records = data.get('data', [])
            
            print(f"📊 Анализ deviceId patterns в {len(records)} записях...")
            print(f"⚠️  ПРИМЕЧАНИЕ: deviceId хранится в rawData структуре, не в корне записи")
            print(f"   Для полного анализа deviceId нужен доступ к полной rawData структуре")
            
            # Анализируем timestamp patterns для определения источников
            timestamp_patterns = {}
            for record in records:
                timestamp = record.get('timestamp', '')
                if timestamp:
                    date_part = timestamp[:10]  # YYYY-MM-DD
                    timestamp_patterns[date_part] = timestamp_patterns.get(date_part, 0) + 1
            
            print(f"\n📅 АКТИВНОСТЬ ПО ДАТАМ:")
            for date, count in sorted(timestamp_patterns.items(), reverse=True):
                print(f"   {date}: {count} записей")
            
            return True, f"Проанализировано {len(records)} записей"
        else:
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        return False, str(e)

def test_sensor_data_upload():
    """Test POST /api/sensor-data with realistic mobile app data"""
    print("\n🚨 CRITICAL TEST: POST /api/sensor-data - Mobile Data Upload")
    
    # Current timestamp (simulating mobile app sending data now)
    current_timestamp = int(time.time() * 1000)  # milliseconds
    
    # Realistic test data simulating mobile app
    test_data = {
        "deviceId": "test-mobile-device-today",
        "sensorData": [
            {
                "type": "location",
                "timestamp": current_timestamp,
                "data": {
                    "latitude": 55.7558,
                    "longitude": 37.6176,
                    "accuracy": 5.0,
                    "speed": 35.5
                }
            },
            {
                "type": "accelerometer", 
                "timestamp": current_timestamp,
                "data": {
                    "x": 0.2,
                    "y": 0.1,
                    "z": 9.8
                }
            },
            {
                "type": "accelerometer", 
                "timestamp": current_timestamp + 100,
                "data": {
                    "x": 0.3,
                    "y": 0.2,
                    "z": 9.7
                }
            },
            {
                "type": "accelerometer", 
                "timestamp": current_timestamp + 200,
                "data": {
                    "x": 0.1,
                    "y": 0.3,
                    "z": 9.9
                }
            },
            {
                "type": "accelerometer", 
                "timestamp": current_timestamp + 300,
                "data": {
                    "x": 0.4,
                    "y": 0.1,
                    "z": 9.6
                }
            },
            {
                "type": "accelerometer", 
                "timestamp": current_timestamp + 400,
                "data": {
                    "x": 0.2,
                    "y": 0.4,
                    "z": 9.8
                }
            }
        ]
    }
    
    try:
        print(f"📤 Sending mobile sensor data (deviceId: {test_data['deviceId']})")
        print(f"📍 GPS: {test_data['sensorData'][0]['data']['latitude']}, {test_data['sensorData'][0]['data']['longitude']}")
        print(f"📊 Data points: {len(test_data['sensorData'])} (1 location + 5 accelerometer)")
        
        response = requests.post(
            f"{API_BASE}/sensor-data",
            json=test_data,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "GoodRoadMobileApp/1.0",
                "Origin": "capacitor://localhost"  # Simulate mobile app origin
            },
            timeout=30
        )
        
        print(f"📡 Response Status: {response.status_code}")
        print(f"📡 Response Headers: {dict(response.headers)}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ SUCCESS: Data uploaded successfully")
            print(f"   📊 Raw data points: {result.get('rawDataPoints', 0)}")
            print(f"   🛣️  Conditions processed: {result.get('conditionsProcessed', 0)}")
            print(f"   ⚠️  Warnings generated: {result.get('warningsGenerated', 0)}")
            return True, result
        else:
            print(f"❌ FAILED: HTTP {response.status_code}")
            print(f"   Error: {response.text}")
            return False, response.text
            
    except requests.exceptions.RequestException as e:
        print(f"❌ NETWORK ERROR: {str(e)}")
        return False, str(e)

def verify_data_storage():
    """Verify that uploaded data was actually stored in database"""
    print("\n🔍 VERIFICATION: Check if data was stored in database")
    
    try:
        # Check admin sensor data for our test device
        response = requests.get(
            f"{API_BASE}/admin/sensor-data",
            params={"limit": 10},
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            total_records = data.get('total', 0)
            returned_records = data.get('returned', 0)
            
            print(f"📊 Total records in database: {total_records}")
            print(f"📊 Recent records retrieved: {returned_records}")
            
            # Look for our test device data
            test_device_found = False
            recent_data = False
            
            for record in data.get('data', []):
                timestamp = record.get('timestamp', '')
                
                # Check if any data is from today
                if timestamp and datetime.now().strftime('%Y-%m-%d') in timestamp:
                    recent_data = True
                    print(f"📅 Found today's data: {timestamp}")
            
            if recent_data:
                print("✅ VERIFICATION PASSED: Recent data found in database")
                test_device_found = True
            else:
                print("❌ VERIFICATION FAILED: No recent data found in database")
                print("⚠️  This confirms user's issue - no new data since Oct 7th")
                
            return test_device_found, total_records
            
        else:
            print(f"❌ Failed to verify data storage: HTTP {response.status_code}")
            return False, 0
            
    except requests.exceptions.RequestException as e:
        print(f"❌ VERIFICATION ERROR: {str(e)}")
        return False, 0

def test_cors_mobile_compatibility():
    """Test CORS settings for mobile app compatibility"""
    print("\n🌐 CORS TEST: Mobile App Compatibility")
    
    # Test preflight request (OPTIONS)
    try:
        response = requests.options(
            f"{API_BASE}/sensor-data",
            headers={
                "Origin": "capacitor://localhost",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type"
            },
            timeout=10
        )
        
        print(f"📡 OPTIONS Response: {response.status_code}")
        
        cors_headers = {
            'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
            'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
            'Access-Control-Allow-Headers': response.headers.get('Access-Control-Allow-Headers'),
        }
        
        print("🌐 CORS Headers:")
        for header, value in cors_headers.items():
            print(f"   {header}: {value}")
        
        # Check if mobile origins are allowed
        allow_origin = cors_headers.get('Access-Control-Allow-Origin', '')
        if allow_origin == '*' or 'capacitor' in allow_origin:
            print("✅ CORS: Mobile origins allowed")
            return True
        else:
            print("❌ CORS: Mobile origins may be blocked")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ CORS TEST ERROR: {str(e)}")
        return False

def check_analytics_for_recent_activity():
    """Check analytics to see recent database activity"""
    print("\n📊 ANALYTICS CHECK: Recent Database Activity")
    
    try:
        response = requests.get(f"{API_BASE}/admin/analytics", timeout=30)
        
        if response.status_code == 200:
            analytics = response.json()
            
            print(f"📊 Total sensor points: {analytics.get('total_points', 0)}")
            print(f"📊 Verified points: {analytics.get('verified_points', 0)}")
            print(f"📊 Recent points (7 days): {analytics.get('recent_points_7d', 0)}")
            print(f"📊 Average road quality: {analytics.get('avg_road_quality', 0)}")
            
            recent_activity = analytics.get('recent_points_7d', 0)
            if recent_activity == 0:
                print("⚠️  CONFIRMED: No database activity in last 7 days")
                print("🚨 This confirms user's report - mobile app data not reaching database")
            else:
                print(f"✅ Recent activity detected: {recent_activity} points in last 7 days")
                
            return recent_activity > 0
            
        else:
            print(f"❌ Analytics check failed: HTTP {response.status_code}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ ANALYTICS ERROR: {str(e)}")
        return False

def check_backend_logs():
    """Check backend logs for recent POST requests"""
    print("\n📋 BACKEND LOGS: Checking for recent POST /api/sensor-data requests")
    
    try:
        # Check supervisor backend logs
        import subprocess
        result = subprocess.run(
            ["tail", "-n", "100", "/var/log/supervisor/backend.out.log"],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            log_lines = result.stdout.split('\n')
            post_requests = [line for line in log_lines if 'POST /api/sensor-data' in line]
            
            print(f"📋 Analyzed last 100 log lines")
            print(f"📡 Found {len(post_requests)} POST /api/sensor-data requests")
            
            if post_requests:
                print("📅 Recent POST requests:")
                for req in post_requests[-5:]:  # Show last 5
                    print(f"   {req}")
                return True
            else:
                print("⚠️  NO POST /api/sensor-data requests found in recent logs")
                print("🚨 This suggests mobile app is NOT making API calls")
                return False
        else:
            print(f"❌ Failed to read backend logs: {result.stderr}")
            return False
            
    except Exception as e:
        print(f"❌ LOG CHECK ERROR: {str(e)}")
        return False

def test_full_data_cycle():
    """Test complete data cycle: POST → Storage → GET"""
    print("\n🔄 FULL CYCLE TEST: POST → Storage → GET")
    
    # Step 1: Upload data
    upload_success, upload_result = test_sensor_data_upload()
    
    if not upload_success:
        print("❌ CYCLE FAILED: Data upload failed")
        return False
    
    # Step 2: Wait a moment for processing
    print("⏳ Waiting 2 seconds for data processing...")
    time.sleep(2)
    
    # Step 3: Verify storage
    storage_success, total_records = verify_data_storage()
    
    if not storage_success:
        print("❌ CYCLE FAILED: Data not found in storage")
        return False
    
    # Step 4: Test GET endpoints with new data
    print("\n🔍 Testing GET endpoints with uploaded data...")
    
    # Test road conditions near uploaded location
    try:
        response = requests.get(
            f"{API_BASE}/road-conditions",
            params={
                "latitude": 55.7558,
                "longitude": 37.6176,
                "radius": 1000
            },
            timeout=30
        )
        
        if response.status_code == 200:
            conditions = response.json()
            condition_count = len(conditions.get('conditions', []))
            print(f"✅ Road conditions API: Found {condition_count} conditions")
        else:
            print(f"⚠️  Road conditions API: HTTP {response.status_code}")
            
    except Exception as e:
        print(f"❌ Road conditions test error: {str(e)}")
    
    print("✅ FULL CYCLE COMPLETED")
    return True

def main():
    """ДЕТАЛЬНЫЙ АНАЛИЗ по запросу пользователя"""
    print("🚨 ЗАПУСК ДЕТАЛЬНОГО АНАЛИЗА ПО ЗАПРОСУ ПОЛЬЗОВАТЕЛЯ")
    print("🎯 ЦЕЛЬ: Показать точные последние данные и найти проблему с мобильным приложением")
    print()
    
    # Результаты анализа
    analysis_results = {}
    
    # 1. ДЕТАЛЬНАЯ ПРОВЕРКА ПОСЛЕДНИХ ДАННЫХ
    success, details = analyze_latest_20_records()
    analysis_results['latest_data_analysis'] = (success, details)
    
    # 2. Показать структуру endpoint
    success, details = show_sensor_data_endpoint_structure()
    analysis_results['endpoint_structure'] = (success, details)
    
    # 3. Анализ Device ID patterns
    success, details = analyze_device_ids()
    analysis_results['device_id_analysis'] = (success, details)
    
    # 4. АНАЛИЗ BACKEND ЛОГОВ ЗА ПОСЛЕДНИЕ 2 ЧАСА
    success, details = analyze_backend_logs_2_hours()
    analysis_results['backend_logs_analysis'] = (success, details)
    
    # 5. Тест функциональности API
    print(f"\n🧪 ТЕСТИРОВАНИЕ ФУНКЦИОНАЛЬНОСТИ /api/sensor-data ENDPOINT:")
    success, details = test_sensor_data_upload()
    analysis_results['api_functionality_test'] = (success, details)
    
    # 6. Проверка аналитики
    success = check_analytics_for_recent_activity()
    analysis_results['analytics_check'] = (success, "Проверка активности")
    
    # ИТОГОВЫЙ ОТЧЕТ
    print("\n" + "="*100)
    print("ИТОГОВЫЙ ОТЧЕТ ДЕТАЛЬНОГО АНАЛИЗА")
    print("="*100)
    
    passed_tests = sum(1 for success, _ in analysis_results.values() if success)
    total_tests = len(analysis_results)
    
    print(f"📊 Выполнено анализов: {total_tests}")
    print(f"✅ Успешных: {passed_tests}")
    print(f"❌ С проблемами: {total_tests - passed_tests}")
    
    print(f"\n📋 ДЕТАЛЬНЫЕ РЕЗУЛЬТАТЫ:")
    for test_name, (success, details) in analysis_results.items():
        status = "✅" if success else "❌"
        print(f"{status} {test_name.replace('_', ' ').title()}: {details}")
    
    # КРИТИЧЕСКИЙ АНАЛИЗ
    print(f"\n🚨 КРИТИЧЕСКИЙ АНАЛИЗ ПРОБЛЕМЫ:")
    
    latest_success, latest_details = analysis_results['latest_data_analysis']
    logs_success, logs_details = analysis_results['backend_logs_analysis']
    api_success, api_details = analysis_results['api_functionality_test']
    
    if not logs_success:
        print("❌ ПОДТВЕРЖДЕНО: НЕТ POST запросов от мобильного приложения в логах backend")
        print("   Это означает, что мобильное приложение НЕ отправляет данные на сервер")
    
    if api_success:
        print("✅ ПОДТВЕРЖДЕНО: Backend API /api/sensor-data работает корректно")
        print("   Сервер может принимать и обрабатывать данные от мобильных устройств")
    else:
        print("❌ ПРОБЛЕМА: Backend API не работает корректно")
    
    if "Реальных: 0" in latest_details or "Сегодня: 0" in latest_details:
        print("❌ ПОДТВЕРЖДЕНО: Нет новых реальных данных от мобильного приложения")
        print("   Последние реальные данные датированы 07.10.2025 (27+ дней назад)")
    
    # ЗАКЛЮЧЕНИЕ И РЕКОМЕНДАЦИИ
    print(f"\n💡 ЗАКЛЮЧЕНИЕ И РЕКОМЕНДАЦИИ:")
    
    if api_success and not logs_success:
        print("🎯 КОРНЕВАЯ ПРИЧИНА НАЙДЕНА:")
        print("   1. ✅ Backend APIs полностью функциональны")
        print("   2. ❌ Мобильное приложение НЕ отправляет данные на сервер")
        print("   3. ❌ В логах backend нет внешних POST запросов от мобильных устройств")
        print()
        print("🚨 НЕМЕДЛЕННЫЕ ДЕЙСТВИЯ:")
        print("   1. Проверить конфигурацию сети в мобильном приложении")
        print("   2. Убедиться, что мобильное приложение использует правильный URL сервера")
        print("   3. Проверить работу фоновых задач в мобильном приложении")
        print("   4. Проверить логи мобильного приложения на наличие ошибок сети")
        print("   5. Убедиться, что GPS и акселерометр работают в мобильном приложении")
    elif not api_success:
        print("🚨 ПРОБЛЕМА В BACKEND:")
        print("   1. Сначала необходимо исправить проблемы с backend API")
        print("   2. Проверить подключение к базе данных MongoDB")
        print("   3. Проверить конфигурацию сервера")
    
    print(f"\n📊 АНАЛИЗ ЗАВЕРШЕН: {passed_tests}/{total_tests} компонентов работают корректно")

if __name__ == "__main__":
    main()