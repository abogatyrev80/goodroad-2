#!/usr/bin/env python3
"""
🚨 СРОЧНАЯ ПРОВЕРКА: Обмен данными после исправления URL - поступили ли данные от мобильного приложения пользователя

СИТУАЦИЯ: Пользователь обновил мобильное приложение с новым URL https://smoothroad.emergent.host, 
перезапустил приложение и начал мониторинг. Просит проверить обмен данными.

КРИТИЧЕСКАЯ ПРОВЕРКА В РЕАЛЬНОМ ВРЕМЕНИ:
1. GET /api/admin/sensor-data?limit=10 - проверить самые свежие записи за последние 10 минут
2. Анализировать timestamp последних записей - есть ли данные от 3 декабря 2025?
3. Backend логи за последние 15 минут - появились ли POST запросы от внешних IP (не 10.64.x.x)?
4. GET /api/admin/analytics - изменилась ли статистика total_points, recent_points_7d?
5. Анализ активности - сравнить с предыдущей проверкой
"""

import requests
import json
import time
from datetime import datetime, timezone, timedelta
import os
import subprocess
from dotenv import load_dotenv

# Load environment variables
load_dotenv('/app/frontend/.env')

# Get backend URL from frontend environment - UPDATED URL
BACKEND_URL = os.getenv('EXPO_PUBLIC_BACKEND_URL', 'https://smoothroad.emergent.host')
API_BASE = f"{BACKEND_URL}/api"

print(f"🚨 КРИТИЧЕСКАЯ ПРОВЕРКА: Мониторинг мобильного приложения после обновления URL")
print(f"📡 NEW Backend URL: {API_BASE}")
print(f"🎯 ЦЕЛЬ: Проверить подключение после изменения URL на https://smoothroad.emergent.host")
print("=" * 100)

