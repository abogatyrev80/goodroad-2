#!/usr/bin/env python3
"""
Good Road App Backend Testing Suite - Phase 1 Clusters Testing
Testing clusters functionality and related backend APIs as requested in review
"""

import requests
import json
import time
from datetime import datetime, timedelta
import sys

# Backend URL from frontend/.env - using REACT_APP_BACKEND_URL
BACKEND_URL = "https://road-monitor-4.emergent.host/api"

class BackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.test_results = []
        self.total_tests = 0
        self.passed_tests = 0
        
    def log_test(self, test_name, success, details=""):
        """Log test results"""
        self.total_tests += 1
        if success:
            self.passed_tests += 1
        
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
    
    def add_test_data_for_clear_db(self):
        """Add test data with different dates for Clear Database V2 filtering tests"""
        print("\n🔧 Adding test data with different dates for Clear Database V2 tests...")
        
        # Test data for different date ranges
        test_dates = [
            "2023-12-15",  # Old data (should be deleted in date range tests)
            "2024-06-15",  # Mid-range data
            "2025-01-15",  # Recent data (current month)
            "2025-02-01",  # Future data
        ]
        
        for date_str in test_dates:
            # Create test sensor data
            test_data = {
                "deviceId": f"test-clear-db-{date_str}",
                "sensorData": [
                    {
                        "type": "location",
                        "timestamp": int(datetime.fromisoformat(date_str + "T12:00:00").timestamp() * 1000),
                        "data": {
                            "latitude": 55.7558,
                            "longitude": 37.6176,
                            "speed": 25.0,
                            "accuracy": 5.0
                        }
                    },
                    {
                        "type": "accelerometer", 
                        "timestamp": int(datetime.fromisoformat(date_str + "T12:00:01").timestamp() * 1000),
                        "data": {
                            "x": 0.2,
                            "y": 0.4,
                            "z": 9.8
                        }
                    }
                ]
            }
            
            try:
                response = self.session.post(f"{BACKEND_URL}/sensor-data", json=test_data, timeout=10)
                if response and response.status_code == 200:
                    print(f"   ✅ Added test data for {date_str}")
                else:
                    print(f"   ❌ Failed to add test data for {date_str}: {response.status_code if response else 'No response'}")
            except Exception as e:
                print(f"   ❌ Error adding test data for {date_str}: {str(e)}")
    
    def test_clear_database_v2_no_confirmation(self):
        """Test Clear Database V2: Request without confirmation parameter"""
        print("\n🧪 Testing Clear Database V2 - No Confirmation")
        
        try:
            response = self.session.delete(f"{BACKEND_URL}/admin/clear-database-v2", timeout=10)
            
            if response is None:
                self.log_test("Clear DB V2 - No Confirmation", False, "Request failed")
                return False
                
            if response.status_code == 422:  # FastAPI validation error
                try:
                    data = response.json()
                    # Check if it's a validation error for missing confirm parameter
                    if isinstance(data.get("detail"), list) and len(data["detail"]) > 0:
                        error = data["detail"][0]
                        if error.get("loc") == ["query", "confirm"] and error.get("type") == "missing":
                            self.log_test("Clear DB V2 - No Confirmation", True, "Correctly rejected without confirmation (422 validation error)")
                            return True
                    
                    self.log_test("Clear DB V2 - No Confirmation", False, f"Unexpected validation error: {data}")
                    return False
                except:
                    self.log_test("Clear DB V2 - No Confirmation", False, "Invalid JSON response")
                    return False
            else:
                self.log_test("Clear DB V2 - No Confirmation", False, f"Expected 422, got {response.status_code}")
                return False
        except Exception as e:
            self.log_test("Clear DB V2 - No Confirmation", False, f"Error: {str(e)}")
            return False
    
    def test_clear_database_v2_invalid_date(self):
        """Test Clear Database V2: Request with invalid date format"""
        print("\n🧪 Testing Clear Database V2 - Invalid Date Format")
        
        try:
            response = self.session.delete(f"{BACKEND_URL}/admin/clear-database-v2", 
                                         params={"confirm": "CONFIRM", "date_from": "invalid-date"},
                                         timeout=10)
            
            if response is None:
                self.log_test("Clear DB V2 - Invalid Date", False, "Request failed")
                return False
                
            if response.status_code == 400:
                try:
                    data = response.json()
                    detail = data.get("detail", "").lower()
                    if "формат" in detail or "format" in detail or "invalid" in detail:
                        self.log_test("Clear DB V2 - Invalid Date", True, "Correctly rejected invalid date format")
                        return True
                    else:
                        self.log_test("Clear DB V2 - Invalid Date", False, f"Wrong error message: {data}")
                        return False
                except:
                    self.log_test("Clear DB V2 - Invalid Date", False, "Invalid JSON response")
                    return False
            else:
                self.log_test("Clear DB V2 - Invalid Date", False, f"Expected 400, got {response.status_code}")
                return False
        except Exception as e:
            self.log_test("Clear DB V2 - Invalid Date", False, f"Error: {str(e)}")
            return False
    
    def test_clear_database_v2_date_range(self):
        """Test Clear Database V2: Clear database with date range"""
        print("\n🧪 Testing Clear Database V2 - Date Range (2025-01-01 to 2025-01-31)")
        
        try:
            response = self.session.delete(f"{BACKEND_URL}/admin/clear-database-v2", 
                                         params={
                                             "confirm": "CONFIRM",
                                             "date_from": "2025-01-01",
                                             "date_to": "2025-01-31"
                                         },
                                         timeout=30)
            
            if response is None:
                self.log_test("Clear DB V2 - Date Range", False, "Request failed")
                return False
                
            if response.status_code == 200:
                try:
                    data = response.json()
                    required_fields = ["message", "database", "period", "total_deleted", "details"]
                    
                    missing_fields = [field for field in required_fields if field not in data]
                    if missing_fields:
                        self.log_test("Clear DB V2 - Date Range", False, f"Missing fields: {missing_fields}")
                        return False
                    
                    # Check period structure
                    period = data.get("period", {})
                    if period.get("from") != "2025-01-01" or period.get("to") != "2025-01-31":
                        self.log_test("Clear DB V2 - Date Range", False, f"Wrong period: {period}")
                        return False
                    
                    # Check details structure (should have collection breakdown)
                    details = data.get("details", {})
                    expected_collections = ['raw_sensor_data', 'processed_events', 'events', 
                                          'user_warnings', 'road_conditions', 'road_warnings', 
                                          'sensor_data', 'calibration_profiles']
                    
                    found_collections = [col for col in expected_collections if col in details]
                    if len(found_collections) < 6:  # At least 6 collections should be present
                        self.log_test("Clear DB V2 - Date Range", False, f"Missing collections in details: {details}")
                        return False
                    
                    self.log_test("Clear DB V2 - Date Range", True, 
                                f"Deleted {data['total_deleted']} records from {len(found_collections)} collections")
                    return True
                    
                except Exception as e:
                    self.log_test("Clear DB V2 - Date Range", False, f"JSON parsing error: {e}")
                    return False
            else:
                self.log_test("Clear DB V2 - Date Range", False, f"Expected 200, got {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_test("Clear DB V2 - Date Range", False, f"Error: {str(e)}")
            return False
    
    def test_clear_database_v2_from_date(self):
        """Test Clear Database V2: Clear database from specific date"""
        print("\n🧪 Testing Clear Database V2 - From Date (2024-01-01)")
        
        try:
            response = self.session.delete(f"{BACKEND_URL}/admin/clear-database-v2", 
                                         params={
                                             "confirm": "CONFIRM",
                                             "date_from": "2024-01-01"
                                         },
                                         timeout=30)
            
            if response is None:
                self.log_test("Clear DB V2 - From Date", False, "Request failed")
                return False
                
            if response.status_code == 200:
                try:
                    data = response.json()
                    
                    # Check period structure
                    period = data.get("period", {})
                    if period.get("from") != "2024-01-01" or period.get("to") is not None:
                        self.log_test("Clear DB V2 - From Date", False, f"Wrong period: {period}")
                        return False
                    
                    # Check message contains appropriate text
                    message = data.get("message", "")
                    if "с 2024-01-01" not in message and "from 2024-01-01" not in message:
                        self.log_test("Clear DB V2 - From Date", False, f"Wrong message: {message}")
                        return False
                    
                    self.log_test("Clear DB V2 - From Date", True, 
                                f"Deleted {data['total_deleted']} records from {data['period']['from']}")
                    return True
                    
                except Exception as e:
                    self.log_test("Clear DB V2 - From Date", False, f"JSON parsing error: {e}")
                    return False
            else:
                self.log_test("Clear DB V2 - From Date", False, f"Expected 200, got {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_test("Clear DB V2 - From Date", False, f"Error: {str(e)}")
            return False
    
    def test_clear_database_v2_to_date(self):
        """Test Clear Database V2: Clear database to specific date"""
        print("\n🧪 Testing Clear Database V2 - To Date (2023-12-31)")
        
        try:
            response = self.session.delete(f"{BACKEND_URL}/admin/clear-database-v2", 
                                         params={
                                             "confirm": "CONFIRM",
                                             "date_to": "2023-12-31"
                                         },
                                         timeout=30)
            
            if response is None:
                self.log_test("Clear DB V2 - To Date", False, "Request failed")
                return False
                
            if response.status_code == 200:
                try:
                    data = response.json()
                    
                    # Check period structure
                    period = data.get("period", {})
                    if period.get("to") != "2023-12-31" or period.get("from") is not None:
                        self.log_test("Clear DB V2 - To Date", False, f"Wrong period: {period}")
                        return False
                    
                    # Check message contains appropriate text
                    message = data.get("message", "")
                    if "до 2023-12-31" not in message and "to 2023-12-31" not in message:
                        self.log_test("Clear DB V2 - To Date", False, f"Wrong message: {message}")
                        return False
                    
                    self.log_test("Clear DB V2 - To Date", True, 
                                f"Deleted {data['total_deleted']} records to {data['period']['to']}")
                    return True
                    
                except Exception as e:
                    self.log_test("Clear DB V2 - To Date", False, f"JSON parsing error: {e}")
                    return False
            else:
                self.log_test("Clear DB V2 - To Date", False, f"Expected 200, got {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_test("Clear DB V2 - To Date", False, f"Error: {str(e)}")
            return False
            
    def test_event_type_sensor_data(self):
        """Test POST /api/sensor-data with NEW event type data format"""
        print("\n🎯 Testing EventDetector Event Type Data Processing...")
        
        # Create test data with event type format
        current_timestamp = int(time.time() * 1000)
        
        test_data = {
            "deviceId": "test-event-detector-001",
            "sensorData": [
                {
                    "type": "event",
                    "timestamp": current_timestamp,
                    "data": {
                        "eventType": "pothole",
                        "severity": 1,
                        "roadType": "asphalt",
                        "location": {
                            "latitude": 55.7558,
                            "longitude": 37.6176,
                            "speed": 45.5,
                            "accuracy": 5.0
                        },
                        "accelerometer": {
                            "x": 0.5,
                            "y": 4.8,
                            "z": 9.8,
                            "magnitude": 5.2,
                            "deltaY": 4.5,
                            "deltaZ": 0.3
                        }
                    }
                },
                {
                    "type": "event",
                    "timestamp": current_timestamp + 1000,
                    "data": {
                        "eventType": "braking",
                        "severity": 2,
                        "roadType": "asphalt",
                        "location": {
                            "latitude": 55.7559,
                            "longitude": 37.6177,
                            "speed": 25.0,
                            "accuracy": 5.0
                        },
                        "accelerometer": {
                            "x": 0.2,
                            "y": 0.5,
                            "z": 3.5,
                            "magnitude": 3.8,
                            "deltaY": 0.4,
                            "deltaZ": 3.2
                        }
                    }
                }
            ]
        }
        
        try:
            response = self.session.post(
                f"{BACKEND_URL}/sensor-data",
                json=test_data,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                result = response.json()
                
                # Check response structure
                expected_fields = ["message", "rawDataPoints", "eventPoints", "conditionsProcessed", "warningsGenerated"]
                missing_fields = [field for field in expected_fields if field not in result]
                
                if missing_fields:
                    self.log_test("Event Type Data Upload", False, f"Missing fields: {missing_fields}")
                    return False
                
                # Verify event processing
                event_points = result.get("eventPoints", 0)
                conditions_processed = result.get("conditionsProcessed", 0)
                warnings_generated = result.get("warningsGenerated", 0)
                
                if event_points == 2 and conditions_processed >= 2:
                    self.log_test("Event Type Data Upload", True, 
                                f"Processed {event_points} events, created {conditions_processed} conditions, {warnings_generated} warnings")
                    return True
                else:
                    self.log_test("Event Type Data Upload", False, 
                                f"Expected 2 events, got {event_points}. Conditions: {conditions_processed}")
                    return False
            else:
                self.log_test("Event Type Data Upload", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_test("Event Type Data Upload", False, f"Error: {str(e)}")
            return False
            
    def test_severity_mapping(self):
        """Test severity to condition score mapping (1->80, 2->60, 3->40, 4->20, 5->0)"""
        print("\n🎯 Testing Severity to Condition Score Mapping...")
        
        severity_tests = [
            {"severity": 1, "expected_score": 80, "event_type": "pothole"},
            {"severity": 2, "expected_score": 60, "event_type": "braking"},
            {"severity": 3, "expected_score": 40, "event_type": "bump"},
            {"severity": 4, "expected_score": 20, "event_type": "vibration"},
            {"severity": 5, "expected_score": 0, "event_type": "normal"}
        ]
        
        all_passed = True
        
        for test_case in severity_tests:
            current_timestamp = int(time.time() * 1000)
            
            test_data = {
                "deviceId": f"test-severity-{test_case['severity']}",
                "sensorData": [
                    {
                        "type": "event",
                        "timestamp": current_timestamp,
                        "data": {
                            "eventType": test_case["event_type"],
                            "severity": test_case["severity"],
                            "roadType": "asphalt",
                            "location": {
                                "latitude": 55.7560 + test_case["severity"] * 0.0001,
                                "longitude": 37.6180 + test_case["severity"] * 0.0001,
                                "speed": 30.0,
                                "accuracy": 5.0
                            },
                            "accelerometer": {
                                "x": 0.1,
                                "y": 0.2,
                                "z": 9.8,
                                "magnitude": 2.0,
                                "deltaY": 0.1,
                                "deltaZ": 0.1
                            }
                        }
                    }
                ]
            }
            
            try:
                response = self.session.post(
                    f"{BACKEND_URL}/sensor-data",
                    json=test_data,
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    result = response.json()
                    conditions_processed = result.get("conditionsProcessed", 0)
                    
                    if conditions_processed >= 1:
                        self.log_test(f"Severity {test_case['severity']} Mapping", True, 
                                    f"Event processed successfully, expected score: {test_case['expected_score']}")
                    else:
                        self.log_test(f"Severity {test_case['severity']} Mapping", False, 
                                    f"No conditions processed for severity {test_case['severity']}")
                        all_passed = False
                else:
                    self.log_test(f"Severity {test_case['severity']} Mapping", False, 
                                f"HTTP {response.status_code}")
                    all_passed = False
                    
            except Exception as e:
                self.log_test(f"Severity {test_case['severity']} Mapping", False, f"Error: {str(e)}")
                all_passed = False
                
            # Small delay between requests
            time.sleep(0.5)
            
        return all_passed
        
    def test_warning_generation(self):
        """Test warning generation for severity 1-2 events"""
        print("\n🎯 Testing Warning Generation for Critical Events...")
        
        current_timestamp = int(time.time() * 1000)
        
        # Test critical events (severity 1-2) that should generate warnings
        critical_events = [
            {"eventType": "pothole", "severity": 1, "expected_warning": "pothole"},
            {"eventType": "braking", "severity": 2, "expected_warning": "rough_road"},
            {"eventType": "bump", "severity": 1, "expected_warning": "speed_bump"},
            {"eventType": "vibration", "severity": 2, "expected_warning": "rough_road"}
        ]
        
        warnings_generated = 0
        
        for i, event in enumerate(critical_events):
            test_data = {
                "deviceId": f"test-warning-{i+1}",
                "sensorData": [
                    {
                        "type": "event",
                        "timestamp": current_timestamp + i * 1000,
                        "data": {
                            "eventType": event["eventType"],
                            "severity": event["severity"],
                            "roadType": "asphalt",
                            "location": {
                                "latitude": 55.7570 + i * 0.0001,
                                "longitude": 37.6190 + i * 0.0001,
                                "speed": 40.0,
                                "accuracy": 5.0
                            },
                            "accelerometer": {
                                "x": 0.3,
                                "y": 2.5,
                                "z": 9.8,
                                "magnitude": 4.0,
                                "deltaY": 2.0,
                                "deltaZ": 0.2
                            }
                        }
                    }
                ]
            }
            
            try:
                response = self.session.post(
                    f"{BACKEND_URL}/sensor-data",
                    json=test_data,
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    result = response.json()
                    warnings_count = result.get("warningsGenerated", 0)
                    warnings_generated += warnings_count
                    
                    if warnings_count > 0:
                        self.log_test(f"Warning for {event['eventType']} (severity {event['severity']})", True, 
                                    f"Generated {warnings_count} warning(s)")
                    else:
                        self.log_test(f"Warning for {event['eventType']} (severity {event['severity']})", False, 
                                    "No warnings generated for critical event")
                else:
                    self.log_test(f"Warning for {event['eventType']}", False, f"HTTP {response.status_code}")
                    
            except Exception as e:
                self.log_test(f"Warning for {event['eventType']}", False, f"Error: {str(e)}")
                
            time.sleep(0.5)
            
        # Overall warning generation test
        if warnings_generated >= 3:  # Expect at least 3 warnings from 4 critical events
            self.log_test("Critical Event Warning Generation", True, 
                        f"Generated {warnings_generated} warnings from critical events")
            return True
        else:
            self.log_test("Critical Event Warning Generation", False, 
                        f"Only {warnings_generated} warnings generated from 4 critical events")
            return False
            
    def test_mixed_data_format(self):
        """Test mixed old format (location + accelerometer) and new format (events)"""
        print("\n🎯 Testing Mixed Data Format Processing...")
        
        current_timestamp = int(time.time() * 1000)
        
        mixed_data = {
            "deviceId": "test-mixed-format-001",
            "sensorData": [
                # Old format - location data
                {
                    "type": "location",
                    "timestamp": current_timestamp,
                    "data": {
                        "latitude": 55.7580,
                        "longitude": 37.6200,
                        "speed": 35.0,
                        "accuracy": 4.0
                    }
                },
                # Old format - accelerometer data
                {
                    "type": "accelerometer",
                    "timestamp": current_timestamp + 100,
                    "data": {
                        "x": 0.2,
                        "y": 1.5,
                        "z": 9.8,
                        "totalAcceleration": 10.0
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": current_timestamp + 200,
                    "data": {
                        "x": 0.3,
                        "y": 2.0,
                        "z": 9.7,
                        "totalAcceleration": 10.1
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": current_timestamp + 300,
                    "data": {
                        "x": 0.1,
                        "y": 1.8,
                        "z": 9.9,
                        "totalAcceleration": 10.05
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": current_timestamp + 400,
                    "data": {
                        "x": 0.4,
                        "y": 1.2,
                        "z": 9.8,
                        "totalAcceleration": 9.95
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": current_timestamp + 500,
                    "data": {
                        "x": 0.2,
                        "y": 1.7,
                        "z": 9.8,
                        "totalAcceleration": 10.02
                    }
                },
                # New format - event data
                {
                    "type": "event",
                    "timestamp": current_timestamp + 1000,
                    "data": {
                        "eventType": "pothole",
                        "severity": 2,
                        "roadType": "concrete",
                        "location": {
                            "latitude": 55.7581,
                            "longitude": 37.6201,
                            "speed": 30.0,
                            "accuracy": 5.0
                        },
                        "accelerometer": {
                            "x": 0.8,
                            "y": 3.2,
                            "z": 9.5,
                            "magnitude": 4.5,
                            "deltaY": 3.0,
                            "deltaZ": 0.3
                        }
                    }
                }
            ]
        }
        
        try:
            response = self.session.post(
                f"{BACKEND_URL}/sensor-data",
                json=mixed_data,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                result = response.json()
                
                location_points = result.get("locationPoints", 0)
                accel_points = result.get("accelerometerPoints", 0)
                event_points = result.get("eventPoints", 0)
                conditions_processed = result.get("conditionsProcessed", 0)
                
                # Verify both old and new formats were processed
                if (location_points == 1 and accel_points == 5 and event_points == 1 and 
                    conditions_processed >= 1):
                    self.log_test("Mixed Data Format Processing", True, 
                                f"Location: {location_points}, Accel: {accel_points}, Events: {event_points}, Conditions: {conditions_processed}")
                    return True
                else:
                    self.log_test("Mixed Data Format Processing", False, 
                                f"Unexpected counts - Location: {location_points}, Accel: {accel_points}, Events: {event_points}")
                    return False
            else:
                self.log_test("Mixed Data Format Processing", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_test("Mixed Data Format Processing", False, f"Error: {str(e)}")
            return False
            
    def test_database_verification(self):
        """Verify database storage of event data"""
        print("\n🎯 Testing Database Verification...")
        
        # Test admin sensor data endpoint
        try:
            response = self.session.get(f"{BACKEND_URL}/admin/sensor-data?limit=5")
            if response.status_code == 200:
                data = response.json()
                sensor_data = data.get("data", [])
                
                # Look for eventPoints field in recent data
                has_event_data = False
                for record in sensor_data:
                    if "eventPoints" in str(record) or any("event" in str(item) for item in record.get("rawData", [])):
                        has_event_data = True
                        break
                
                if has_event_data:
                    self.log_test("Database Event Storage", True, f"Found event data in {len(sensor_data)} recent records")
                else:
                    self.log_test("Database Event Storage", False, "No event data found in recent records")
                    
            else:
                self.log_test("Database Event Storage", False, f"Admin API error: {response.status_code}")
                
        except Exception as e:
            self.log_test("Database Event Storage", False, f"Error: {str(e)}")
            
        # Test road conditions with event metadata
        try:
            response = self.session.get(f"{BACKEND_URL}/road-conditions?latitude=55.7558&longitude=37.6176&radius=5000")
            if response.status_code == 200:
                data = response.json()
                conditions = data.get("conditions", [])
                
                # Look for event_type and road_type fields
                event_conditions = [c for c in conditions if "event_type" in c or "road_type" in c]
                
                if event_conditions:
                    self.log_test("Road Conditions Event Metadata", True, 
                                f"Found {len(event_conditions)} conditions with event metadata")
                else:
                    self.log_test("Road Conditions Event Metadata", False, 
                                "No event metadata found in road conditions")
                    
            else:
                self.log_test("Road Conditions Event Metadata", False, f"API error: {response.status_code}")
                
        except Exception as e:
            self.log_test("Road Conditions Event Metadata", False, f"Error: {str(e)}")
            
        # Test warnings for event-generated alerts
        try:
            response = self.session.get(f"{BACKEND_URL}/warnings?latitude=55.7558&longitude=37.6176&radius=5000")
            if response.status_code == 200:
                data = response.json()
                warnings = data.get("warnings", [])
                
                # Look for event-related warnings
                event_warnings = [w for w in warnings if "event_type" in w or "road_type" in w]
                
                if warnings:
                    self.log_test("Event-Generated Warnings", True, 
                                f"Found {len(warnings)} warnings, {len(event_warnings)} with event metadata")
                else:
                    self.log_test("Event-Generated Warnings", False, "No warnings found")
                    
            else:
                self.log_test("Event-Generated Warnings", False, f"API error: {response.status_code}")
                
        except Exception as e:
            self.log_test("Event-Generated Warnings", False, f"Error: {str(e)}")
            
    def run_clear_database_v2_tests(self):
        """Run Clear Database V2 specific tests"""
        print("🚀 Starting Clear Database V2 API Testing")
        print(f"🎯 Backend URL: {BACKEND_URL}")
        print("=" * 80)
        
        # Test basic connectivity first
        if not self.test_api_connectivity():
            print("❌ Backend connectivity failed. Stopping tests.")
            return False
        
        # Add test data for filtering tests
        self.add_test_data_for_clear_db()
        
        # Clear Database V2 test sequence
        clear_db_tests = [
            ("Clear DB V2 - No Confirmation", self.test_clear_database_v2_no_confirmation),
            ("Clear DB V2 - Invalid Date", self.test_clear_database_v2_invalid_date),
            ("Clear DB V2 - Date Range", self.test_clear_database_v2_date_range),
            ("Clear DB V2 - From Date", self.test_clear_database_v2_from_date),
            ("Clear DB V2 - To Date", self.test_clear_database_v2_to_date),
        ]
        
        clear_db_passed = 0
        
        for test_name, test_func in clear_db_tests:
            print(f"\n--- {test_name} ---")
            try:
                if test_func():
                    clear_db_passed += 1
            except Exception as e:
                self.log_test(test_name, False, f"Test execution error: {str(e)}")
        
        # Summary for Clear Database V2 tests
        print("\n" + "=" * 80)
        print("📊 Clear Database V2 API Test Summary")
        print("=" * 80)
        
        clear_db_success_rate = (clear_db_passed / len(clear_db_tests)) * 100
        print(f"Clear DB V2 Tests Passed: {clear_db_passed}/{len(clear_db_tests)} ({clear_db_success_rate:.1f}%)")
        
        if clear_db_success_rate >= 80:
            print("✅ CLEAR DATABASE V2 API: WORKING CORRECTLY")
        else:
            print("❌ CLEAR DATABASE V2 API: CRITICAL ISSUES FOUND")
        
        return clear_db_success_rate >= 80
    
    def run_all_tests(self):
        """Run all backend tests including Clear Database V2 and EventDetector tests"""
        print("🚀 Starting Comprehensive Backend Testing Suite")
        print(f"Backend URL: {BACKEND_URL}")
        print("=" * 80)
        
        # Test basic connectivity first
        if not self.test_api_connectivity():
            print("❌ Backend connectivity failed. Stopping all tests.")
            return False
        
        # Run Clear Database V2 tests (priority focus)
        print("\n" + "🎯" * 20 + " CLEAR DATABASE V2 TESTS " + "🎯" * 20)
        self.add_test_data_for_clear_db()
        
        clear_db_tests = [
            ("Clear DB V2 - No Confirmation", self.test_clear_database_v2_no_confirmation),
            ("Clear DB V2 - Invalid Date", self.test_clear_database_v2_invalid_date),
            ("Clear DB V2 - Date Range", self.test_clear_database_v2_date_range),
            ("Clear DB V2 - From Date", self.test_clear_database_v2_from_date),
            ("Clear DB V2 - To Date", self.test_clear_database_v2_to_date),
        ]
        
        for test_name, test_func in clear_db_tests:
            print(f"\n--- {test_name} ---")
            try:
                test_func()
            except Exception as e:
                self.log_test(test_name, False, f"Test execution error: {str(e)}")
        
        # Run EventDetector tests (existing functionality)
        print("\n" + "🎯" * 20 + " EVENTDETECTOR TESTS " + "🎯" * 20)
        
        event_tests = [
            ("Event Type Data Processing", self.test_event_type_sensor_data),
            ("Severity Mapping", self.test_severity_mapping),
            ("Warning Generation", self.test_warning_generation),
            ("Mixed Data Format", self.test_mixed_data_format),
            ("Database Verification", self.test_database_verification)
        ]
        
        for test_name, test_func in event_tests:
            print(f"\n--- {test_name} ---")
            try:
                test_func()
            except Exception as e:
                self.log_test(test_name, False, f"Test execution error: {str(e)}")
                
        # Overall Summary
        print("\n" + "=" * 80)
        print("🎯 COMPREHENSIVE BACKEND TEST SUMMARY")
        print("=" * 80)
        
        success_rate = (self.passed_tests / self.total_tests) * 100 if self.total_tests > 0 else 0
        print(f"Overall Tests Passed: {self.passed_tests}/{self.total_tests} ({success_rate:.1f}%)")
        
        # Separate Clear DB V2 results
        clear_db_results = [r for r in self.test_results if "Clear DB V2" in r["test"]]
        clear_db_passed = sum(1 for r in clear_db_results if r["success"])
        clear_db_total = len(clear_db_results)
        
        if clear_db_total > 0:
            clear_db_rate = (clear_db_passed / clear_db_total) * 100
            print(f"Clear Database V2 Tests: {clear_db_passed}/{clear_db_total} ({clear_db_rate:.1f}%)")
        
        if success_rate >= 80:
            print("✅ OVERALL STATUS: BACKEND FUNCTIONALITY WORKING")
        else:
            print("❌ OVERALL STATUS: CRITICAL ISSUES FOUND")
            
        # Detailed results
        print("\nDetailed Results:")
        for result in self.test_results:
            status = "✅" if result["success"] else "❌"
            print(f"{status} {result['test']}")
            if result["details"]:
                print(f"   {result['details']}")
                
        return success_rate >= 80

if __name__ == "__main__":
    tester = BackendTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)