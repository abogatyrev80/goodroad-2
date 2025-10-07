#!/usr/bin/env python3
"""
Backend Testing Suite for Good Road API - GPS Coordinates Fix Verification
Focus: Testing fixed admin endpoint /api/admin/sensor-data for proper GPS coordinate extraction
ЦЕЛЬ: Убедиться что исправление /api/admin/sensor-data теперь правильно извлекает GPS координаты из rawData
"""

import requests
import json
import uuid
from datetime import datetime, timedelta
import time

# Backend URL from frontend/.env
BACKEND_URL = "https://smoothroad.preview.emergentagent.com/api"

class GPSCoordinatesInvestigation:
    def __init__(self):
        self.backend_url = BACKEND_URL
        self.test_results = []
        
    def log_result(self, test_name, success, details, data=None):
        """Log test results for analysis"""
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat(),
            "data": data
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        print(f"   Details: {details}")
        if data and isinstance(data, dict):
            if 'latitude' in str(data) or 'longitude' in str(data):
                print(f"   GPS Data: {json.dumps(data, indent=2)}")
        print()
        
    def test_1_get_raw_sensor_data(self):
        """Test 1: GET /api/admin/sensor-data - получить raw данные"""
        try:
            response = requests.get(f"{self.backend_url}/admin/sensor-data")
            
            if response.status_code == 200:
                data = response.json()
                sensor_data = data.get('data', [])
                total_records = data.get('total', 0)
                
                # Analyze GPS coordinates
                zero_coords_count = 0
                non_zero_coords_count = 0
                coordinate_analysis = []
                
                for record in sensor_data:
                    lat = record.get('latitude', 0)
                    lng = record.get('longitude', 0)
                    
                    coord_info = {
                        'id': record.get('_id'),
                        'latitude': lat,
                        'longitude': lng,
                        'timestamp': record.get('timestamp'),
                        'speed': record.get('speed'),
                        'accuracy': record.get('accuracy')
                    }
                    coordinate_analysis.append(coord_info)
                    
                    if lat == 0.0 and lng == 0.0:
                        zero_coords_count += 1
                    else:
                        non_zero_coords_count += 1
                
                details = f"Retrieved {len(sensor_data)} records from {total_records} total. Zero coords: {zero_coords_count}, Non-zero coords: {non_zero_coords_count}"
                
                self.log_result(
                    "GET /api/admin/sensor-data - Raw Data Analysis",
                    True,
                    details,
                    {
                        'total_records': total_records,
                        'returned_records': len(sensor_data),
                        'zero_coordinates': zero_coords_count,
                        'non_zero_coordinates': non_zero_coords_count,
                        'sample_coordinates': coordinate_analysis[:5]  # First 5 records
                    }
                )
                
                return coordinate_analysis
                
            else:
                self.log_result(
                    "GET /api/admin/sensor-data - Raw Data Analysis",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return []
                
        except Exception as e:
            self.log_result(
                "GET /api/admin/sensor-data - Raw Data Analysis",
                False,
                f"Exception: {str(e)}"
            )
            return []
    
    def test_2_get_latest_10_records(self):
        """Test 2: GET /api/admin/sensor-data?limit=10 - последние 10 записей"""
        try:
            response = requests.get(f"{self.backend_url}/admin/sensor-data?limit=10")
            
            if response.status_code == 200:
                data = response.json()
                sensor_data = data.get('data', [])
                
                # Detailed analysis of latest 10 records
                detailed_analysis = []
                for record in sensor_data:
                    analysis = {
                        'id': record.get('_id'),
                        'timestamp': record.get('timestamp'),
                        'gps_coordinates': {
                            'latitude': record.get('latitude'),
                            'longitude': record.get('longitude')
                        },
                        'gps_metadata': {
                            'speed': record.get('speed'),
                            'accuracy': record.get('accuracy')
                        },
                        'sensor_data': {
                            'accelerometer': record.get('accelerometer'),
                            'road_quality_score': record.get('road_quality_score')
                        },
                        'admin_data': {
                            'hazard_type': record.get('hazard_type'),
                            'severity': record.get('severity'),
                            'is_verified': record.get('is_verified'),
                            'admin_notes': record.get('admin_notes')
                        }
                    }
                    detailed_analysis.append(analysis)
                
                # Check if all coordinates are zero
                all_zero = all(
                    r['gps_coordinates']['latitude'] == 0.0 and 
                    r['gps_coordinates']['longitude'] == 0.0 
                    for r in detailed_analysis
                )
                
                details = f"Retrieved latest {len(sensor_data)} records. All coordinates zero: {all_zero}"
                
                self.log_result(
                    "GET /api/admin/sensor-data?limit=10 - Latest Records Analysis",
                    True,
                    details,
                    {
                        'records_count': len(sensor_data),
                        'all_coordinates_zero': all_zero,
                        'detailed_records': detailed_analysis
                    }
                )
                
                return detailed_analysis
                
            else:
                self.log_result(
                    "GET /api/admin/sensor-data?limit=10 - Latest Records Analysis",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return []
                
        except Exception as e:
            self.log_result(
                "GET /api/admin/sensor-data?limit=10 - Latest Records Analysis",
                False,
                f"Exception: {str(e)}"
            )
            return []
    
    def test_3_post_correct_gps_data(self):
        """Test 3: POST /api/sensor-data - тест отправки корректных GPS данных"""
        try:
            # Create realistic test data with actual GPS coordinates
            test_device_id = f"test_device_{uuid.uuid4().hex[:8]}"
            current_timestamp = int(time.time() * 1000)
            
            # Moscow coordinates as example
            test_coordinates = {
                "latitude": 55.7558,
                "longitude": 37.6176
            }
            
            test_batch = {
                "deviceId": test_device_id,
                "sensorData": [
                    # Location data points
                    {
                        "type": "location",
                        "timestamp": current_timestamp,
                        "data": {
                            "latitude": test_coordinates["latitude"],
                            "longitude": test_coordinates["longitude"],
                            "speed": 25.5,
                            "accuracy": 5.0,
                            "altitude": 150.0,
                            "heading": 45.0
                        }
                    },
                    {
                        "type": "location", 
                        "timestamp": current_timestamp + 5000,
                        "data": {
                            "latitude": test_coordinates["latitude"] + 0.001,
                            "longitude": test_coordinates["longitude"] + 0.001,
                            "speed": 30.2,
                            "accuracy": 4.5,
                            "altitude": 152.0,
                            "heading": 47.0
                        }
                    },
                    # Accelerometer data points
                    {
                        "type": "accelerometer",
                        "timestamp": current_timestamp + 1000,
                        "data": {
                            "x": 0.1,
                            "y": 0.2,
                            "z": 9.8,
                            "totalAcceleration": 9.82
                        }
                    },
                    {
                        "type": "accelerometer",
                        "timestamp": current_timestamp + 2000,
                        "data": {
                            "x": 0.15,
                            "y": 0.25,
                            "z": 9.85,
                            "totalAcceleration": 9.87
                        }
                    },
                    {
                        "type": "accelerometer",
                        "timestamp": current_timestamp + 3000,
                        "data": {
                            "x": 0.2,
                            "y": 0.3,
                            "z": 9.9,
                            "totalAcceleration": 9.92
                        }
                    },
                    {
                        "type": "accelerometer",
                        "timestamp": current_timestamp + 4000,
                        "data": {
                            "x": 0.12,
                            "y": 0.18,
                            "z": 9.75,
                            "totalAcceleration": 9.78
                        }
                    },
                    {
                        "type": "accelerometer",
                        "timestamp": current_timestamp + 6000,
                        "data": {
                            "x": 0.08,
                            "y": 0.14,
                            "z": 9.82,
                            "totalAcceleration": 9.84
                        }
                    }
                ]
            }
            
            response = requests.post(
                f"{self.backend_url}/sensor-data",
                json=test_batch,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                result_data = response.json()
                
                details = f"Successfully posted sensor data. Raw points: {result_data.get('rawDataPoints')}, Conditions: {result_data.get('conditionsProcessed')}, Warnings: {result_data.get('warningsGenerated')}"
                
                self.log_result(
                    "POST /api/sensor-data - Correct GPS Data Test",
                    True,
                    details,
                    {
                        'test_device_id': test_device_id,
                        'sent_coordinates': test_coordinates,
                        'response': result_data,
                        'raw_data_points': result_data.get('rawDataPoints'),
                        'conditions_processed': result_data.get('conditionsProcessed'),
                        'warnings_generated': result_data.get('warningsGenerated')
                    }
                )
                
                # Wait a moment for data to be processed
                time.sleep(2)
                
                # Now check if the data was stored correctly
                return self.verify_stored_gps_data(test_device_id, test_coordinates)
                
            else:
                self.log_result(
                    "POST /api/sensor-data - Correct GPS Data Test",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return False
                
        except Exception as e:
            self.log_result(
                "POST /api/sensor-data - Correct GPS Data Test",
                False,
                f"Exception: {str(e)}"
            )
            return False
    
    def verify_stored_gps_data(self, device_id, expected_coords):
        """Verify that the GPS data was stored correctly in the database"""
        try:
            # Get recent data to find our test data
            response = requests.get(f"{self.backend_url}/admin/sensor-data?limit=50")
            
            if response.status_code == 200:
                data = response.json()
                sensor_data = data.get('data', [])
                
                # Look for our test device data
                test_records = []
                for record in sensor_data:
                    # Check if this could be our test data (recent timestamp)
                    record_time = datetime.fromisoformat(record.get('timestamp', '').replace('Z', '+00:00'))
                    if (datetime.now() - record_time.replace(tzinfo=None)).total_seconds() < 300:  # Within 5 minutes
                        test_records.append(record)
                
                # Analyze coordinates in recent records
                coords_found = []
                for record in test_records:
                    lat = record.get('latitude', 0)
                    lng = record.get('longitude', 0)
                    if lat != 0.0 or lng != 0.0:
                        coords_found.append({
                            'latitude': lat,
                            'longitude': lng,
                            'timestamp': record.get('timestamp')
                        })
                
                success = len(coords_found) > 0
                details = f"Found {len(coords_found)} records with non-zero coordinates in recent data out of {len(test_records)} recent records"
                
                self.log_result(
                    "Verify Stored GPS Data",
                    success,
                    details,
                    {
                        'expected_coordinates': expected_coords,
                        'found_coordinates': coords_found,
                        'recent_records_checked': len(test_records)
                    }
                )
                
                return success
                
            else:
                self.log_result(
                    "Verify Stored GPS Data",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Verify Stored GPS Data",
                False,
                f"Exception: {str(e)}"
            )
            return False
    
    def test_4_check_non_zero_coordinates(self):
        """Test 4: Проверить есть ли записи с НЕ нулевыми координатами"""
        try:
            # Get a larger sample to find any non-zero coordinates
            response = requests.get(f"{self.backend_url}/admin/sensor-data?limit=100")
            
            if response.status_code == 200:
                data = response.json()
                sensor_data = data.get('data', [])
                total_records = data.get('total', 0)
                
                # Find all non-zero coordinates
                non_zero_records = []
                coordinate_stats = {
                    'total_checked': len(sensor_data),
                    'zero_coordinates': 0,
                    'non_zero_coordinates': 0,
                    'unique_coordinates': set()
                }
                
                for record in sensor_data:
                    lat = record.get('latitude', 0)
                    lng = record.get('longitude', 0)
                    
                    if lat == 0.0 and lng == 0.0:
                        coordinate_stats['zero_coordinates'] += 1
                    else:
                        coordinate_stats['non_zero_coordinates'] += 1
                        coordinate_stats['unique_coordinates'].add((lat, lng))
                        non_zero_records.append({
                            'id': record.get('_id'),
                            'latitude': lat,
                            'longitude': lng,
                            'timestamp': record.get('timestamp'),
                            'speed': record.get('speed'),
                            'accuracy': record.get('accuracy')
                        })
                
                coordinate_stats['unique_coordinates'] = list(coordinate_stats['unique_coordinates'])
                
                has_non_zero = len(non_zero_records) > 0
                details = f"Found {len(non_zero_records)} records with non-zero coordinates out of {len(sensor_data)} checked (Total DB: {total_records})"
                
                self.log_result(
                    "Check for Non-Zero Coordinates",
                    True,  # Always successful if we can query
                    details,
                    {
                        'statistics': coordinate_stats,
                        'has_non_zero_coordinates': has_non_zero,
                        'non_zero_records': non_zero_records[:10],  # First 10 non-zero records
                        'total_database_records': total_records
                    }
                )
                
                return non_zero_records
                
            else:
                self.log_result(
                    "Check for Non-Zero Coordinates",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return []
                
        except Exception as e:
            self.log_result(
                "Check for Non-Zero Coordinates",
                False,
                f"Exception: {str(e)}"
            )
            return []
    
    def test_5_analyze_data_structure(self):
        """Test 5: Анализ структуры данных - все поля включая GPS, accuracy, speed"""
        try:
            response = requests.get(f"{self.backend_url}/admin/sensor-data?limit=5")
            
            if response.status_code == 200:
                data = response.json()
                sensor_data = data.get('data', [])
                
                if not sensor_data:
                    self.log_result(
                        "Data Structure Analysis",
                        False,
                        "No sensor data found in database"
                    )
                    return
                
                # Analyze data structure
                structure_analysis = {
                    'total_records_analyzed': len(sensor_data),
                    'field_analysis': {},
                    'sample_record': sensor_data[0] if sensor_data else None
                }
                
                # Analyze each field across all records
                all_fields = set()
                for record in sensor_data:
                    all_fields.update(record.keys())
                
                for field in all_fields:
                    field_stats = {
                        'present_count': 0,
                        'null_count': 0,
                        'zero_count': 0,
                        'sample_values': []
                    }
                    
                    for record in sensor_data:
                        value = record.get(field)
                        if value is not None:
                            field_stats['present_count'] += 1
                            if value == 0 or value == 0.0:
                                field_stats['zero_count'] += 1
                            if len(field_stats['sample_values']) < 3:
                                field_stats['sample_values'].append(value)
                        else:
                            field_stats['null_count'] += 1
                    
                    structure_analysis['field_analysis'][field] = field_stats
                
                # Focus on GPS-related fields
                gps_fields = ['latitude', 'longitude', 'speed', 'accuracy']
                gps_analysis = {}
                for field in gps_fields:
                    if field in structure_analysis['field_analysis']:
                        gps_analysis[field] = structure_analysis['field_analysis'][field]
                
                details = f"Analyzed {len(sensor_data)} records with {len(all_fields)} fields. GPS fields analysis completed."
                
                self.log_result(
                    "Data Structure Analysis",
                    True,
                    details,
                    {
                        'structure_analysis': structure_analysis,
                        'gps_fields_analysis': gps_analysis,
                        'all_fields': list(all_fields)
                    }
                )
                
                return structure_analysis
                
            else:
                self.log_result(
                    "Data Structure Analysis",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return None
                
        except Exception as e:
            self.log_result(
                "Data Structure Analysis",
                False,
                f"Exception: {str(e)}"
            )
            return None
    
    def generate_investigation_report(self):
        """Generate comprehensive investigation report"""
        print("\n" + "="*80)
        print("GPS COORDINATES INVESTIGATION REPORT")
        print("="*80)
        
        # Summary statistics
        total_tests = len(self.test_results)
        passed_tests = sum(1 for r in self.test_results if r['success'])
        failed_tests = total_tests - passed_tests
        
        print(f"\nTEST SUMMARY:")
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {passed_tests}")
        print(f"Failed: {failed_tests}")
        print(f"Success Rate: {(passed_tests/total_tests*100):.1f}%")
        
        print(f"\nDETAILED FINDINGS:")
        
        # Analyze results for GPS coordinate issues
        coordinate_findings = []
        
        for result in self.test_results:
            if result['data'] and isinstance(result['data'], dict):
                # Look for coordinate-related data
                if 'zero_coordinates' in result['data']:
                    coordinate_findings.append({
                        'test': result['test'],
                        'zero_coords': result['data']['zero_coordinates'],
                        'non_zero_coords': result['data'].get('non_zero_coordinates', 0),
                        'total_records': result['data'].get('total_records', 0)
                    })
        
        if coordinate_findings:
            print(f"\nCOORDINATE ANALYSIS:")
            for finding in coordinate_findings:
                print(f"- {finding['test']}: {finding['zero_coords']} zero coords, {finding['non_zero_coords']} non-zero coords")
        
        # Root cause analysis
        print(f"\nROOT CAUSE ANALYSIS:")
        print("Based on the investigation, the GPS coordinate issue appears to be at the:")
        
        # Determine where the issue occurs
        has_non_zero_in_db = any(
            r['data'] and r['data'].get('non_zero_coordinates', 0) > 0 
            for r in self.test_results if r['data']
        )
        
        post_test_success = any(
            r['test'].startswith('POST /api/sensor-data') and r['success']
            for r in self.test_results
        )
        
        if has_non_zero_in_db:
            print("✅ Database level: Some records have non-zero coordinates")
            print("✅ Backend API level: POST endpoint can process GPS data")
            print("❓ Mobile app level: Issue likely in mobile GPS data collection or transmission")
        elif post_test_success:
            print("✅ Backend API level: POST endpoint works correctly")
            print("❓ Data processing level: Issue in how GPS data is extracted and stored")
        else:
            print("❌ Backend API level: POST endpoint has issues")
        
        print(f"\nRECOMMENDATIONS:")
        print("1. Check mobile app GPS permission and location service status")
        print("2. Verify GPS data is being captured correctly in mobile app")
        print("3. Check data transmission format from mobile to backend")
        print("4. Verify backend data processing logic for location extraction")
        print("5. Check MongoDB data storage and retrieval processes")
        
        return self.test_results

def main():
    """Main investigation function"""
    print("Starting GPS Coordinates Investigation...")
    print(f"Backend URL: {BACKEND_URL}")
    print("="*80)
    
    investigator = GPSCoordinatesInvestigation()
    
    # Run all investigation tests
    print("Test 1: Getting raw sensor data...")
    investigator.test_1_get_raw_sensor_data()
    
    print("Test 2: Getting latest 10 records...")
    investigator.test_2_get_latest_10_records()
    
    print("Test 3: Testing POST with correct GPS data...")
    investigator.test_3_post_correct_gps_data()
    
    print("Test 4: Checking for non-zero coordinates...")
    investigator.test_4_check_non_zero_coordinates()
    
    print("Test 5: Analyzing data structure...")
    investigator.test_5_analyze_data_structure()
    
    # Generate final report
    investigator.generate_investigation_report()
    
    return investigator.test_results

if __name__ == "__main__":
    main()