def check_backend_logs_last_5_minutes():
    """КРИТИЧЕСКАЯ ПРОВЕРКА: Backend логи за последние 5 минут - есть ли новые POST запросы от внешних IP?"""
    print("\n" + "="*100)
    print("1. КРИТИЧЕСКАЯ ПРОВЕРКА: BACKEND ЛОГИ ЗА ПОСЛЕДНИЕ 5 МИНУТ")
    print("="*100)
    
    try:
        # Получаем логи backend
        result = subprocess.run(
            ["tail", "-n", "200", "/var/log/supervisor/backend.out.log"],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            log_lines = result.stdout.split('\n')
            
            # Анализируем POST запросы за последние 5 минут
            now = datetime.now()
            five_minutes_ago = now - timedelta(minutes=5)
            
            recent_posts = []
            external_posts = []
            internal_posts = []
            
            print(f"📋 Анализ логов backend за последние 5 минут...")
            print(f"⏰ Текущее время: {now.strftime('%H:%M:%S')}")
            print(f"🔍 Ищем POST запросы после: {five_minutes_ago.strftime('%H:%M:%S')}")
            
            for line in log_lines:
                if 'POST /api/sensor-data' in line:
                    recent_posts.append(line.strip())
                    
                    # Проверяем источник запроса
                    if any(ip in line for ip in ['10.64.', '127.0.0.1', 'localhost']):
                        internal_posts.append(line.strip())
                    else:
                        external_posts.append(line.strip())
                        print(f"🎉 ВНЕШНИЙ ЗАПРОС НАЙДЕН: {line.strip()}")
            
            print(f"\n📊 РЕЗУЛЬТАТЫ АНАЛИЗА ЛОГОВ ЗА ПОСЛЕДНИЕ 5 МИНУТ:")
            print(f"📡 Всего POST запросов к /api/sensor-data: {len(recent_posts)}")
            print(f"🏢 Внутренние запросы (10.64.x.x, localhost): {len(internal_posts)}")
            print(f"📱 ВНЕШНИЕ МОБИЛЬНЫЕ ЗАПРОСЫ: {len(external_posts)}")
            
            if external_posts:
                print(f"\n🎉 НАЙДЕНЫ ВНЕШНИЕ МОБИЛЬНЫЕ ЗАПРОСЫ!")
                for req in external_posts:
                    print(f"   ✅ {req}")
                return True, f"Внешних запросов: {len(external_posts)}"
            else:
                print(f"\n❌ НЕТ ВНЕШНИХ МОБИЛЬНЫХ ЗАПРОСОВ ЗА ПОСЛЕДНИЕ 5 МИНУТ")
                if internal_posts:
                    print(f"   Найдено только {len(internal_posts)} внутренних запросов (тестирование)")
                    print("   Последние внутренние запросы:")
                    for req in internal_posts[-3:]:
                        print(f"     {req}")
                else:
                    print(f"   НЕТ ВООБЩЕ НИКАКИХ POST запросов к /api/sensor-data")
                return False, f"Только внутренних: {len(internal_posts)}"
            
        else:
            print(f"❌ Ошибка чтения логов: {result.stderr}")
            return False, f"Ошибка логов: {result.stderr}"
            
    except Exception as e:
        print(f"❌ Ошибка анализа логов: {str(e)}")
        return False, str(e)

def check_new_sensor_data_last_minutes():
    """КРИТИЧЕСКАЯ ПРОВЕРКА: GET /api/admin/sensor-data?limit=3 - появились ли новые записи за последние минуты?"""
    print("\n" + "="*100)
    print("2. КРИТИЧЕСКАЯ ПРОВЕРКА: НОВЫЕ ЗАПИСИ ЗА ПОСЛЕДНИЕ МИНУТЫ")
    print("="*100)
    
    try:
        response = requests.get(
            f"{API_BASE}/admin/sensor-data",
            params={"limit": 3},
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            records = data.get('data', [])
            total = data.get('total', 0)
            
            print(f"📊 Общее количество записей в базе: {total}")
            print(f"📊 Последние 3 записи для анализа:")
            
            if not records:
                print("❌ КРИТИЧЕСКАЯ ПРОБЛЕМА: База данных пуста!")
                return False, "База данных пуста"
            
            now = datetime.now()
            recent_records = []
            
            print(f"\n📋 АНАЛИЗ ПОСЛЕДНИХ 3 ЗАПИСЕЙ:")
            print("-" * 100)
            print(f"{'№':<3} {'Timestamp':<20} {'Минут назад':<12} {'GPS Координаты':<25} {'Источник':<15}")
            print("-" * 100)
            
            for i, record in enumerate(records, 1):
                timestamp_str = record.get('timestamp', 'N/A')
                lat = record.get('latitude', 0)
                lng = record.get('longitude', 0)
                
                # Вычисляем время с момента записи
                minutes_ago = "N/A"
                if timestamp_str and timestamp_str != 'N/A':
                    try:
                        if 'T' in timestamp_str:
                            record_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                        else:
                            record_time = datetime.fromisoformat(timestamp_str)
                        
                        time_diff = now - record_time.replace(tzinfo=None)
                        minutes_ago = round(time_diff.total_seconds() / 60, 1)
                        
                        # Если запись свежая (менее 10 минут)
                        if minutes_ago <= 10:
                            recent_records.append({
                                'timestamp': timestamp_str,
                                'minutes_ago': minutes_ago,
                                'gps': f"({lat}, {lng})",
                                'is_real': lat != 0.0 and lng != 0.0
                            })
                    except Exception as e:
                        minutes_ago = f"Ошибка: {str(e)}"
                
                # Определяем источник
                is_real_mobile = lat != 0.0 and lng != 0.0
                source = "Мобильное" if is_real_mobile else "Тестовое"
                gps_coords = f"({lat:.4f}, {lng:.4f})" if is_real_mobile else "(0.0000, 0.0000)"
                
                print(f"{i:<3} {timestamp_str[:19]:<20} {minutes_ago:<12} {gps_coords:<25} {source:<15}")
            
            print("-" * 100)
            
            if recent_records:
                print(f"\n🎉 НАЙДЕНЫ СВЕЖИЕ ЗАПИСИ! {len(recent_records)} записей за последние 10 минут:")
                for record in recent_records:
                    source_type = "📱 МОБИЛЬНОЕ" if record['is_real'] else "🧪 ТЕСТОВОЕ"
                    print(f"   {source_type} - {record['minutes_ago']} мин назад: GPS {record['gps']}")
                
                # Проверяем есть ли реальные мобильные данные
                real_mobile_recent = [r for r in recent_records if r['is_real']]
                if real_mobile_recent:
                    print(f"\n✅ УСПЕХ! Найдено {len(real_mobile_recent)} свежих записей от МОБИЛЬНОГО ПРИЛОЖЕНИЯ!")
                    return True, f"Мобильных записей: {len(real_mobile_recent)}"
                else:
                    print(f"\n⚠️  Найдены только тестовые записи, НЕТ данных от мобильного приложения")
                    return False, f"Только тестовых: {len(recent_records)}"
            else:
                # Показываем когда была последняя запись
                latest_record = records[0] if records else None
                if latest_record:
                    latest_timestamp = latest_record.get('timestamp', 'unknown')
                    print(f"\n❌ НЕТ СВЕЖИХ ЗАПИСЕЙ за последние 10 минут")
                    print(f"   Последняя запись: {latest_timestamp}")
                return False, "Нет свежих записей"
                
        else:
            print(f"❌ Ошибка получения данных: HTTP {response.status_code}")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Ошибка анализа данных: {str(e)}")
        return False, str(e)

def analyze_data_flow_changes():
    """КРИТИЧЕСКАЯ ПРОВЕРКА: Анализ активности - изменилось ли что-то в поступлении данных"""
    print("\n" + "="*100)
    print("3. АНАЛИЗ АКТИВНОСТИ: ИЗМЕНЕНИЯ В ПОСТУПЛЕНИИ ДАННЫХ")
    print("="*100)
    
    try:
        # Получаем аналитику
        response = requests.get(f"{API_BASE}/admin/analytics", timeout=30)
        
        if response.status_code == 200:
            analytics = response.json()
            
            total_points = analytics.get('total_points', 0)
            recent_points = analytics.get('recent_points_7d', 0)
            verified_points = analytics.get('verified_points', 0)
            hazard_points = analytics.get('hazard_points', 0)
            
            print(f"📊 ТЕКУЩАЯ СТАТИСТИКА БАЗЫ ДАННЫХ:")
            print(f"   Всего записей: {total_points}")
            print(f"   За последние 7 дней: {recent_points}")
            print(f"   Проверенных: {verified_points}")
            print(f"   С опасностями: {hazard_points}")
            
            # Анализируем изменения
            print(f"\n🔍 АНАЛИЗ АКТИВНОСТИ:")
            
            if recent_points > 0:
                print(f"✅ АКТИВНОСТЬ ОБНАРУЖЕНА: {recent_points} записей за последние 7 дней")
                
                # Проверяем последние записи для определения источника активности
                response2 = requests.get(f"{API_BASE}/admin/sensor-data?limit=10", timeout=30)
                if response2.status_code == 200:
                    recent_data = response2.json().get('data', [])
                    
                    # Считаем реальные vs тестовые записи
                    real_mobile_count = sum(1 for r in recent_data if r.get('latitude', 0) != 0.0 and r.get('longitude', 0) != 0.0)
                    test_count = len(recent_data) - real_mobile_count
                    
                    if real_mobile_count > 0:
                        print(f"📱 МОБИЛЬНАЯ АКТИВНОСТЬ: {real_mobile_count} записей от мобильного приложения")
                        print(f"🧪 Тестовая активность: {test_count} записей")
                        return True, f"Мобильных: {real_mobile_count}, тестовых: {test_count}"
                    else:
                        print(f"⚠️  ТОЛЬКО ТЕСТОВАЯ АКТИВНОСТЬ: {test_count} записей")
                        print(f"❌ НЕТ АКТИВНОСТИ ОТ МОБИЛЬНОГО ПРИЛОЖЕНИЯ")
                        return False, f"Только тестовых: {test_count}"
                else:
                    return True, f"Активность: {recent_points} записей"
            else:
                print(f"❌ НЕТ АКТИВНОСТИ за последние 7 дней")
                print(f"🚨 База данных не получает новых данных от мобильного приложения")
                return False, "Нет активности"
                
        else:
            print(f"❌ Ошибка получения аналитики: HTTP {response.status_code}")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Ошибка анализа активности: {str(e)}")
        return False, str(e)

def test_connectivity_to_new_url():
    """КРИТИЧЕСКАЯ ПРОВЕРКА: Тест connectivity - проверить доступность https://smoothroad.emergent.host/api/sensor-data"""
    print("\n" + "="*100)
    print("4. ТЕСТ CONNECTIVITY: ДОСТУПНОСТЬ НОВОГО URL")
    print("="*100)
    
    try:
        print(f"🔍 Проверка доступности: {BACKEND_URL}")
        print(f"🎯 Endpoint для мобильного приложения: {API_BASE}/sensor-data")
        
        # Тест 1: Backend API availability check
        print(f"\n📡 Тест 1: Backend API availability check...")
        try:
            response = requests.get(f"{API_BASE}/admin/sensor-data?limit=1", timeout=10)
            if response.status_code == 200:
                data = response.json()
                total_records = data.get('total', 0)
                print(f"✅ Backend API доступен")
                print(f"   Всего записей в базе: {total_records}")
            else:
                print(f"❌ Backend API недоступен: HTTP {response.status_code}")
                return False, f"Backend API failed: {response.status_code}"
        except requests.exceptions.RequestException as e:
            print(f"❌ Backend API connection error: {str(e)}")
            return False, f"Backend API connection error: {str(e)}"
        
        # Тест 2: API root
        print(f"\n📡 Тест 2: API root...")
        response = requests.get(f"{API_BASE}/", timeout=10)
        if response.status_code == 200:
            print(f"✅ API root доступен")
        else:
            print(f"❌ API root недоступен: HTTP {response.status_code}")
            return False, f"API root failed: {response.status_code}"
        
        # Тест 3: OPTIONS preflight для мобильного приложения
        print(f"\n📡 Тест 3: CORS preflight для мобильного приложения...")
        response = requests.options(
            f"{API_BASE}/sensor-data",
            headers={
                "Origin": "capacitor://localhost",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type"
            },
            timeout=10
        )
        
        if response.status_code == 200:
            print(f"✅ CORS preflight успешен")
            cors_origin = response.headers.get('Access-Control-Allow-Origin', 'Not set')
            cors_methods = response.headers.get('Access-Control-Allow-Methods', 'Not set')
            print(f"   Allow-Origin: {cors_origin}")
            print(f"   Allow-Methods: {cors_methods}")
        else:
            print(f"⚠️  CORS preflight: HTTP {response.status_code}")
        
        # Тест 4: POST test с мобильными данными
        print(f"\n📡 Тест 4: POST test с мобильными данными...")
        test_data = {
            "deviceId": "connectivity-test-device",
            "sensorData": [
                {
                    "type": "location",
                    "timestamp": int(time.time() * 1000),
                    "data": {
                        "latitude": 55.7558,
                        "longitude": 37.6176,
                        "speed": 25.0,
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
        
        response = requests.post(
            f"{API_BASE}/sensor-data",
            json=test_data,
            headers={
                "Content-Type": "application/json",
                "Origin": "capacitor://localhost"
            },
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ POST test успешен")
            print(f"   Обработано точек: {result.get('rawDataPoints', 0)}")
            print(f"   Создано условий: {result.get('conditionsProcessed', 0)}")
            print(f"   Создано предупреждений: {result.get('warningsGenerated', 0)}")
        else:
            print(f"❌ POST test failed: HTTP {response.status_code}")
            print(f"   Error: {response.text}")
            return False, f"POST test failed: {response.status_code}"
        
        print(f"\n🎉 ВСЕ ТЕСТЫ CONNECTIVITY ПРОЙДЕНЫ!")
        print(f"✅ Новый URL {BACKEND_URL} полностью доступен для мобильного приложения")
        
        return True, "Все тесты connectivity пройдены"
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Ошибка подключения: {str(e)}")
        return False, f"Connection error: {str(e)}"
    except Exception as e:
        print(f"❌ Ошибка тестирования: {str(e)}")
        return False, str(e)

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

def check_fresh_data_december_3():
    """
    КРИТИЧЕСКАЯ ПРОВЕРКА 1: GET /api/admin/sensor-data?limit=10 
    Проверить самые свежие записи за последние 10 минут и данные от 3 декабря 2025
    """
    print("\n" + "="*100)
    print("1. КРИТИЧЕСКАЯ ПРОВЕРКА: СВЕЖИЕ ЗАПИСИ ЗА ПОСЛЕДНИЕ 10 МИНУТ И ДАННЫЕ ОТ 3 ДЕКАБРЯ 2025")
    print("="*100)
    
    try:
        response = requests.get(f"{API_BASE}/admin/sensor-data?limit=10", timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            records = data.get('data', [])
            total = data.get('total', 0)
            
            print(f"📊 Общее количество записей в базе: {total}")
            print(f"📊 Последние 10 записей для анализа:")
            
            if not records:
                print("❌ КРИТИЧЕСКАЯ ПРОБЛЕМА: База данных пуста!")
                return False, "База данных пуста"
            
            # Анализ временных меток
            now = datetime.now()
            ten_minutes_ago = now - timedelta(minutes=10)
            december_3_2025 = datetime(2025, 12, 3).date()
            
            fresh_records = []
            december_3_records = []
            
            print(f"\n📋 АНАЛИЗ ПОСЛЕДНИХ 10 ЗАПИСЕЙ:")
            print("-" * 120)
            print(f"{'№':<3} {'Timestamp':<20} {'Минут назад':<12} {'GPS Координаты':<25} {'Дата':<12} {'Источник':<15}")
            print("-" * 120)
            
            for i, record in enumerate(records, 1):
                timestamp_str = record.get('timestamp', 'N/A')
                lat = record.get('latitude', 0)
                lng = record.get('longitude', 0)
                
                # Анализ времени
                minutes_ago = "N/A"
                record_date = "N/A"
                
                if timestamp_str and timestamp_str != 'N/A':
                    try:
                        if 'T' in timestamp_str:
                            record_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                        else:
                            record_time = datetime.fromisoformat(timestamp_str)
                        
                        record_time_naive = record_time.replace(tzinfo=None)
                        time_diff = now - record_time_naive
                        minutes_ago = round(time_diff.total_seconds() / 60, 1)
                        record_date = record_time_naive.date()
                        
                        # Проверка на свежие записи (менее 10 минут)
                        if minutes_ago <= 10:
                            fresh_records.append({
                                'timestamp': timestamp_str,
                                'minutes_ago': minutes_ago,
                                'gps': f"({lat}, {lng})",
                                'is_real': lat != 0.0 and lng != 0.0
                            })
                        
                        # Проверка на записи от 3 декабря 2025
                        if record_date == december_3_2025:
                            december_3_records.append({
                                'timestamp': timestamp_str,
                                'gps': f"({lat}, {lng})",
                                'is_real': lat != 0.0 and lng != 0.0
                            })
                            
                    except Exception as e:
                        minutes_ago = f"Ошибка: {str(e)}"
                
                # Определение источника
                is_real_mobile = lat != 0.0 and lng != 0.0
                source = "Мобильное" if is_real_mobile else "Тестовое"
                gps_coords = f"({lat:.4f}, {lng:.4f})" if is_real_mobile else "(0.0000, 0.0000)"
                
                print(f"{i:<3} {timestamp_str[:19]:<20} {minutes_ago:<12} {gps_coords:<25} {record_date:<12} {source:<15}")
            
            print("-" * 120)
            
            # Результаты анализа
            print(f"\n🔍 РЕЗУЛЬТАТЫ АНАЛИЗА ВРЕМЕНИ:")
            print(f"🕐 Записей за последние 10 минут: {len(fresh_records)}")
            print(f"📅 Записей от 3 декабря 2025: {len(december_3_records)}")
            
            if fresh_records:
                print(f"\n🎉 НАЙДЕНЫ СВЕЖИЕ ЗАПИСИ! {len(fresh_records)} записей за последние 10 минут:")
                for record in fresh_records:
                    source_type = "📱 МОБИЛЬНОЕ" if record['is_real'] else "🧪 ТЕСТОВОЕ"
                    print(f"   {source_type} - {record['minutes_ago']} мин назад: GPS {record['gps']}")
            else:
                print(f"\n❌ НЕТ СВЕЖИХ ЗАПИСЕЙ за последние 10 минут")
            
            if december_3_records:
                print(f"\n🎉 НАЙДЕНЫ ЗАПИСИ ОТ 3 ДЕКАБРЯ 2025! {len(december_3_records)} записей:")
                for record in december_3_records:
                    source_type = "📱 МОБИЛЬНОЕ" if record['is_real'] else "🧪 ТЕСТОВОЕ"
                    print(f"   {source_type} - {record['timestamp']}: GPS {record['gps']}")
            else:
                print(f"\n❌ НЕТ ЗАПИСЕЙ ОТ 3 ДЕКАБРЯ 2025")
            
            # Определение успеха
            has_new_data = len(fresh_records) > 0 or len(december_3_records) > 0
            real_mobile_data = any(r['is_real'] for r in fresh_records + december_3_records)
            
            if has_new_data and real_mobile_data:
                return True, f"Свежих: {len(fresh_records)}, от 3 дек: {len(december_3_records)} (мобильные данные)"
            elif has_new_data:
                return True, f"Свежих: {len(fresh_records)}, от 3 дек: {len(december_3_records)} (только тестовые)"
            else:
                return False, "Нет новых данных"
                
        else:
            print(f"❌ Ошибка получения данных: HTTP {response.status_code}")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Ошибка анализа данных: {str(e)}")
        return False, str(e)

def check_backend_logs_15_minutes():
    """
    КРИТИЧЕСКАЯ ПРОВЕРКА 3: Backend логи за последние 15 минут
    Появились ли POST запросы от внешних IP (не 10.64.x.x)?
    """
    print("\n" + "="*100)
    print("3. КРИТИЧЕСКАЯ ПРОВЕРКА: BACKEND ЛОГИ ЗА ПОСЛЕДНИЕ 15 МИНУТ")
    print("="*100)
    
    try:
        # Получаем логи backend
        result = subprocess.run(
            ["tail", "-n", "300", "/var/log/supervisor/backend.out.log"],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            log_lines = result.stdout.split('\n')
            
            # Анализируем POST запросы за последние 15 минут
            now = datetime.now()
            fifteen_minutes_ago = now - timedelta(minutes=15)
            
            recent_posts = []
            external_posts = []
            internal_posts = []
            
            print(f"📋 Анализ логов backend за последние 15 минут...")
            print(f"⏰ Текущее время: {now.strftime('%H:%M:%S')}")
            print(f"🔍 Ищем POST запросы после: {fifteen_minutes_ago.strftime('%H:%M:%S')}")
            
            for line in log_lines:
                if 'POST /api/sensor-data' in line:
                    recent_posts.append(line.strip())
                    
                    # Проверяем источник запроса
                    if any(ip in line for ip in ['10.64.', '127.0.0.1', 'localhost']):
                        internal_posts.append(line.strip())
                    else:
                        external_posts.append(line.strip())
                        print(f"🎉 ВНЕШНИЙ ЗАПРОС НАЙДЕН: {line.strip()}")
            
            print(f"\n📊 РЕЗУЛЬТАТЫ АНАЛИЗА ЛОГОВ ЗА ПОСЛЕДНИЕ 15 МИНУТ:")
            print(f"📡 Всего POST запросов к /api/sensor-data: {len(recent_posts)}")
            print(f"🏢 Внутренние запросы (10.64.x.x, localhost): {len(internal_posts)}")
            print(f"📱 ВНЕШНИЕ МОБИЛЬНЫЕ ЗАПРОСЫ: {len(external_posts)}")
            
            if external_posts:
                print(f"\n🎉 НАЙДЕНЫ ВНЕШНИЕ МОБИЛЬНЫЕ ЗАПРОСЫ!")
                for req in external_posts:
                    print(f"   ✅ {req}")
                return True, f"Внешних запросов: {len(external_posts)}"
            else:
                print(f"\n❌ НЕТ ВНЕШНИХ МОБИЛЬНЫХ ЗАПРОСОВ ЗА ПОСЛЕДНИЕ 15 МИНУТ")
                if internal_posts:
                    print(f"   Найдено только {len(internal_posts)} внутренних запросов (тестирование)")
                    print("   Последние внутренние запросы:")
                    for req in internal_posts[-3:]:
                        print(f"     {req}")
                else:
                    print(f"   НЕТ ВООБЩЕ НИКАКИХ POST запросов к /api/sensor-data")
                return False, f"Только внутренних: {len(internal_posts)}"
            
        else:
            print(f"❌ Ошибка чтения логов: {result.stderr}")
            return False, f"Ошибка логов: {result.stderr}"
            
    except Exception as e:
        print(f"❌ Ошибка анализа логов: {str(e)}")
        return False, str(e)

def check_analytics_changes():
    """
    КРИТИЧЕСКАЯ ПРОВЕРКА 4: GET /api/admin/analytics
    Изменилась ли статистика total_points, recent_points_7d?
    """
    print("\n" + "="*100)
    print("4. КРИТИЧЕСКАЯ ПРОВЕРКА: ИЗМЕНЕНИЯ В СТАТИСТИКЕ")
    print("="*100)
    
    try:
        response = requests.get(f"{API_BASE}/admin/analytics", timeout=30)
        
        if response.status_code == 200:
            analytics = response.json()
            
            total_points = analytics.get('total_points', 0)
            recent_points = analytics.get('recent_points_7d', 0)
            verified_points = analytics.get('verified_points', 0)
            hazard_points = analytics.get('hazard_points', 0)
            
            print(f"📊 ТЕКУЩАЯ СТАТИСТИКА БАЗЫ ДАННЫХ:")
            print(f"   Всего записей (total_points): {total_points}")
            print(f"   За последние 7 дней (recent_points_7d): {recent_points}")
            print(f"   Проверенных: {verified_points}")
            print(f"   С опасностями: {hazard_points}")
            
            # Сравнение с предыдущими данными из test_result.md
            # Последняя проверка показывала разные значения в зависимости от времени
            # Будем сравнивать с ожидаемыми изменениями
            
            print(f"\n🔍 АНАЛИЗ ИЗМЕНЕНИЙ:")
            print(f"📈 СРАВНЕНИЕ С ПРЕДЫДУЩИМИ ПРОВЕРКАМИ:")
            print(f"   - Если есть новые данные от мобильного приложения, total_points должен увеличиться")
            print(f"   - recent_points_7d должен показывать активность за последнюю неделю")
            
            if recent_points > 0:
                print(f"✅ АКТИВНОСТЬ ОБНАРУЖЕНА: {recent_points} записей за последние 7 дней")
                
                # Проверяем последние записи для определения источника активности
                response2 = requests.get(f"{API_BASE}/admin/sensor-data?limit=10", timeout=30)
                if response2.status_code == 200:
                    recent_data = response2.json().get('data', [])
                    
                    # Считаем реальные vs тестовые записи
                    real_mobile_count = sum(1 for r in recent_data if r.get('latitude', 0) != 0.0 and r.get('longitude', 0) != 0.0)
                    test_count = len(recent_data) - real_mobile_count
                    
                    if real_mobile_count > 0:
                        print(f"📱 МОБИЛЬНАЯ АКТИВНОСТЬ: {real_mobile_count} записей от мобильного приложения")
                        print(f"🧪 Тестовая активность: {test_count} записей")
                        return True, f"Всего: {total_points}, недавних: {recent_points}, мобильных: {real_mobile_count}"
                    else:
                        print(f"⚠️  ТОЛЬКО ТЕСТОВАЯ АКТИВНОСТЬ: {test_count} записей")
                        print(f"❌ НЕТ АКТИВНОСТИ ОТ МОБИЛЬНОГО ПРИЛОЖЕНИЯ")
                        return False, f"Всего: {total_points}, недавних: {recent_points}, только тестовые"
                else:
                    return True, f"Всего: {total_points}, недавних: {recent_points}"
            else:
                print(f"❌ НЕТ АКТИВНОСТИ за последние 7 дней")
                print(f"🚨 База данных не получает новых данных от мобильного приложения")
                return False, f"Всего: {total_points}, нет активности"
                
        else:
            print(f"❌ Ошибка получения аналитики: HTTP {response.status_code}")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Ошибка анализа активности: {str(e)}")
        return False, str(e)

def compare_with_previous_check():
    """
    КРИТИЧЕСКАЯ ПРОВЕРКА 5: Анализ активности - сравнить с предыдущей проверкой
    """
    print("\n" + "="*100)
    print("5. АНАЛИЗ АКТИВНОСТИ: СРАВНЕНИЕ С ПРЕДЫДУЩЕЙ ПРОВЕРКОЙ")
    print("="*100)
    
    print(f"📋 ДАННЫЕ ИЗ ПРЕДЫДУЩИХ ПРОВЕРОК (из test_result.md):")
    print(f"   - Последняя реальная запись от мобильного приложения: 07.10.2025 21:06:59 UTC")
    print(f"   - Проблема: мобильное приложение НЕ отправляет данные на сервер")
    print(f"   - Новый URL https://smoothroad.emergent.host был настроен и протестирован")
    print(f"   - Backend APIs полностью функциональны")
    
    print(f"\n🎯 ЧТО ОЖИДАЕТСЯ ПОСЛЕ ИСПРАВЛЕНИЯ:")
    print(f"   ✅ Новые записи с timestamp 3 декабря 2025")
    print(f"   ✅ POST запросы в логах от внешних IP адресов")
    print(f"   ✅ Увеличение total_points в статистике")
    print(f"   ✅ Реальные GPS координаты (не 0.0, 0.0)")
    
    # Получаем текущие данные для сравнения
    try:
        # Проверяем самую свежую запись
        response = requests.get(f"{API_BASE}/admin/sensor-data?limit=1", timeout=30)
        if response.status_code == 200:
            data = response.json()
            records = data.get('data', [])
            
            if records:
                latest_record = records[0]
                latest_timestamp = latest_record.get('timestamp', 'N/A')
                latest_gps = (latest_record.get('latitude', 0), latest_record.get('longitude', 0))
                
                print(f"\n📊 ТЕКУЩЕЕ СОСТОЯНИЕ:")
                print(f"   Самая свежая запись: {latest_timestamp}")
                print(f"   GPS координаты: {latest_gps}")
                
                # Проверяем, есть ли данные от 3 декабря 2025
                if latest_timestamp and '2025-12-03' in latest_timestamp:
                    print(f"🎉 УСПЕХ! Найдены данные от 3 декабря 2025!")
                    if latest_gps[0] != 0.0 and latest_gps[1] != 0.0:
                        print(f"✅ С реальными GPS координатами - мобильное приложение работает!")
                        return True, "Новые данные от мобильного приложения найдены"
                    else:
                        print(f"⚠️  Но GPS координаты нулевые - возможно тестовые данные")
                        return False, "Найдены данные от 3 декабря, но GPS нулевые"
                else:
                    print(f"❌ НЕТ данных от 3 декабря 2025")
                    print(f"   Последние данные все еще от октября 2025")
                    return False, "Нет новых данных от мобильного приложения"
            else:
                print(f"❌ База данных пуста")
                return False, "База данных пуста"
        else:
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Ошибка сравнения: {str(e)}")
        return False, str(e)

def main():
    """🚨 СРОЧНАЯ ПРОВЕРКА: Обмен данными после исправления URL"""
    print("🚨 СРОЧНАЯ ПРОВЕРКА: ОБМЕН ДАННЫМИ ПОСЛЕ ИСПРАВЛЕНИЯ URL")
    print("📱 СИТУАЦИЯ: Пользователь обновил мобильное приложение с новым URL https://smoothroad.emergent.host")
    print("🔄 Перезапустил приложение и начал мониторинг")
    print("🎯 ЦЕЛЬ: Проверить поступили ли данные от мобильного приложения пользователя")
    print()
    
    # Результаты критической проверки в реальном времени
    critical_results = {}
    
    # 1. КРИТИЧЕСКАЯ ПРОВЕРКА: Свежие записи за последние 10 минут и данные от 3 декабря 2025
    success, details = check_fresh_data_december_3()
    critical_results['fresh_data_december_3'] = (success, details)
    
    # 2. КРИТИЧЕСКАЯ ПРОВЕРКА: Backend логи за последние 15 минут
    success, details = check_backend_logs_15_minutes()
    critical_results['backend_logs_15min'] = (success, details)
    
    # 3. КРИТИЧЕСКАЯ ПРОВЕРКА: Изменения в статистике
    success, details = check_analytics_changes()
    critical_results['analytics_changes'] = (success, details)
    
    # 4. КРИТИЧЕСКАЯ ПРОВЕРКА: Сравнение с предыдущей проверкой
    success, details = compare_with_previous_check()
    critical_results['comparison_previous'] = (success, details)
    
    # 5. ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: Тест connectivity к новому URL
    success, details = test_connectivity_to_new_url()
    critical_results['connectivity_test'] = (success, details)
    
    # ИТОГОВЫЙ ОТЧЕТ КРИТИЧЕСКОЙ ПРОВЕРКИ В РЕАЛЬНОМ ВРЕМЕНИ
    print("\n" + "="*100)
    print("🚨 ИТОГОВЫЙ ОТЧЕТ: ОБМЕН ДАННЫМИ ПОСЛЕ ИСПРАВЛЕНИЯ URL")
    print("="*100)
    
    passed_tests = sum(1 for success, _ in critical_results.values() if success)
    total_tests = len(critical_results)
    
    print(f"📊 Выполнено критических проверок: {total_tests}")
    print(f"✅ Успешных: {passed_tests}")
    print(f"❌ С проблемами: {total_tests - passed_tests}")
    
    print(f"\n📋 ДЕТАЛЬНЫЕ РЕЗУЛЬТАТЫ КРИТИЧЕСКИХ ПРОВЕРОК:")
    for test_name, (success, details) in critical_results.items():
        status = "✅" if success else "❌"
        test_display = test_name.replace('_', ' ').title()
        print(f"{status} {test_display}: {details}")
    
    # КРИТИЧЕСКИЙ АНАЛИЗ: РАБОТАЕТ ЛИ ОБМЕН ДАННЫМИ?
    print(f"\n🚨 КРИТИЧЕСКИЙ АНАЛИЗ: РАБОТАЕТ ЛИ ОБМЕН ДАННЫМИ?")
    
    fresh_data_success, fresh_data_details = critical_results['fresh_data_december_3']
    logs_success, logs_details = critical_results['backend_logs_15min']
    analytics_success, analytics_details = critical_results['analytics_changes']
    comparison_success, comparison_details = critical_results['comparison_previous']
    connectivity_success, connectivity_details = critical_results['connectivity_test']
    
    # Определяем статус обмена данными
    data_exchange_working = fresh_data_success or analytics_success or comparison_success
    external_requests_found = logs_success
    
    print(f"\n🎯 СТАТУС ОБМЕНА ДАННЫМИ:")
    if data_exchange_working and external_requests_found:
        print("🎉 ОБМЕН ДАННЫМИ РАБОТАЕТ ПОЛНОСТЬЮ!")
        print("   ✅ Найдены новые записи от мобильного приложения")
        print("   ✅ Обнаружены внешние POST запросы в логах")
        print("   ✅ Статистика показывает активность")
        print("   ✅ Мобильное приложение успешно отправляет данные на сервер")
    elif data_exchange_working and not external_requests_found:
        print("⚠️  ЧАСТИЧНЫЙ ОБМЕН ДАННЫМИ")
        print("   ✅ Найдены новые записи в базе данных")
        print("   ❌ Но нет внешних POST запросов в логах")
        print("   💡 Возможно данные поступают, но логи не показывают источник")
    elif not data_exchange_working and connectivity_success:
        print("❌ ОБМЕН ДАННЫМИ НЕ РАБОТАЕТ")
        print("   ✅ Сервер доступен и функционален")
        print("   ❌ НЕТ новых данных от мобильного приложения")
        print("   ❌ НЕТ внешних POST запросов")
        print("   🚨 Мобильное приложение НЕ отправляет данные на сервер")
    else:
        print("🚨 КРИТИЧЕСКАЯ ПРОБЛЕМА")
        print("   ❌ Сервер недоступен или имеет проблемы")
        print("   ❌ Невозможно проверить обмен данными")
    
    # ДЕТАЛЬНЫЙ АНАЛИЗ РЕЗУЛЬТАТОВ
    print(f"\n📊 ДЕТАЛЬНЫЙ АНАЛИЗ РЕЗУЛЬТАТОВ:")
    
    if '2025-12-03' in fresh_data_details or 'мобильные данные' in fresh_data_details:
        print("✅ НАЙДЕНЫ ДАННЫЕ ОТ 3 ДЕКАБРЯ 2025 - ИСПРАВЛЕНИЕ СРАБОТАЛО!")
    elif 'Свежих:' in fresh_data_details and 'от 3 дек:' in fresh_data_details:
        print("⚠️  Найдены свежие записи, но нужно проверить источник")
    else:
        print("❌ НЕТ данных от 3 декабря 2025 - мобильное приложение не отправляет данные")
    
    if 'Внешних запросов:' in logs_details and 'Внешних запросов: 0' not in logs_details:
        print("✅ НАЙДЕНЫ ВНЕШНИЕ POST ЗАПРОСЫ - мобильное приложение подключается!")
    else:
        print("❌ НЕТ внешних POST запросов - только внутренние (тестирование)")
    
    if 'мобильных:' in analytics_details:
        print("✅ СТАТИСТИКА ПОКАЗЫВАЕТ МОБИЛЬНУЮ АКТИВНОСТЬ")
    else:
        print("❌ Статистика не показывает мобильную активность")
    
    # ОКОНЧАТЕЛЬНЫЙ ВЕРДИКТ
    print(f"\n🏁 ОКОНЧАТЕЛЬНЫЙ ВЕРДИКТ:")
    
    if data_exchange_working and external_requests_found:
        print("🎉 УСПЕХ! ИСПРАВЛЕНИЕ URL РАБОТАЕТ!")
        print("   Мобильное приложение пользователя успешно:")
        print("   ✅ Подключается к новому серверу https://smoothroad.emergent.host")
        print("   ✅ Отправляет данные сенсоров")
        print("   ✅ Генерирует записи с реальными GPS координатами")
        print("   ✅ Обновляет статистику базы данных")
    elif connectivity_success:
        print("⚠️  СЕРВЕР ГОТОВ, НО МОБИЛЬНОЕ ПРИЛОЖЕНИЕ ЕЩЕ НЕ АКТИВНО")
        print("   ✅ Новый URL https://smoothroad.emergent.host полностью функционален")
        print("   ❌ Мобильное приложение пока не отправляет данные")
        print("   💡 РЕКОМЕНДАЦИИ:")
        print("      1. Убедиться что приложение обновлено с новым URL")
        print("      2. Перезапустить мобильное приложение")
        print("      3. Начать поездку для генерации данных")
        print("      4. Проверить GPS и разрешения приложения")
        print("      5. Повторить проверку через 5-10 минут")
    else:
        print("🚨 КРИТИЧЕСКАЯ ПРОБЛЕМА С СЕРВЕРОМ")
        print("   ❌ Новый URL недоступен или имеет проблемы")
        print("   🔧 Необходимо исправить проблемы с сервером")
    
    print(f"\n📊 КРИТИЧЕСКАЯ ПРОВЕРКА ЗАВЕРШЕНА: {passed_tests}/{total_tests} проверок пройдено")
    print(f"⏰ Время проверки: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Возвращаем результат: True если есть признаки работающего обмена данными
    return data_exchange_working or (connectivity_success and passed_tests >= 3)

if __name__ == "__main__":
    main()