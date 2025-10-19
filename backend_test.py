#!/usr/bin/env python3
"""
URGENT DIAGNOSTIC: Good Road Mobile App Data Reception Test
Testing why mobile app data is not reaching the database (last data from Oct 7th)
"""

import requests
import json
import time
from datetime import datetime, timezone
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv('/app/frontend/.env')

# Get backend URL from frontend environment
BACKEND_URL = os.getenv('EXPO_PUBLIC_BACKEND_URL', 'https://smoothroad.preview.emergentagent.com')
API_BASE = f"{BACKEND_URL}/api"

print(f"🔍 URGENT DIAGNOSTIC: Testing Good Road Mobile Data Reception")
print(f"📡 Backend URL: {API_BASE}")
print(f"📅 Issue: No new data since October 7th despite mobile app usage today")
print("=" * 80)

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
    """Main diagnostic function"""
    print("🚨 STARTING URGENT DIAGNOSTIC FOR GOOD ROAD MOBILE APP")
    print("🎯 Goal: Find why mobile data stopped reaching database after Oct 7th")
    print()
    
    # Test results tracking
    results = {
        'sensor_upload': False,
        'data_storage': False,
        'cors_mobile': False,
        'recent_activity': False,
        'backend_logs': False,
        'full_cycle': False
    }
    
    # 1. Check current database activity
    results['recent_activity'] = check_analytics_for_recent_activity()
    
    # 2. Check backend logs for POST requests
    results['backend_logs'] = check_backend_logs()
    
    # 3. Test CORS for mobile compatibility
    results['cors_mobile'] = test_cors_mobile_compatibility()
    
    # 4. Test sensor data upload
    results['sensor_upload'], _ = test_sensor_data_upload()
    
    # 5. Verify data storage
    if results['sensor_upload']:
        results['data_storage'], _ = verify_data_storage()
    
    # 6. Test full cycle
    results['full_cycle'] = test_full_data_cycle()
    
    # Summary
    print("\n" + "=" * 80)
    print("🔍 URGENT DIAGNOSTIC SUMMARY")
    print("=" * 80)
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} {test_name.replace('_', ' ').title()}")
    
    # Critical analysis
    print("\n🚨 CRITICAL ANALYSIS:")
    
    if not results['recent_activity']:
        print("❌ CONFIRMED ISSUE: No database activity in last 7 days")
        print("   This confirms user's report about missing data since Oct 7th")
    
    if not results['backend_logs']:
        print("❌ CRITICAL FINDING: No POST /api/sensor-data requests in backend logs")
        print("   This indicates mobile app is NOT making API calls to backend")
    
    if results['sensor_upload'] and results['data_storage']:
        print("✅ API WORKING: Sensor data upload and storage functional")
        print("🔍 CONCLUSION: Backend APIs work, but mobile app may not be calling them")
    elif not results['sensor_upload']:
        print("❌ API BROKEN: Sensor data upload endpoint not working")
        print("🔍 CONCLUSION: Backend API failure preventing data reception")
    
    if not results['cors_mobile']:
        print("⚠️  CORS ISSUE: Mobile app origins may be blocked")
        print("🔍 POTENTIAL CAUSE: CORS configuration preventing mobile requests")
    
    # Recommendations
    print("\n💡 URGENT RECOMMENDATIONS:")
    
    if results['sensor_upload'] and results['data_storage'] and not results['backend_logs']:
        print("1. 🚨 MOBILE APP ISSUE: Backend APIs functional but mobile app not calling them")
        print("2. 🔍 Check mobile app network configuration and API endpoint URLs")
        print("3. 🔍 Verify mobile app authentication and request headers")
        print("4. 🔍 Check mobile app error logs for network failures")
        print("5. 🔍 Verify mobile app background processing is working")
    elif not results['sensor_upload']:
        print("1. 🚨 Fix backend API issues first")
        print("2. 🔍 Check backend server configuration")
        print("3. 🔍 Verify database connectivity")
    
    if not results['cors_mobile']:
        print("4. 🌐 Review CORS settings for mobile compatibility")
    
    total_passed = sum(results.values())
    total_tests = len(results)
    
    print(f"\n📊 DIAGNOSTIC COMPLETE: {total_passed}/{total_tests} tests passed")
    
    if results['sensor_upload'] and results['data_storage'] and not results['backend_logs']:
        print("🎯 ROOT CAUSE IDENTIFIED: Mobile app not sending data to backend")
        print("🚨 IMMEDIATE ACTION: Check mobile app configuration and network requests")
    elif not results['sensor_upload']:
        print("🚨 Backend API issues detected - requires immediate backend fixes")
    else:
        print("🔍 Mixed results - requires detailed investigation")

if __name__ == "__main__":
    main()