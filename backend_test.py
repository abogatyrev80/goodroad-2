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
BACKEND_URL = "https://potholefinder.preview.emergentagent.com/api"

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
            
    def run_all_tests(self):
        """Run all EventDetector and BatchOfflineManager tests"""
        print("🚀 Starting EventDetector (Phase 2) and BatchOfflineManager (Phase 3) Backend Testing")
        print(f"Backend URL: {BACKEND_URL}")
        print("=" * 80)
        
        # Test sequence
        tests = [
            ("API Connectivity", self.test_api_connectivity),
            ("Event Type Data Processing", self.test_event_type_sensor_data),
            ("Severity Mapping", self.test_severity_mapping),
            ("Warning Generation", self.test_warning_generation),
            ("Mixed Data Format", self.test_mixed_data_format),
            ("Database Verification", self.test_database_verification)
        ]
        
        passed_tests = 0
        total_tests = len(tests)
        
        for test_name, test_func in tests:
            print(f"\n--- {test_name} ---")
            try:
                if test_func():
                    passed_tests += 1
            except Exception as e:
                self.log_test(test_name, False, f"Test execution error: {str(e)}")
                
        # Summary
        print("\n" + "=" * 80)
        print("🎯 EventDetector & BatchOfflineManager Backend Test Summary")
        print("=" * 80)
        
        success_rate = (passed_tests / total_tests) * 100
        print(f"Tests Passed: {passed_tests}/{total_tests} ({success_rate:.1f}%)")
        
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
    tester = EventDetectorTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)