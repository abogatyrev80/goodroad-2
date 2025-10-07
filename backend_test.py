#!/usr/bin/env python3
"""
Backend API Testing Suite for Good Road Application
Testing the zero coordinates cleanup endpoint as requested
"""

import requests
import json
import sys
from datetime import datetime
import os

# Get backend URL from environment
BACKEND_URL = "https://smoothroad.preview.emergentagent.com/api"

def print_test_header(test_name):
    print(f"\n{'='*60}")
    print(f"🧪 {test_name}")
    print(f"{'='*60}")

def print_result(success, message):
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status}: {message}")

def test_zero_coordinates_cleanup():
    """
    Test the zero coordinates cleanup endpoint as requested:
    1. Show current state with zero coordinates
    2. Execute cleanup
    3. Verify zero coordinates are removed
    4. Check updated analytics
    """
    
    print_test_header("ZERO COORDINATES CLEANUP TEST")
    
    try:
        # Step 1: Show current state - GET /api/admin/sensor-data?limit=10
        print("\n📊 STEP 1: Checking current state - looking for records with (0.0, 0.0) coordinates")
        
        response = requests.get(f"{BACKEND_URL}/admin/sensor-data?limit=10")
        if response.status_code != 200:
            print_result(False, f"Failed to get sensor data: {response.status_code}")
            return False
            
        data = response.json()
        total_records_before = data.get('total', 0)
        records = data.get('data', [])
        
        print(f"📈 Total records in database: {total_records_before}")
        print(f"📋 Retrieved {len(records)} records for analysis")
        
        # Count records with zero coordinates
        zero_coord_count = 0
        valid_coord_count = 0
        
        print("\n🔍 Analyzing GPS coordinates:")
        for i, record in enumerate(records):
            lat = record.get('latitude', 0)
            lng = record.get('longitude', 0)
            
            if lat == 0.0 and lng == 0.0:
                zero_coord_count += 1
                print(f"  Record {i+1}: (0.0, 0.0) ❌ ZERO COORDINATES")
            else:
                valid_coord_count += 1
                print(f"  Record {i+1}: ({lat}, {lng}) ✅ VALID COORDINATES")
        
        print(f"\n📊 Summary before cleanup:")
        print(f"  • Records with zero coordinates: {zero_coord_count}")
        print(f"  • Records with valid coordinates: {valid_coord_count}")
        
        # Step 2: Execute cleanup - DELETE /api/admin/cleanup-zero-coords
        print("\n🧹 STEP 2: Executing zero coordinates cleanup")
        
        cleanup_response = requests.delete(f"{BACKEND_URL}/admin/cleanup-zero-coords")
        if cleanup_response.status_code != 200:
            print_result(False, f"Cleanup failed: {cleanup_response.status_code} - {cleanup_response.text}")
            return False
            
        cleanup_result = cleanup_response.json()
        deleted_count = cleanup_result.get('deleted_records', 0)
        remaining_count = cleanup_result.get('remaining_records', 0)
        
        print(f"🗑️  Cleanup completed:")
        print(f"  • Records deleted: {deleted_count}")
        print(f"  • Records remaining: {remaining_count}")
        print(f"  • Cleanup message: {cleanup_result.get('message', 'N/A')}")
        
        # Step 3: Verify results - GET /api/admin/sensor-data?limit=10 again
        print("\n🔍 STEP 3: Verifying cleanup results")
        
        verify_response = requests.get(f"{BACKEND_URL}/admin/sensor-data?limit=10")
        if verify_response.status_code != 200:
            print_result(False, f"Failed to verify results: {verify_response.status_code}")
            return False
            
        verify_data = verify_response.json()
        total_records_after = verify_data.get('total', 0)
        verify_records = verify_data.get('data', [])
        
        print(f"📈 Total records after cleanup: {total_records_after}")
        print(f"📋 Retrieved {len(verify_records)} records for verification")
        
        # Check if any zero coordinates remain
        remaining_zero_coords = 0
        remaining_valid_coords = 0
        
        print("\n🔍 Analyzing GPS coordinates after cleanup:")
        for i, record in enumerate(verify_records):
            lat = record.get('latitude', 0)
            lng = record.get('longitude', 0)
            
            if lat == 0.0 and lng == 0.0:
                remaining_zero_coords += 1
                print(f"  Record {i+1}: (0.0, 0.0) ❌ STILL HAS ZERO COORDINATES")
            else:
                remaining_valid_coords += 1
                location_name = ""
                # Identify known locations
                if 55.7 <= lat <= 55.8 and 37.6 <= lng <= 37.7:
                    location_name = " (Moscow area)"
                elif 40.7 <= lat <= 40.8 and -74.1 <= lng <= -74.0:
                    location_name = " (New York area)"
                    
                print(f"  Record {i+1}: ({lat}, {lng}){location_name} ✅ VALID COORDINATES")
        
        print(f"\n📊 Summary after cleanup:")
        print(f"  • Records with zero coordinates: {remaining_zero_coords}")
        print(f"  • Records with valid coordinates: {remaining_valid_coords}")
        print(f"  • Total records reduced by: {total_records_before - total_records_after}")
        
        # Step 4: Check updated analytics - GET /api/admin/analytics
        print("\n📈 STEP 4: Checking updated analytics")
        
        analytics_response = requests.get(f"{BACKEND_URL}/admin/analytics")
        if analytics_response.status_code != 200:
            print_result(False, f"Failed to get analytics: {analytics_response.status_code}")
            return False
            
        analytics = analytics_response.json()
        
        print(f"📊 Updated Analytics:")
        print(f"  • Total points: {analytics.get('total_points', 0)}")
        print(f"  • Verified points: {analytics.get('verified_points', 0)}")
        print(f"  • Hazard points: {analytics.get('hazard_points', 0)}")
        print(f"  • Average road quality: {analytics.get('avg_road_quality', 0)}")
        print(f"  • Recent points (7d): {analytics.get('recent_points_7d', 0)}")
        
        # Verify success criteria
        success = True
        success_messages = []
        failure_messages = []
        
        if deleted_count > 0:
            success_messages.append(f"Successfully deleted {deleted_count} records with zero coordinates")
        else:
            if zero_coord_count > 0:
                failure_messages.append("No records were deleted despite having zero coordinates in the data")
            else:
                success_messages.append("No zero coordinate records found to delete (database already clean)")
        
        if remaining_zero_coords == 0:
            success_messages.append("No zero coordinates remain in the database")
        else:
            failure_messages.append(f"{remaining_zero_coords} records with zero coordinates still remain")
            success = False
        
        if total_records_after <= total_records_before:
            success_messages.append(f"Total record count properly reduced from {total_records_before} to {total_records_after}")
        else:
            failure_messages.append("Total record count unexpectedly increased")
            success = False
        
        if remaining_valid_coords > 0:
            success_messages.append(f"Valid GPS coordinates preserved ({remaining_valid_coords} records with real locations)")
        
        # Print results
        print(f"\n🎯 TEST RESULTS:")
        for msg in success_messages:
            print(f"  ✅ {msg}")
        for msg in failure_messages:
            print(f"  ❌ {msg}")
        
        if success:
            print_result(True, "Zero coordinates cleanup test completed successfully")
        else:
            print_result(False, "Zero coordinates cleanup test failed")
            
        return success
        
    except requests.exceptions.RequestException as e:
        print_result(False, f"Network error during zero coordinates cleanup test: {str(e)}")
        return False
    except Exception as e:
        print_result(False, f"Unexpected error during zero coordinates cleanup test: {str(e)}")
        return False

def main():
    """Run the zero coordinates cleanup test"""
    print("🚗 Good Road Backend API - Zero Coordinates Cleanup Test")
    print(f"🌐 Backend URL: {BACKEND_URL}")
    print(f"⏰ Test started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Run the specific test requested
    success = test_zero_coordinates_cleanup()
    
    print(f"\n{'='*60}")
    if success:
        print("🎉 ZERO COORDINATES CLEANUP TEST COMPLETED SUCCESSFULLY")
        print("✅ All records with (0.0, 0.0) coordinates have been removed")
        print("✅ Only records with valid GPS coordinates remain")
        print("✅ Database cleanup operation successful")
    else:
        print("❌ ZERO COORDINATES CLEANUP TEST FAILED")
        print("⚠️  Some issues were found with the cleanup operation")
    print(f"{'='*60}")
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())