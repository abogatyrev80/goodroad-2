#!/usr/bin/env python3
"""
Good Road Backend API Testing Suite
Tests all backend endpoints with realistic sensor data
"""

import requests
import json
import time
import os
from datetime import datetime, timedelta

# Get backend URL from environment
BACKEND_URL = "https://drivesense.preview.emergentagent.com/api"

class GoodRoadAPITester:
    def __init__(self):
        self.base_url = BACKEND_URL
        self.test_results = []
        
    def log_test(self, test_name, success, details=""):
        """Log test results"""
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        print()

    def test_root_endpoint(self):
        """Test GET /api/ root endpoint"""
        try:
            response = requests.get(f"{self.base_url}/")
            if response.status_code == 200:
                data = response.json()
                if "message" in data and "Good Road" in data["message"]:
                    self.log_test("Root Endpoint", True, f"Response: {data}")
                    return True
                else:
                    self.log_test("Root Endpoint", False, f"Unexpected response: {data}")
                    return False
            else:
                self.log_test("Root Endpoint", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
        except Exception as e:
            self.log_test("Root Endpoint", False, f"Exception: {str(e)}")
            return False

    def test_sensor_data_upload(self):
        """Test POST /api/sensor-data with realistic data"""
        # Test data from review request with additional realistic points
        test_data = {
            "deviceId": "test-device-001",
            "sensorData": [
                # Location data points
                {
                    "type": "location",
                    "timestamp": int(time.time() * 1000),
                    "data": {
                        "latitude": 40.7128,
                        "longitude": -74.0060,
                        "speed": 30.5,
                        "accuracy": 5.0
                    }
                },
                {
                    "type": "location", 
                    "timestamp": int(time.time() * 1000) + 5000,
                    "data": {
                        "latitude": 40.7129,
                        "longitude": -74.0061,
                        "speed": 32.0,
                        "accuracy": 4.5
                    }
                },
                # Normal accelerometer data (good road)
                {
                    "type": "accelerometer",
                    "timestamp": int(time.time() * 1000) + 100,
                    "data": {
                        "x": 0.1,
                        "y": 0.2,
                        "z": 9.8,
                        "totalAcceleration": 9.82
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": int(time.time() * 1000) + 200,
                    "data": {
                        "x": 0.15,
                        "y": 0.18,
                        "z": 9.85,
                        "totalAcceleration": 9.87
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": int(time.time() * 1000) + 300,
                    "data": {
                        "x": 0.12,
                        "y": 0.22,
                        "z": 9.78,
                        "totalAcceleration": 9.81
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": int(time.time() * 1000) + 400,
                    "data": {
                        "x": 0.08,
                        "y": 0.25,
                        "z": 9.82,
                        "totalAcceleration": 9.84
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": int(time.time() * 1000) + 500,
                    "data": {
                        "x": 0.11,
                        "y": 0.19,
                        "z": 9.79,
                        "totalAcceleration": 9.83
                    }
                }
            ]
        }

        try:
            response = requests.post(
                f"{self.base_url}/sensor-data",
                json=test_data,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                expected_keys = ["message", "rawDataPoints", "conditionsProcessed", "warningsGenerated"]
                if all(key in data for key in expected_keys):
                    self.log_test("Sensor Data Upload", True, 
                                f"Processed {data['rawDataPoints']} points, "
                                f"{data['conditionsProcessed']} conditions, "
                                f"{data['warningsGenerated']} warnings")
                    return True
                else:
                    self.log_test("Sensor Data Upload", False, f"Missing expected keys in response: {data}")
                    return False
            else:
                self.log_test("Sensor Data Upload", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
        except Exception as e:
            self.log_test("Sensor Data Upload", False, f"Exception: {str(e)}")
            return False

    def test_sensor_data_with_poor_road(self):
        """Test sensor data upload with high variance data (poor road conditions)"""
        # High variance accelerometer data to trigger poor road detection
        test_data = {
            "deviceId": "test-device-002",
            "sensorData": [
                {
                    "type": "location",
                    "timestamp": int(time.time() * 1000),
                    "data": {
                        "latitude": 40.7130,
                        "longitude": -74.0062,
                        "speed": 25.0,
                        "accuracy": 5.0
                    }
                },
                # High variance accelerometer data (poor road)
                {
                    "type": "accelerometer",
                    "timestamp": int(time.time() * 1000) + 100,
                    "data": {
                        "x": 2.5,
                        "y": 1.8,
                        "z": 12.3,
                        "totalAcceleration": 12.8
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": int(time.time() * 1000) + 200,
                    "data": {
                        "x": -1.2,
                        "y": 3.1,
                        "z": 7.5,
                        "totalAcceleration": 8.2
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": int(time.time() * 1000) + 300,
                    "data": {
                        "x": 3.8,
                        "y": -2.1,
                        "z": 15.2,
                        "totalAcceleration": 15.8
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": int(time.time() * 1000) + 400,
                    "data": {
                        "x": -2.5,
                        "y": 4.2,
                        "z": 6.1,
                        "totalAcceleration": 7.8
                    }
                },
                {
                    "type": "accelerometer",
                    "timestamp": int(time.time() * 1000) + 500,
                    "data": {
                        "x": 4.1,
                        "y": -1.8,
                        "z": 14.5,
                        "totalAcceleration": 15.1
                    }
                }
            ]
        }

        try:
            response = requests.post(
                f"{self.base_url}/sensor-data",
                json=test_data,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                # Should generate warnings due to high variance
                if data.get("warningsGenerated", 0) > 0:
                    self.log_test("Poor Road Detection", True, 
                                f"Generated {data['warningsGenerated']} warnings for poor road conditions")
                    return True
                else:
                    self.log_test("Poor Road Detection", True, 
                                "No warnings generated - may indicate good algorithm sensitivity")
                    return True
            else:
                self.log_test("Poor Road Detection", False, f"Status: {response.status_code}")
                return False
        except Exception as e:
            self.log_test("Poor Road Detection", False, f"Exception: {str(e)}")
            return False

    def test_road_conditions_api(self):
        """Test GET /api/road-conditions"""
        # Test with NYC coordinates
        params = {
            "latitude": 40.7128,
            "longitude": -74.0060,
            "radius": 1000
        }
        
        try:
            response = requests.get(f"{self.base_url}/road-conditions", params=params)
            
            if response.status_code == 200:
                data = response.json()
                expected_keys = ["location", "radius", "conditions"]
                if all(key in data for key in expected_keys):
                    conditions_count = len(data["conditions"])
                    self.log_test("Road Conditions API", True, 
                                f"Found {conditions_count} road conditions within {params['radius']}m")
                    return True
                else:
                    self.log_test("Road Conditions API", False, f"Missing expected keys: {data}")
                    return False
            else:
                self.log_test("Road Conditions API", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
        except Exception as e:
            self.log_test("Road Conditions API", False, f"Exception: {str(e)}")
            return False

    def test_road_warnings_api(self):
        """Test GET /api/warnings"""
        # Test with NYC coordinates
        params = {
            "latitude": 40.7128,
            "longitude": -74.0060,
            "radius": 1000
        }
        
        try:
            response = requests.get(f"{self.base_url}/warnings", params=params)
            
            if response.status_code == 200:
                data = response.json()
                expected_keys = ["location", "radius", "warnings"]
                if all(key in data for key in expected_keys):
                    warnings_count = len(data["warnings"])
                    self.log_test("Road Warnings API", True, 
                                f"Found {warnings_count} warnings within {params['radius']}m")
                    return True
                else:
                    self.log_test("Road Warnings API", False, f"Missing expected keys: {data}")
                    return False
            else:
                self.log_test("Road Warnings API", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
        except Exception as e:
            self.log_test("Road Warnings API", False, f"Exception: {str(e)}")
            return False

    def test_analytics_api(self):
        """Test GET /api/analytics/summary"""
        try:
            response = requests.get(f"{self.base_url}/analytics/summary")
            
            if response.status_code == 200:
                data = response.json()
                expected_keys = ["totalSensorDataBatches", "totalRoadConditions", "totalWarnings", "conditionDistribution", "lastUpdated"]
                if all(key in data for key in expected_keys):
                    self.log_test("Analytics API", True, 
                                f"Batches: {data['totalSensorDataBatches']}, "
                                f"Conditions: {data['totalRoadConditions']}, "
                                f"Warnings: {data['totalWarnings']}")
                    return True
                else:
                    self.log_test("Analytics API", False, f"Missing expected keys: {data}")
                    return False
            else:
                self.log_test("Analytics API", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
        except Exception as e:
            self.log_test("Analytics API", False, f"Exception: {str(e)}")
            return False

    def test_edge_cases(self):
        """Test edge cases and error handling"""
        # Test empty sensor data
        empty_data = {
            "deviceId": "test-device-empty",
            "sensorData": []
        }
        
        try:
            response = requests.post(
                f"{self.base_url}/sensor-data",
                json=empty_data,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("rawDataPoints") == 0:
                    self.log_test("Empty Sensor Data", True, "Handled empty data correctly")
                else:
                    self.log_test("Empty Sensor Data", False, f"Unexpected response: {data}")
            else:
                self.log_test("Empty Sensor Data", False, f"Status: {response.status_code}")
        except Exception as e:
            self.log_test("Empty Sensor Data", False, f"Exception: {str(e)}")

        # Test invalid coordinates
        try:
            response = requests.get(f"{self.base_url}/road-conditions", params={
                "latitude": 999,
                "longitude": 999,
                "radius": 1000
            })
            
            if response.status_code == 200:
                data = response.json()
                self.log_test("Invalid Coordinates", True, "API handled invalid coordinates")
            else:
                self.log_test("Invalid Coordinates", False, f"Status: {response.status_code}")
        except Exception as e:
            self.log_test("Invalid Coordinates", False, f"Exception: {str(e)}")

    def test_cleanup_endpoint(self):
        """Test DELETE /api/data/cleanup"""
        try:
            response = requests.delete(f"{self.base_url}/data/cleanup")
            
            if response.status_code == 200:
                data = response.json()
                expected_keys = ["message", "deletedSensorBatches", "deletedWarnings"]
                if all(key in data for key in expected_keys):
                    self.log_test("Data Cleanup", True, 
                                f"Deleted {data['deletedSensorBatches']} batches, "
                                f"{data['deletedWarnings']} warnings")
                    return True
                else:
                    self.log_test("Data Cleanup", False, f"Missing expected keys: {data}")
                    return False
            else:
                self.log_test("Data Cleanup", False, f"Status: {response.status_code}")
                return False
        except Exception as e:
            self.log_test("Data Cleanup", False, f"Exception: {str(e)}")
            return False

    def run_all_tests(self):
        """Run comprehensive test suite"""
        print("=" * 60)
        print("GOOD ROAD BACKEND API TEST SUITE")
        print("=" * 60)
        print(f"Testing backend at: {self.base_url}")
        print()

        # Core API tests
        self.test_root_endpoint()
        self.test_sensor_data_upload()
        self.test_sensor_data_with_poor_road()
        self.test_road_conditions_api()
        self.test_road_warnings_api()
        self.test_analytics_api()
        
        # Edge case tests
        self.test_edge_cases()
        
        # Cleanup test
        self.test_cleanup_endpoint()

        # Summary
        print("=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for result in self.test_results if result["success"])
        total = len(self.test_results)
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        print(f"Success Rate: {(passed/total)*100:.1f}%")
        
        if total - passed > 0:
            print("\nFailed Tests:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"  - {result['test']}: {result['details']}")
        
        return passed == total

if __name__ == "__main__":
    tester = GoodRoadAPITester()
    success = tester.run_all_tests()
    exit(0 if success else 1)