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

# Backend URL from frontend/.env - using EXPO_PUBLIC_BACKEND_URL which should have the clusters
BACKEND_URL = "https://roadquality-app.preview.emergentagent.com/api"

class GoodRoadBackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'GoodRoadTester/1.0'
        })
        self.test_results = []
        self.total_tests = 0
        self.passed_tests = 0
        self.failed_tests = []
        
    def log_test(self, test_name, success, details="", response_data=None):
        """Log test results"""
        self.total_tests += 1
        if success:
            self.passed_tests += 1
        else:
            self.failed_tests.append(test_name)
        
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details,
            "response_data": response_data,
            "timestamp": datetime.now().isoformat()
        })
        
    def test_api_connectivity(self):
        """Test basic API connectivity"""
        try:
            response = self.session.get(f"{BACKEND_URL}/")
            if response.status_code == 200:
                data = response.json()
                mongodb_status = data.get('mongodb_connected', 'unknown')
                self.log_test("API Connectivity", True, 
                            f"API version: {data.get('version', 'unknown')}, MongoDB: {mongodb_status}")
                return True
            else:
                self.log_test("API Connectivity", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_test("API Connectivity", False, f"Connection error: {str(e)}")
            return False

    def test_clusters_endpoint(self):
        """Test GET /api/admin/v2/clusters endpoint - HIGH PRIORITY"""
        try:
            # Test with default parameters
            response = self.session.get(f"{BACKEND_URL}/admin/v2/clusters")
            
            if response.status_code == 200:
                data = response.json()
                
                # Check response structure
                if 'total' in data and 'clusters' in data:
                    cluster_count = data.get('total', 0)
                    clusters = data.get('clusters', [])
                    
                    self.log_test(
                        "Clusters Endpoint - Default Parameters", 
                        True, 
                        f"Found {cluster_count} clusters, returned {len(clusters)} clusters"
                    )
                    
                    # Test with limit parameter
                    response2 = self.session.get(f"{BACKEND_URL}/admin/v2/clusters?limit=10")
                    if response2.status_code == 200:
                        data2 = response2.json()
                        self.log_test(
                            "Clusters Endpoint - Limit Parameter", 
                            True, 
                            f"Limit=10 returned {len(data2.get('clusters', []))} clusters"
                        )
                    else:
                        self.log_test("Clusters Endpoint - Limit Parameter", False, f"HTTP {response2.status_code}")
                    
                    # Test with status filter
                    response3 = self.session.get(f"{BACKEND_URL}/admin/v2/clusters?status=active")
                    if response3.status_code == 200:
                        data3 = response3.json()
                        self.log_test(
                            "Clusters Endpoint - Status Filter", 
                            True, 
                            f"Status=active returned {len(data3.get('clusters', []))} clusters"
                        )
                    else:
                        self.log_test("Clusters Endpoint - Status Filter", False, f"HTTP {response3.status_code}")
                    
                    # Test expired status
                    response4 = self.session.get(f"{BACKEND_URL}/admin/v2/clusters?status=expired")
                    if response4.status_code == 200:
                        data4 = response4.json()
                        self.log_test(
                            "Clusters Endpoint - Expired Status", 
                            True, 
                            f"Status=expired returned {len(data4.get('clusters', []))} clusters"
                        )
                    else:
                        self.log_test("Clusters Endpoint - Expired Status", False, f"HTTP {response4.status_code}")
                    
                    return True
                else:
                    self.log_test("Clusters Endpoint - Default Parameters", False, f"Invalid response structure: {list(data.keys())}")
                    return False
            else:
                self.log_test("Clusters Endpoint - Default Parameters", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_test("Clusters Endpoint - Default Parameters", False, f"Error: {str(e)}")
            return False

    def test_analytics_v2_endpoint(self):
        """Test GET /api/admin/v2/analytics endpoint - MEDIUM PRIORITY"""
        try:
            response = self.session.get(f"{BACKEND_URL}/admin/v2/analytics")
            
            if response.status_code == 200:
                data = response.json()
                
                # Check required fields
                required_fields = ['summary']
                if all(field in data for field in required_fields):
                    summary = data.get('summary', {})
                    
                    # Check summary fields
                    summary_fields = ['raw_data_points', 'processed_events', 'active_warnings']
                    if all(field in summary for field in summary_fields):
                        self.log_test(
                            "Analytics V2 Endpoint", 
                            True, 
                            f"Raw data: {summary.get('raw_data_points')}, Events: {summary.get('processed_events')}, Warnings: {summary.get('active_warnings')}"
                        )
                        return True
                    else:
                        missing = [f for f in summary_fields if f not in summary]
                        self.log_test("Analytics V2 Endpoint", False, f"Missing summary fields: {missing}")
                        return False
                else:
                    missing = [f for f in required_fields if f not in data]
                    self.log_test("Analytics V2 Endpoint", False, f"Missing required fields: {missing}")
                    return False
            else:
                self.log_test("Analytics V2 Endpoint", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_test("Analytics V2 Endpoint", False, f"Error: {str(e)}")
            return False

    def test_web_admin_dashboard(self):
        """Test web admin dashboard accessibility - HIGH PRIORITY"""
        try:
            # Test the web admin dashboard URL
            dashboard_url = "https://roadquality-app.preview.emergentagent.com/admin/dashboard/v2"
            
            response = self.session.get(dashboard_url)
            
            if response.status_code == 200:
                content = response.text
                
                # Check for key elements that should be in the dashboard
                required_elements = [
                    'Leaflet',  # Map library
                    'clusters',  # Clusters functionality
                    'loadData',  # Data loading function
                    'switchViewMode'  # View mode switching
                ]
                
                found_elements = []
                missing_elements = []
                
                for element in required_elements:
                    if element.lower() in content.lower():
                        found_elements.append(element)
                    else:
                        missing_elements.append(element)
                
                if len(found_elements) >= 3:  # At least 3 out of 4 elements should be present
                    self.log_test(
                        "Web Admin Dashboard Accessibility", 
                        True, 
                        f"Dashboard loaded successfully. Found elements: {found_elements}"
                    )
                    return True
                else:
                    self.log_test(
                        "Web Admin Dashboard Accessibility", 
                        False, 
                        f"Dashboard missing key elements. Found: {found_elements}, Missing: {missing_elements}"
                    )
                    return False
            else:
                self.log_test("Web Admin Dashboard Accessibility", False, f"HTTP {response.status_code}: {response.text[:200]}")
                return False
                
        except Exception as e:
            self.log_test("Web Admin Dashboard Accessibility", False, f"Error: {str(e)}")
            return False

    def test_cors_configuration(self):
        """Test CORS configuration for web admin"""
        try:
            # Test CORS preflight request
            headers = {
                'Origin': 'https://roadquality-app.preview.emergentagent.com',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'Content-Type'
            }
            
            response = self.session.options(f"{BACKEND_URL}/admin/v2/clusters", headers=headers)
            
            if response.status_code in [200, 204]:
                cors_headers = {
                    'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
                    'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
                    'Access-Control-Allow-Headers': response.headers.get('Access-Control-Allow-Headers')
                }
                
                self.log_test(
                    "CORS Configuration", 
                    True, 
                    f"CORS headers present: {cors_headers}"
                )
                return True
            else:
                self.log_test("CORS Configuration", False, f"CORS preflight failed: HTTP {response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("CORS Configuration", False, f"Error: {str(e)}")
            return False

    def test_cluster_data_structure(self):
        """Test cluster data structure if clusters exist"""
        try:
            response = self.session.get(f"{BACKEND_URL}/admin/v2/clusters?limit=1")
            
            if response.status_code == 200:
                data = response.json()
                clusters = data.get('clusters', [])
                
                if clusters:
                    cluster = clusters[0]
                    
                    # Expected cluster fields
                    expected_fields = [
                        'clusterId', 'obstacleType', 'location', 'severity',
                        'confidence', 'reportCount', 'devices', 'firstReported',
                        'lastReported', 'status'
                    ]
                    
                    present_fields = []
                    missing_fields = []
                    
                    for field in expected_fields:
                        if field in cluster:
                            present_fields.append(field)
                        else:
                            missing_fields.append(field)
                    
                    if len(present_fields) >= 7:  # At least 7 out of 10 fields should be present
                        self.log_test(
                            "Cluster Data Structure", 
                            True, 
                            f"Cluster structure valid. Present: {present_fields}"
                        )
                        return True
                    else:
                        self.log_test(
                            "Cluster Data Structure", 
                            False, 
                            f"Invalid cluster structure. Missing: {missing_fields}"
                        )
                        return False
                else:
                    self.log_test(
                        "Cluster Data Structure", 
                        True, 
                        "No clusters found - this is expected if no events have been processed yet"
                    )
                    return True
            else:
                self.log_test("Cluster Data Structure", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_test("Cluster Data Structure", False, f"Error: {str(e)}")
            return False

    def test_obstacle_clusterer_initialization(self):
        """Test if obstacle clusterer is properly initialized - LOW PRIORITY"""
        try:
            # Try to access clusters endpoint to see if clusterer is working
            response = self.session.get(f"{BACKEND_URL}/admin/v2/clusters")
            
            if response.status_code == 200:
                self.log_test(
                    "Obstacle Clusterer Initialization", 
                    True, 
                    "Clusterer appears to be initialized (clusters endpoint accessible)"
                )
                return True
            elif response.status_code == 503:
                # Service unavailable might indicate clusterer not initialized
                self.log_test(
                    "Obstacle Clusterer Initialization", 
                    False, 
                    "Clusterer not initialized (HTTP 503)"
                )
                return False
            else:
                self.log_test(
                    "Obstacle Clusterer Initialization", 
                    False, 
                    f"Unexpected response: HTTP {response.status_code}"
                )
                return False
                
        except Exception as e:
            self.log_test("Obstacle Clusterer Initialization", False, f"Error: {str(e)}")
            return False

    def test_processed_events_data(self):
        """Test if there are processed events for clustering"""
        try:
            response = self.session.get(f"{BACKEND_URL}/admin/v2/events?limit=5")
            
            if response.status_code == 200:
                data = response.json()
                events = data.get('events', [])
                total = data.get('total', 0)
                
                self.log_test(
                    "Processed Events Data", 
                    True, 
                    f"Found {total} processed events, returned {len(events)} events"
                )
                return True
            else:
                self.log_test("Processed Events Data", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_test("Processed Events Data", False, f"Error: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all backend tests for Phase 1 Clusters"""
        print("🚀 Starting Good Road App Backend Testing - Phase 1 Clusters")
        print(f"Backend URL: {BACKEND_URL}")
        print("=" * 80)
        
        # Test in priority order
        tests = [
            # HIGH PRIORITY
            ("API Connectivity", self.test_api_connectivity),
            ("Clusters Endpoint", self.test_clusters_endpoint),
            ("Web Admin Dashboard", self.test_web_admin_dashboard),
            ("CORS Configuration", self.test_cors_configuration),
            
            # MEDIUM PRIORITY  
            ("Analytics V2 Endpoint", self.test_analytics_v2_endpoint),
            ("Cluster Data Structure", self.test_cluster_data_structure),
            ("Processed Events Data", self.test_processed_events_data),
            
            # LOW PRIORITY
            ("Obstacle Clusterer", self.test_obstacle_clusterer_initialization),
        ]
        
        passed = 0
        total = len(tests)
        
        for test_name, test_func in tests:
            try:
                if test_func():
                    passed += 1
            except Exception as e:
                self.log_test(f"{test_name} (Exception)", False, f"Unexpected error: {str(e)}")
        
        print("=" * 80)
        print(f"🎯 TESTING COMPLETE: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
        
        if self.failed_tests:
            print(f"❌ FAILED TESTS ({len(self.failed_tests)}):")
            for test in self.failed_tests:
                print(f"   - {test}")
        else:
            print("✅ ALL TESTS PASSED!")
        
        return passed, total, self.test_results

if __name__ == "__main__":
    tester = GoodRoadBackendTester()
    passed, total, results = tester.run_all_tests()
    
    # Exit with error code if tests failed
    if passed < total:
        sys.exit(1)
    else:
        sys.exit(0)
