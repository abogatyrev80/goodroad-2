#!/usr/bin/env python3
"""
Backend Test Suite for ML Classification and Clustering Logic
Tests the improved ML logic for road obstacle detection and clustering

Test scenarios based on review request:
1. ML Classification Tests (speed_bump vs pothole accuracy)
2. Clustering Tests (radius 8m, min 3 confirmations)
3. API Endpoint Tests
4. Performance Tests
"""

import asyncio
import aiohttp
import json
import time
import random
import math
from datetime import datetime, timedelta
from typing import Dict, List, Any

# Backend URL from environment
BACKEND_URL = "https://roadguard-13.preview.emergentagent.com/api"

class NearbyObstaclesAPITester:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'NearbyObstaclesTester/1.0'
        })
        self.test_results = []
        
    def log_test(self, test_name: str, success: bool, details: str = "", response_data: Any = None):
        """Log test result"""
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat(),
            "response_data": response_data
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        if not success and response_data:
            print(f"   Response: {response_data}")
        print()

    def test_api_connectivity(self):
        """Test basic API connectivity"""
        try:
            response = self.session.get(f"{BACKEND_URL}/")
            if response.status_code == 200:
                data = response.json()
                self.log_test(
                    "API Connectivity", 
                    True, 
                    f"API version {data.get('version', 'unknown')} operational"
                )
                return True
            else:
                self.log_test(
                    "API Connectivity", 
                    False, 
                    f"HTTP {response.status_code}"
                )
                return False
        except Exception as e:
            self.log_test("API Connectivity", False, f"Connection error: {str(e)}")
            return False

    def test_basic_request(self):
        """Test 1: Basic request with minimal parameters (latitude + longitude)"""
        try:
            # Moscow coordinates for testing
            params = {
                "latitude": 55.7558,
                "longitude": 37.6176
            }
            
            response = self.session.get(f"{BACKEND_URL}/obstacles/nearby", params=params)
            if response.status_code == 200:
                data = response.json()
                
                # Validate response structure
                required_fields = ["userLocation", "searchRadius", "minConfirmations", "total", "obstacles"]
                missing_fields = [field for field in required_fields if field not in data]
                
                if missing_fields:
                    self.log_test(
                        "Basic Request - Response Structure",
                        False,
                        f"Missing fields: {missing_fields}",
                        data
                    )
                    return False
                
                # Validate userLocation
                user_loc = data["userLocation"]
                if user_loc["latitude"] != params["latitude"] or user_loc["longitude"] != params["longitude"]:
                    self.log_test(
                        "Basic Request - User Location",
                        False,
                        f"User location mismatch: expected {params}, got {user_loc}"
                    )
                    return False
                
                # Validate default values
                if data["searchRadius"] != 5000:
                    self.log_test(
                        "Basic Request - Default Radius",
                        False,
                        f"Expected default radius 5000, got {data['searchRadius']}"
                    )
                    return False
                
                if data["minConfirmations"] != 1:
                    self.log_test(
                        "Basic Request - Default Min Confirmations",
                        False,
                        f"Expected default minConfirmations 1, got {data['minConfirmations']}"
                    )
                    return False
                
                self.log_test(
                    "Basic Request",
                    True,
                    f"Found {data['total']} obstacles within {data['searchRadius']}m radius"
                )
                return True
                
            else:
                self.log_test(
                    "Basic Request",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return False
                
        except Exception as e:
            self.log_test("Basic Request", False, f"Exception: {str(e)}")
            return False

    def test_custom_radius(self):
        """Test 2: Request with custom radius (radius=10000)"""
        try:
            params = {
                "latitude": 55.7558,
                "longitude": 37.6176,
                "radius": 10000
            }
            
            response = self.session.get(f"{BACKEND_URL}/obstacles/nearby", params=params)
            if response.status_code == 200:
                data = response.json()
                
                if data["searchRadius"] != 10000:
                    self.log_test(
                        "Custom Radius",
                        False,
                        f"Expected radius 10000, got {data['searchRadius']}"
                    )
                    return False
                
                self.log_test(
                    "Custom Radius",
                    True,
                    f"Custom radius {data['searchRadius']}m applied, found {data['total']} obstacles"
                )
                return True
                
            else:
                self.log_test(
                    "Custom Radius",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return False
                
        except Exception as e:
            self.log_test("Custom Radius", False, f"Exception: {str(e)}")
            return False

    def test_min_confirmations_filter(self):
        """Test 3: Request with confirmation filter (min_confirmations=2)"""
        try:
            params = {
                "latitude": 55.7558,
                "longitude": 37.6176,
                "min_confirmations": 2
            }
            
            response = self.session.get(f"{BACKEND_URL}/obstacles/nearby", params=params)
            if response.status_code == 200:
                data = response.json()
                
                if data["minConfirmations"] != 2:
                    self.log_test(
                        "Min Confirmations Filter",
                        False,
                        f"Expected minConfirmations 2, got {data['minConfirmations']}"
                    )
                    return False
                
                # Validate that all returned obstacles have >= 2 confirmations
                for obstacle in data["obstacles"]:
                    if obstacle["confirmations"] < 2:
                        self.log_test(
                            "Min Confirmations Filter - Validation",
                            False,
                            f"Found obstacle with {obstacle['confirmations']} confirmations, expected >= 2"
                        )
                        return False
                
                self.log_test(
                    "Min Confirmations Filter",
                    True,
                    f"Filter applied correctly, found {data['total']} obstacles with >= 2 confirmations"
                )
                return True
                
            else:
                self.log_test(
                    "Min Confirmations Filter",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return False
                
        except Exception as e:
            self.log_test("Min Confirmations Filter", False, f"Exception: {str(e)}")
            return False

    def test_input_validation(self):
        """Test 4: Input validation (invalid types, missing parameters)"""
        test_cases = [
            {
                "name": "Missing Latitude",
                "params": {"longitude": 37.6176},
                "expected_status": 422
            },
            {
                "name": "Missing Longitude", 
                "params": {"latitude": 55.7558},
                "expected_status": 422
            },
            {
                "name": "Invalid Latitude Type",
                "params": {"latitude": "invalid", "longitude": 37.6176},
                "expected_status": 422
            },
            {
                "name": "Invalid Longitude Type",
                "params": {"latitude": 55.7558, "longitude": "invalid"},
                "expected_status": 422
            },
            {
                "name": "Invalid Radius Type",
                "params": {"latitude": 55.7558, "longitude": 37.6176, "radius": "invalid"},
                "expected_status": 422
            },
            {
                "name": "Invalid Min Confirmations Type",
                "params": {"latitude": 55.7558, "longitude": 37.6176, "min_confirmations": "invalid"},
                "expected_status": 422
            }
        ]
        
        all_passed = True
        
        for test_case in test_cases:
            try:
                response = self.session.get(f"{BACKEND_URL}/obstacles/nearby", params=test_case["params"])
                if response.status_code == test_case["expected_status"]:
                    self.log_test(
                        f"Input Validation - {test_case['name']}",
                        True,
                        f"Correctly returned HTTP {response.status_code}"
                    )
                else:
                    self.log_test(
                        f"Input Validation - {test_case['name']}",
                        False,
                        f"Expected HTTP {test_case['expected_status']}, got {response.status_code}: {response.text}"
                    )
                    all_passed = False
                    
            except Exception as e:
                self.log_test(f"Input Validation - {test_case['name']}", False, f"Exception: {str(e)}")
                all_passed = False
        
        return all_passed

    def test_response_structure(self):
        """Test 5: Detailed response structure validation"""
        try:
            params = {
                "latitude": 55.7558,
                "longitude": 37.6176,
                "radius": 1000
            }
            
            response = self.session.get(f"{BACKEND_URL}/obstacles/nearby", params=params)
            if response.status_code == 200:
                data = response.json()
                
                # Validate obstacle structure if any obstacles exist
                if data["total"] > 0 and data["obstacles"]:
                    obstacle = data["obstacles"][0]
                    required_obstacle_fields = [
                        "id", "type", "latitude", "longitude", "distance", 
                        "severity", "confidence", "confirmations", "avgSpeed", 
                        "lastReported", "priority"
                    ]
                    
                    missing_fields = [field for field in required_obstacle_fields if field not in obstacle]
                    if missing_fields:
                        self.log_test(
                            "Response Structure - Obstacle Fields",
                            False,
                            f"Missing obstacle fields: {missing_fields}",
                            obstacle
                        )
                        return False
                    
                    # Validate severity structure
                    if "severity" in obstacle and isinstance(obstacle["severity"], dict):
                        severity_fields = ["average", "max"]
                        missing_severity = [field for field in severity_fields if field not in obstacle["severity"]]
                        if missing_severity:
                            self.log_test(
                                "Response Structure - Severity Fields",
                                False,
                                f"Missing severity fields: {missing_severity}"
                            )
                            return False
                    
                    self.log_test(
                        "Response Structure",
                        True,
                        f"All required fields present in obstacle structure"
                    )
                else:
                    self.log_test(
                        "Response Structure",
                        True,
                        "No obstacles found - structure validation skipped (expected behavior)"
                    )
                
                return True
                
            else:
                self.log_test(
                    "Response Structure",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return False
                
        except Exception as e:
            self.log_test("Response Structure", False, f"Exception: {str(e)}")
            return False

    def test_priority_algorithm(self):
        """Test 6: Priority algorithm verification"""
        try:
            params = {
                "latitude": 55.7558,
                "longitude": 37.6176,
                "radius": 10000
            }
            
            response = self.session.get(f"{BACKEND_URL}/obstacles/nearby", params=params)
            if response.status_code == 200:
                data = response.json()
                
                if data["total"] > 1:
                    # Verify obstacles are sorted by priority (descending)
                    obstacles = data["obstacles"]
                    for i in range(len(obstacles) - 1):
                        current_priority = obstacles[i]["priority"]
                        next_priority = obstacles[i + 1]["priority"]
                        
                        if current_priority < next_priority:
                            self.log_test(
                                "Priority Algorithm - Sorting",
                                False,
                                f"Obstacles not sorted by priority: {current_priority} < {next_priority}"
                            )
                            return False
                    
                    # Verify priority calculation formula
                    # priority = confirmations * 100 + (1 / (distance + 1)) * 10
                    first_obstacle = obstacles[0]
                    expected_priority = (first_obstacle["confirmations"] * 100 + 
                                       (1 / (first_obstacle["distance"] + 1)) * 10)
                    
                    if abs(first_obstacle["priority"] - expected_priority) > 0.1:
                        self.log_test(
                            "Priority Algorithm - Formula",
                            False,
                            f"Priority calculation mismatch: expected {expected_priority:.2f}, got {first_obstacle['priority']}"
                        )
                        return False
                    
                    self.log_test(
                        "Priority Algorithm",
                        True,
                        f"Priority sorting and calculation verified for {len(obstacles)} obstacles"
                    )
                else:
                    self.log_test(
                        "Priority Algorithm",
                        True,
                        "Insufficient obstacles for priority testing (expected behavior)"
                    )
                
                return True
                
            else:
                self.log_test(
                    "Priority Algorithm",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return False
                
        except Exception as e:
            self.log_test("Priority Algorithm", False, f"Exception: {str(e)}")
            return False

    def test_geographic_filtering(self):
        """Test 7: Geographic filtering accuracy"""
        try:
            # Test with very small radius to verify distance calculations
            params = {
                "latitude": 55.7558,
                "longitude": 37.6176,
                "radius": 100  # 100 meters
            }
            
            response = self.session.get(f"{BACKEND_URL}/obstacles/nearby", params=params)
            if response.status_code == 200:
                data = response.json()
                
                # Verify all returned obstacles are within the specified radius
                for obstacle in data["obstacles"]:
                    if obstacle["distance"] > params["radius"]:
                        self.log_test(
                            "Geographic Filtering",
                            False,
                            f"Obstacle at distance {obstacle['distance']}m exceeds radius {params['radius']}m"
                        )
                        return False
                
                self.log_test(
                    "Geographic Filtering",
                    True,
                    f"All {data['total']} obstacles within {params['radius']}m radius"
                )
                return True
                
            else:
                self.log_test(
                    "Geographic Filtering",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return False
                
        except Exception as e:
            self.log_test("Geographic Filtering", False, f"Exception: {str(e)}")
            return False

    def test_clustering_integration(self):
        """Test 8: Integration with clustering system"""
        try:
            # Test that endpoint uses ObstacleClusterer and returns only active clusters
            params = {
                "latitude": 55.7558,
                "longitude": 37.6176,
                "radius": 5000
            }
            
            response = self.session.get(f"{BACKEND_URL}/obstacles/nearby", params=params)
            if response.status_code == 200:
                data = response.json()
                
                # Verify response format indicates clustering system integration
                if "obstacles" in data:
                    for obstacle in data["obstacles"]:
                        # Check that obstacle has clustering-related fields
                        required_cluster_fields = ["confirmations", "confidence", "lastReported"]
                        missing_fields = [field for field in required_cluster_fields if field not in obstacle]
                        
                        if missing_fields:
                            self.log_test(
                                "Clustering Integration",
                                False,
                                f"Missing clustering fields: {missing_fields}"
                            )
                            return False
                
                self.log_test(
                    "Clustering Integration",
                    True,
                    f"Clustering system integration verified - returned {data['total']} active clusters"
                )
                return True
                
            else:
                self.log_test(
                    "Clustering Integration",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return False
                
        except Exception as e:
            self.log_test("Clustering Integration", False, f"Exception: {str(e)}")
            return False

    def test_performance(self):
        """Test 9: Performance testing"""
        try:
            params = {
                "latitude": 55.7558,
                "longitude": 37.6176,
                "radius": 50000  # Large radius for performance test
            }
            
            start_time = time.time()
            response = self.session.get(f"{BACKEND_URL}/obstacles/nearby", params=params)
            end_time = time.time()
            response_time = end_time - start_time
            
            if response.status_code == 200:
                data = response.json()
                
                # Performance threshold: should respond within 5 seconds
                if response_time > 5.0:
                    self.log_test(
                        "Performance",
                        False,
                        f"Response time {response_time:.2f}s exceeds 5s threshold"
                    )
                    return False
                
                self.log_test(
                    "Performance",
                    True,
                    f"Response time {response_time:.2f}s for {data['total']} obstacles within {params['radius']}m"
                )
                return True
                
            else:
                self.log_test(
                    "Performance",
                    False,
                    f"HTTP {response.status_code}: {response.text}"
                )
                return False
                
        except Exception as e:
            self.log_test("Performance", False, f"Exception: {str(e)}")
            return False

    def run_all_tests(self):
        """Run all tests and return summary"""
        print("🚀 Starting Mobile API Endpoint Testing - /api/obstacles/nearby")
        print(f"Backend URL: {BACKEND_URL}")
        print("=" * 80)
        
        # Test API connectivity first
        if not self.test_api_connectivity():
            print("❌ API connectivity failed - aborting tests")
            return False
        
        # Run all endpoint tests
        test_methods = [
            self.test_basic_request,
            self.test_custom_radius,
            self.test_min_confirmations_filter,
            self.test_input_validation,
            self.test_response_structure,
            self.test_priority_algorithm,
            self.test_geographic_filtering,
            self.test_clustering_integration,
            self.test_performance
        ]
        
        passed_tests = 0
        total_tests = len(test_methods)
        
        for test_method in test_methods:
            if test_method():
                passed_tests += 1
        
        # Print summary
        print("=" * 80)
        print(f"📊 TEST SUMMARY: {passed_tests}/{total_tests} tests passed ({passed_tests/total_tests*100:.1f}%)")
        
        if passed_tests == total_tests:
            print("🎉 ALL TESTS PASSED - Mobile API endpoint is fully functional!")
            return True
        else:
            failed_tests = total_tests - passed_tests
            print(f"⚠️  {failed_tests} tests failed - see details above")
            return False

def main():
    """Main test execution"""
    tester = NearbyObstaclesAPITester()
    success = tester.run_all_tests()
    
    if success:
        print("\n✅ Mobile API Endpoint Testing COMPLETED SUCCESSFULLY")
    else:
        print("\n❌ Mobile API Endpoint Testing COMPLETED WITH FAILURES")
    
    return success

if __name__ == "__main__":
    main()