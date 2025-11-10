#!/usr/bin/env python3
"""
Backend Testing Suite for EventDetector (Phase 2) and BatchOfflineManager (Phase 3)
Tests the new event-driven data collection functionality
"""

import requests
import json
import time
from datetime import datetime
import sys

# Backend URL from frontend/.env
BACKEND_URL = "https://roadqual-track.preview.emergentagent.com/api"

class EventDetectorTester:
    def __init__(self):
        self.session = requests.Session()
        self.test_results = []
        
    def log_test(self, test_name, success, details=""):
        """Log test results"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details
        })
        
    def test_api_connectivity(self):
        """Test basic API connectivity"""
        try:
            response = self.session.get(f"{BACKEND_URL}/")
            if response.status_code == 200:
                data = response.json()
                self.log_test("API Connectivity", True, f"Message: {data.get('message', 'N/A')}")
                return True
            else:
                self.log_test("API Connectivity", False, f"Status: {response.status_code}")
                return False
        except Exception as e:
            self.log_test("API Connectivity", False, f"Error: {str(e)}")
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

def analyze_deployed_app_status():
    """Final analysis of deployed application status"""
    print_section("5. АНАЛИЗ СОСТОЯНИЯ DEPLOYED ПРИЛОЖЕНИЯ")
    
    try:
        # Get comprehensive data
        analytics_response = requests.get(f"{API_BASE}/admin/analytics", timeout=15)
        sensor_response = requests.get(f"{API_BASE}/admin/sensor-data?limit=20", timeout=15)
        
        if analytics_response.status_code != 200 or sensor_response.status_code != 200:
            print_result("Final Analysis APIs", False, "Cannot get required data")
            return False
        
        analytics = analytics_response.json()
        sensor_data = sensor_response.json()
        records = sensor_data.get('data', [])
        
        print_result("Final Analysis APIs", True, "Successfully retrieved all data")
        
        # Analyze activity patterns
        now = datetime.now()
        activity_periods = {
            'last_hour': 0,
            'last_24h': 0,
            'last_7d': analytics.get('recent_points_7d', 0),
            'total': analytics.get('total_points', 0)
        }
        
        latest_record_time = None
        
        for record in records:
            try:
                record_time = datetime.fromisoformat(record['timestamp'].replace('Z', '+00:00'))
                
                if latest_record_time is None or record_time > latest_record_time:
                    latest_record_time = record_time
                
                hours_ago = (now - record_time).total_seconds() / 3600
                
                if hours_ago <= 1:
                    activity_periods['last_hour'] += 1
                if hours_ago <= 24:
                    activity_periods['last_24h'] += 1
                    
            except Exception:
                continue
        
        print(f"\n📊 АНАЛИЗ АКТИВНОСТИ DEPLOYED ПРИЛОЖЕНИЯ:")
        print(f"   Всего точек в базе: {activity_periods['total']}")
        print(f"   За последний час: {activity_periods['last_hour']}")
        print(f"   За последние 24 часа: {activity_periods['last_24h']}")
        print(f"   За последние 7 дней: {activity_periods['last_7d']}")
        
        if latest_record_time:
            age = now - latest_record_time
            print(f"   Последняя запись: {latest_record_time.strftime('%Y-%m-%d %H:%M:%S')} ({age.days} дней назад)")
        
        # Determine status
        if activity_periods['last_hour'] > 0:
            status = "🟢 АКТИВНО"
            description = "Deployed приложение отправляет данные прямо сейчас"
        elif activity_periods['last_24h'] > 0:
            status = "🟡 НЕДАВНО АКТИВНО"
            description = "Приложение отправляло данные в последние 24 часа"
        elif activity_periods['last_7d'] > 0:
            status = "🟠 НЕАКТИВНО"
            description = "Приложение отправляло данные на этой неделе, но не недавно"
        else:
            status = "🔴 СПЯЩИЙ РЕЖИМ"
            description = "Нет активности в последние 7 дней"
        
        print(f"\n🎯 СТАТУС DEPLOYED ПРИЛОЖЕНИЯ: {status}")
        print(f"   {description}")
        
        # Check for issues
        print(f"\n🔍 ВОЗМОЖНЫЕ ПРОБЛЕМЫ:")
        
        if activity_periods['last_hour'] == 0:
            print("   ❌ Нет данных в последний час")
            print("     - Мобильное приложение может не работать")
            print("     - React hooks stale closure bug (упомянут в задаче)")
            print("     - Проблемы с фоновыми задачами")
        
        if activity_periods['total'] > 0 and activity_periods['last_24h'] == 0:
            print("   ⚠️  Есть исторические данные, но нет свежих")
            print("     - Deployed версия использует СТАРЫЙ код")
            print("     - Нужен новый deployment после исправлений")
        
        # Recommendations
        print(f"\n💡 РЕКОМЕНДАЦИИ:")
        if activity_periods['last_hour'] == 0:
            print("   1. Проверить работу мобильного приложения")
            print("   2. Сделать новый deployment с исправлениями")
            print("   3. Исправить React hooks stale closure bug")
            print("   4. Проверить EventDetector и BatchOfflineManager")
        else:
            print("   ✅ Deployed приложение работает корректно")
        
        return activity_periods['last_hour'] > 0
        
    except Exception as e:
        print_result("Deployed App Analysis", False, f"Error: {str(e)}")
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
    """Main test execution for deployed backend monitoring"""
    print(f"Начало тестирования: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    results = []
    
    # Step 1: Test connectivity
    results.append(("API Connectivity", test_api_connectivity()))
    
    if not results[0][1]:
        print("\n❌ КРИТИЧЕСКАЯ ОШИБКА: Не удается подключиться к deployed backend")
        print("Тестирование прервано.")
        return results
    
    # Step 2: Check current state
    results.append(("Current Deployed State", check_current_deployed_state() is not None))
    
    # Step 3: Monitor for 30 seconds
    results.append(("30-Second Monitoring", monitor_deployed_backend_30_seconds()))
    
    # Step 4: Check latest data
    results.append(("Latest Sensor Data", check_latest_sensor_data()))
    
    # Step 5: Final analysis
    results.append(("Deployed App Analysis", analyze_deployed_app_status()))
    
    # Summary
    print_section("ИТОГОВЫЙ ОТЧЕТ DEPLOYED ВЕРСИИ")
    
    passed = sum(1 for _, success in results if success)
    total = len(results)
    
    print(f"Тестов пройдено: {passed}/{total}")
    print(f"Успешность: {(passed/total)*100:.1f}%")
    
    print(f"\n📋 ДЕТАЛЬНЫЕ РЕЗУЛЬТАТЫ:")
    for test_name, success in results:
        status = "✅" if success else "❌"
        print(f"   {status} {test_name}")
    
    # Critical findings for deployed version
    print(f"\n🎯 КРИТИЧЕСКИЕ ВЫВОДЫ ДЛЯ DEPLOYED ВЕРСИИ:")
    
    if results[0][1]:  # Connectivity works
        print("   ✅ Deployed backend доступен и отвечает")
    
    if results[2][1]:  # New data detected during monitoring
        print("   🎉 DEPLOYED ПРИЛОЖЕНИЕ АКТИВНО отправляет данные!")
        print("   ✅ Мобильное приложение работает корректно")
    else:
        print("   ❌ НЕТ новых данных за 30 секунд мониторинга")
        print("   ❌ Deployed приложение НЕ отправляет данные на сервер")
    
    if not results[3][1]:  # No fresh data
        print("   ⚠️  Нет свежих записей с сегодняшней датой")
    
    # Specific recommendations for deployed version
    print(f"\n🔧 РЕКОМЕНДАЦИИ ДЛЯ DEPLOYED ВЕРСИИ:")
    
    if not results[2][1]:  # No new data during monitoring
        print("   1. 🚀 СДЕЛАТЬ НОВЫЙ DEPLOYMENT с исправлениями:")
        print("      - Исправить React hooks stale closure bug")
        print("      - Добавить EventDetector и BatchOfflineManager")
        print("      - Обновить код до последней версии")
        print("   2. 📱 Проверить мобильное приложение:")
        print("      - Убедиться что приложение запущено")
        print("      - Проверить фоновые задачи")
        print("      - Начать поездку для генерации данных")
        print("   3. 🔧 Диагностика проблем:")
        print("      - Проверить логи мобильного приложения")
        print("      - Убедиться в правильности URL сервера")
        print("      - Проверить сетевое подключение")
    else:
        print("   ✅ Deployed версия работает корректно!")
        print("   ✅ Новый deployment не требуется")
    
    print(f"\n⏰ Завершение тестирования: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    return results

if __name__ == "__main__":
    main()