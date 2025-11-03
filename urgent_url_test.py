#!/usr/bin/env python3
"""
🚨 URGENT URL CONNECTIVITY TEST
Testing both production URLs to determine correct mobile app endpoint:
- https://roadquality.preview.emergentagent.com (from env variables)
- https://smoothroad.emergent.host (updated URL)
"""

import requests
import json
import time
from datetime import datetime
import sys

# Test URLs
URL_PREVIEW = "https://roadquality.preview.emergentagent.com"
URL_EMERGENT = "https://smoothroad.emergent.host"

def test_url_connectivity(base_url, url_name):
    """Test basic connectivity and API endpoints for a given URL"""
    print(f"\n{'='*60}")
    print(f"TESTING {url_name}: {base_url}")
    print(f"{'='*60}")
    
    results = {
        "url": base_url,
        "name": url_name,
        "connectivity": False,
        "sensor_data_post": False,
        "admin_sensor_get": False,
        "has_user_data": False,
        "response_times": {},
        "errors": [],
        "user_data_count": 0,
        "latest_record_date": None
    }
    
    # Test 1: Basic connectivity
    try:
        print(f"1. Testing basic connectivity...")
        start_time = time.time()
        response = requests.get(f"{base_url}/api/", timeout=10)
        response_time = time.time() - start_time
        
        if response.status_code == 200:
            print(f"   ✅ CONNECTED (Status: {response.status_code}, Time: {response_time:.2f}s)")
            results["connectivity"] = True
            results["response_times"]["basic"] = response_time
            print(f"   Response: {response.json()}")
        else:
            print(f"   ❌ FAILED (Status: {response.status_code})")
            results["errors"].append(f"Basic connectivity failed: {response.status_code}")
            
    except Exception as e:
        print(f"   ❌ CONNECTION ERROR: {str(e)}")
        results["errors"].append(f"Connection error: {str(e)}")
        return results
    
    # Test 2: POST /api/sensor-data
    try:
        print(f"2. Testing POST /api/sensor-data...")
        
        test_data = {
            "deviceId": "urgent-connectivity-test-device",
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
        
        start_time = time.time()
        response = requests.post(
            f"{base_url}/api/sensor-data",
            json=test_data,
            headers={"Content-Type": "application/json"},
            timeout=15
        )
        response_time = time.time() - start_time
        
        if response.status_code == 200:
            print(f"   ✅ POST SUCCESS (Status: {response.status_code}, Time: {response_time:.2f}s)")
            results["sensor_data_post"] = True
            results["response_times"]["post"] = response_time
            resp_data = response.json()
            print(f"   Response: {resp_data}")
        else:
            print(f"   ❌ POST FAILED (Status: {response.status_code})")
            print(f"   Response: {response.text}")
            results["errors"].append(f"POST sensor-data failed: {response.status_code}")
            
    except Exception as e:
        print(f"   ❌ POST ERROR: {str(e)}")
        results["errors"].append(f"POST error: {str(e)}")
    
    # Test 3: GET /api/admin/sensor-data
    try:
        print(f"3. Testing GET /api/admin/sensor-data...")
        
        start_time = time.time()
        response = requests.get(
            f"{base_url}/api/admin/sensor-data?limit=5",
            timeout=10
        )
        response_time = time.time() - start_time
        
        if response.status_code == 200:
            print(f"   ✅ GET SUCCESS (Status: {response.status_code}, Time: {response_time:.2f}s)")
            results["admin_sensor_get"] = True
            results["response_times"]["get"] = response_time
            
            data = response.json()
            total_records = data.get("total", 0)
            returned_records = len(data.get("data", []))
            
            print(f"   Total records in database: {total_records}")
            print(f"   Records returned: {returned_records}")
            
            # Check for user data
            if total_records > 0:
                results["has_user_data"] = True
                results["user_data_count"] = total_records
                print(f"   ✅ HAS USER DATA: {total_records} records found")
                
                # Show sample of recent data
                if returned_records > 0:
                    sample_record = data["data"][0]
                    timestamp = sample_record.get("timestamp", "N/A")
                    lat = sample_record.get("latitude", 0)
                    lng = sample_record.get("longitude", 0)
                    results["latest_record_date"] = timestamp
                    print(f"   Latest record: {timestamp} at ({lat}, {lng})")
            else:
                print(f"   ⚠️  NO USER DATA: Database is empty")
                
        else:
            print(f"   ❌ GET FAILED (Status: {response.status_code})")
            print(f"   Response: {response.text}")
            results["errors"].append(f"GET admin/sensor-data failed: {response.status_code}")
            
    except Exception as e:
        print(f"   ❌ GET ERROR: {str(e)}")
        results["errors"].append(f"GET error: {str(e)}")
    
    # Test 4: Check for recent activity
    try:
        print(f"4. Testing GET /api/admin/analytics for activity...")
        
        response = requests.get(f"{base_url}/api/admin/analytics", timeout=10)
        
        if response.status_code == 200:
            analytics = response.json()
            total_points = analytics.get("total_points", 0)
            recent_points = analytics.get("recent_points_7d", 0)
            
            print(f"   Total data points: {total_points}")
            print(f"   Recent activity (7 days): {recent_points}")
            
            if recent_points > 0:
                print(f"   ✅ ACTIVE SERVER: Recent activity detected")
            else:
                print(f"   ⚠️  INACTIVE: No recent activity")
                
        else:
            print(f"   ❌ Analytics check failed: {response.status_code}")
            
    except Exception as e:
        print(f"   ❌ Analytics error: {str(e)}")
    
    return results

def main():
    """Main test execution"""
    print("🚨 URGENT PRODUCTION URL CONNECTIVITY TEST")
    print("=" * 80)
    print("Testing both URLs to determine correct mobile app endpoint")
    print(f"Test time: {datetime.now().isoformat()}")
    
    # Test both URLs
    preview_results = test_url_connectivity(URL_PREVIEW, "PREVIEW (from env)")
    emergent_results = test_url_connectivity(URL_EMERGENT, "EMERGENT (updated)")
    
    # Summary comparison
    print(f"\n{'='*80}")
    print("CRITICAL COMPARISON SUMMARY")
    print(f"{'='*80}")
    
    def print_comparison(label, preview_val, emergent_val):
        preview_status = "✅" if preview_val else "❌"
        emergent_status = "✅" if emergent_val else "❌"
        print(f"{label:25} | {preview_status} Preview | {emergent_status} Emergent")
    
    print_comparison("Basic Connectivity", preview_results["connectivity"], emergent_results["connectivity"])
    print_comparison("POST sensor-data", preview_results["sensor_data_post"], emergent_results["sensor_data_post"])
    print_comparison("GET admin data", preview_results["admin_sensor_get"], emergent_results["admin_sensor_get"])
    print_comparison("Has User Data", preview_results["has_user_data"], emergent_results["has_user_data"])
    
    # Data comparison
    print(f"\nDATA COMPARISON:")
    print(f"Preview URL - Records: {preview_results['user_data_count']}, Latest: {preview_results['latest_record_date']}")
    print(f"Emergent URL - Records: {emergent_results['user_data_count']}, Latest: {emergent_results['latest_record_date']}")
    
    # Determine recommendation
    print(f"\n{'='*80}")
    print("RECOMMENDATION")
    print(f"{'='*80}")
    
    preview_score = sum([
        preview_results["connectivity"],
        preview_results["sensor_data_post"], 
        preview_results["admin_sensor_get"],
        preview_results["has_user_data"]
    ])
    
    emergent_score = sum([
        emergent_results["connectivity"],
        emergent_results["sensor_data_post"],
        emergent_results["admin_sensor_get"], 
        emergent_results["has_user_data"]
    ])
    
    print(f"Preview URL Score: {preview_score}/4")
    print(f"Emergent URL Score: {emergent_score}/4")
    
    # Determine which server has more/better data
    preview_data_count = preview_results["user_data_count"]
    emergent_data_count = emergent_results["user_data_count"]
    
    if preview_score > emergent_score:
        print(f"🎯 RECOMMENDATION: Use PREVIEW URL - {URL_PREVIEW}")
        print("   Preview server has better connectivity and/or functionality")
    elif emergent_score > preview_score:
        print(f"🎯 RECOMMENDATION: Use EMERGENT URL - {URL_EMERGENT}")
        print("   Emergent server has better connectivity and/or functionality")
    else:
        print("⚠️  BOTH SERVERS EQUAL FUNCTIONALITY - Checking data content...")
        
        # Check which has more user data
        if preview_data_count > emergent_data_count:
            print(f"🎯 RECOMMENDATION: Use PREVIEW URL - {URL_PREVIEW}")
            print(f"   Preview has more user data ({preview_data_count} vs {emergent_data_count} records)")
        elif emergent_data_count > preview_data_count:
            print(f"🎯 RECOMMENDATION: Use EMERGENT URL - {URL_EMERGENT}")
            print(f"   Emergent has more user data ({emergent_data_count} vs {preview_data_count} records)")
        elif preview_results["has_user_data"] and emergent_results["has_user_data"]:
            print("⚠️  BOTH HAVE EQUAL DATA - Need to check data recency")
            # Compare latest record dates
            if preview_results["latest_record_date"] and emergent_results["latest_record_date"]:
                print(f"   Preview latest: {preview_results['latest_record_date']}")
                print(f"   Emergent latest: {emergent_results['latest_record_date']}")
        elif preview_results["has_user_data"]:
            print(f"🎯 RECOMMENDATION: Use PREVIEW URL - {URL_PREVIEW}")
            print("   Preview has user data, Emergent is empty")
        elif emergent_results["has_user_data"]:
            print(f"🎯 RECOMMENDATION: Use EMERGENT URL - {URL_EMERGENT}")
            print("   Emergent has user data, Preview is empty")
        else:
            print("⚠️  BOTH SERVERS EMPTY - Either URL can be used")
    
    # Error summary
    if preview_results["errors"] or emergent_results["errors"]:
        print(f"\n{'='*80}")
        print("ERRORS ENCOUNTERED")
        print(f"{'='*80}")
        
        if preview_results["errors"]:
            print(f"Preview URL errors:")
            for error in preview_results["errors"]:
                print(f"  - {error}")
                
        if emergent_results["errors"]:
            print(f"Emergent URL errors:")
            for error in emergent_results["errors"]:
                print(f"  - {error}")
    
    # Final verdict for mobile app configuration
    print(f"\n{'='*80}")
    print("MOBILE APP CONFIGURATION VERDICT")
    print(f"{'='*80}")
    
    if preview_score == 4 and emergent_score == 4:
        if preview_data_count >= emergent_data_count:
            print(f"📱 MOBILE APP SHOULD USE: {URL_PREVIEW}")
            print("   Both servers functional, Preview has equal or more data")
        else:
            print(f"📱 MOBILE APP SHOULD USE: {URL_EMERGENT}")
            print("   Both servers functional, Emergent has more data")
    elif preview_score > emergent_score:
        print(f"📱 MOBILE APP SHOULD USE: {URL_PREVIEW}")
        print("   Preview server is more functional")
    elif emergent_score > preview_score:
        print(f"📱 MOBILE APP SHOULD USE: {URL_EMERGENT}")
        print("   Emergent server is more functional")
    else:
        print("🚨 CRITICAL: Both servers have issues - investigate further")
    
    print(f"\n{'='*80}")
    print("TEST COMPLETE")
    print(f"{'='*80}")

if __name__ == "__main__":
    main()