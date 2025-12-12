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
BACKEND_URL = "https://bumpspotter.preview.emergentagent.com/api"

class BackendTester:
    def __init__(self):
        self.session = None
        self.test_results = []
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    def log_test(self, test_name: str, success: bool, details: str = ""):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })
    
    async def test_api_connectivity(self) -> bool:
        """Test basic API connectivity"""
        try:
            async with self.session.get(f"{BACKEND_URL}/") as response:
                if response.status == 200:
                    data = await response.json()
                    version = data.get("version", "unknown")
                    mongodb_connected = data.get("mongodb_connected", False)
                    
                    self.log_test(
                        "API Connectivity", 
                        True, 
                        f"Version: {version}, MongoDB: {mongodb_connected}"
                    )
                    return True
                else:
                    self.log_test("API Connectivity", False, f"HTTP {response.status}")
                    return False
        except Exception as e:
            self.log_test("API Connectivity", False, str(e))
            return False
    
    def create_accelerometer_data(self, pattern_type: str, speed_kmh: float) -> List[Dict]:
        """
        Create realistic accelerometer data for different patterns
        
        Args:
            pattern_type: 'speed_bump', 'pothole', 'vibration', 'bump'
            speed_kmh: Speed in km/h
        """
        speed_ms = speed_kmh / 3.6  # Convert to m/s
        base_timestamp = int(time.time() * 1000)
        
        # Base accelerometer values (phone at ~63° angle)
        base_x = 0.1
        base_y = 0.2
        base_z = 0.44  # Baseline from real data
        
        data_points = []
        
        if pattern_type == "speed_bump":
            # Wave pattern: smooth rise → peak → smooth fall
            for i in range(20):
                t = i / 19.0  # 0 to 1
                # Smooth wave using sine function
                wave = math.sin(t * math.pi) * 0.3  # Amplitude 0.3
                
                data_points.append({
                    "x": base_x + random.uniform(-0.05, 0.05),
                    "y": base_y + wave * 0.5,  # Longitudinal component
                    "z": base_z + wave,        # Main vertical component
                    "timestamp": base_timestamp + i * 50  # 50ms intervals
                })
        
        elif pattern_type == "pothole":
            # Impact pattern: sharp spike up → quick drop down
            for i in range(20):
                if i < 5:
                    # Normal baseline
                    spike = 0
                elif i < 8:
                    # Sharp rise (impact)
                    spike = (i - 5) * 0.15  # Quick rise
                elif i < 12:
                    # Sharp fall (drop into hole)
                    spike = 0.45 - (i - 8) * 0.2  # Quick fall
                else:
                    # Return to baseline
                    spike = max(0, 0.05 - (i - 12) * 0.01)
                
                data_points.append({
                    "x": base_x + random.uniform(-0.08, 0.08),
                    "y": base_y + spike * 0.7,  # Strong longitudinal impact
                    "z": base_z + spike,        # Strong vertical impact
                    "timestamp": base_timestamp + i * 50
                })
        
        elif pattern_type == "vibration":
            # High-frequency oscillations
            for i in range(30):
                # High frequency noise
                freq_noise = math.sin(i * 0.8) * 0.1 + random.uniform(-0.05, 0.05)
                
                data_points.append({
                    "x": base_x + freq_noise,
                    "y": base_y + freq_noise * 0.8,
                    "z": base_z + freq_noise,
                    "timestamp": base_timestamp + i * 33  # ~30Hz
                })
        
        elif pattern_type == "bump":
            # Small deviation - minor road irregularity
            for i in range(15):
                if 5 <= i <= 9:
                    # Small bump
                    bump = (i - 7) * 0.05 if i <= 7 else (9 - i) * 0.05
                else:
                    bump = 0
                
                data_points.append({
                    "x": base_x + random.uniform(-0.03, 0.03),
                    "y": base_y + bump * 0.3,
                    "z": base_z + bump,
                    "timestamp": base_timestamp + i * 50
                })
        
        return data_points
    
    def create_raw_data_batch(self, device_id: str, lat: float, lng: float, 
                             pattern_type: str, speed_kmh: float) -> Dict:
        """Create a raw data batch for testing"""
        accel_data = self.create_accelerometer_data(pattern_type, speed_kmh)
        
        return {
            "deviceId": device_id,
            "data": [{
                "deviceId": device_id,  # Each data item needs deviceId
                "timestamp": int(time.time() * 1000),
                "gps": {
                    "latitude": lat,
                    "longitude": lng,
                    "speed": speed_kmh / 3.6,  # m/s
                    "accuracy": 5.0,
                    "altitude": 100.0
                },
                "accelerometer": accel_data
            }]
        }
    
    async def test_ml_classification_speed_bump(self) -> bool:
        """Test speed bump classification (30 km/h, wave pattern)"""
        try:
            # Moscow coordinates
            lat, lng = 55.7558, 37.6176
            batch = self.create_raw_data_batch(
                "test_device_speed_bump", lat, lng, "speed_bump", 30.0
            )
            
            async with self.session.post(
                f"{BACKEND_URL}/raw-data",
                json=batch,
                headers={"Content-Type": "application/json"}
            ) as response:
                
                if response.status == 200:
                    data = await response.json()
                    events_detected = data.get("eventsDetected", 0)
                    
                    if events_detected > 0:
                        # Check if event was classified correctly
                        # We'll check the processed_events collection via analytics
                        await asyncio.sleep(1)  # Allow processing
                        
                        async with self.session.get(f"{BACKEND_URL}/admin/v2/events?limit=1") as events_response:
                            if events_response.status == 200:
                                events_data = await events_response.json()
                                events = events_data.get("events", [])
                                
                                if events and events[0].get("eventType") == "speed_bump":
                                    self.log_test(
                                        "ML Classification - Speed Bump",
                                        True,
                                        f"Correctly classified as speed_bump (30 km/h, wave pattern)"
                                    )
                                    return True
                                else:
                                    event_type = events[0].get("eventType", "none") if events else "none"
                                    self.log_test(
                                        "ML Classification - Speed Bump",
                                        False,
                                        f"Incorrectly classified as {event_type}, expected speed_bump"
                                    )
                                    return False
                    else:
                        self.log_test(
                            "ML Classification - Speed Bump",
                            False,
                            "No events detected for speed bump pattern"
                        )
                        return False
                else:
                    self.log_test(
                        "ML Classification - Speed Bump",
                        False,
                        f"HTTP {response.status}"
                    )
                    return False
                    
        except Exception as e:
            self.log_test("ML Classification - Speed Bump", False, str(e))
            return False
    
    async def test_ml_classification_pothole(self) -> bool:
        """Test pothole classification (60 km/h, impact pattern)"""
        try:
            lat, lng = 55.7560, 37.6178
            batch = self.create_raw_data_batch(
                "test_device_pothole", lat, lng, "pothole", 60.0
            )
            
            async with self.session.post(
                f"{BACKEND_URL}/raw-data",
                json=batch,
                headers={"Content-Type": "application/json"}
            ) as response:
                
                if response.status == 200:
                    data = await response.json()
                    events_detected = data.get("eventsDetected", 0)
                    
                    if events_detected > 0:
                        await asyncio.sleep(1)
                        
                        async with self.session.get(f"{BACKEND_URL}/admin/v2/events?limit=1") as events_response:
                            if events_response.status == 200:
                                events_data = await events_response.json()
                                events = events_data.get("events", [])
                                
                                if events and events[0].get("eventType") == "pothole":
                                    self.log_test(
                                        "ML Classification - Pothole",
                                        True,
                                        f"Correctly classified as pothole (60 km/h, impact pattern)"
                                    )
                                    return True
                                else:
                                    event_type = events[0].get("eventType", "none") if events else "none"
                                    self.log_test(
                                        "ML Classification - Pothole",
                                        False,
                                        f"Incorrectly classified as {event_type}, expected pothole"
                                    )
                                    return False
                    else:
                        self.log_test(
                            "ML Classification - Pothole",
                            False,
                            "No events detected for pothole pattern"
                        )
                        return False
                        
        except Exception as e:
            self.log_test("ML Classification - Pothole", False, str(e))
            return False
    
    async def test_ml_classification_vibration(self) -> bool:
        """Test vibration classification (40 km/h, high frequency)"""
        try:
            lat, lng = 55.7562, 37.6180
            batch = self.create_raw_data_batch(
                "test_device_vibration", lat, lng, "vibration", 40.0
            )
            
            async with self.session.post(
                f"{BACKEND_URL}/raw-data",
                json=batch,
                headers={"Content-Type": "application/json"}
            ) as response:
                
                if response.status == 200:
                    data = await response.json()
                    events_detected = data.get("eventsDetected", 0)
                    
                    if events_detected > 0:
                        await asyncio.sleep(1)
                        
                        async with self.session.get(f"{BACKEND_URL}/admin/v2/events?limit=1") as events_response:
                            if events_response.status == 200:
                                events_data = await events_response.json()
                                events = events_data.get("events", [])
                                
                                if events and events[0].get("eventType") == "vibration":
                                    self.log_test(
                                        "ML Classification - Vibration",
                                        True,
                                        f"Correctly classified as vibration (40 km/h, high frequency)"
                                    )
                                    return True
                                else:
                                    event_type = events[0].get("eventType", "none") if events else "none"
                                    self.log_test(
                                        "ML Classification - Vibration",
                                        False,
                                        f"Incorrectly classified as {event_type}, expected vibration"
                                    )
                                    return False
                    else:
                        self.log_test(
                            "ML Classification - Vibration",
                            False,
                            "No events detected for vibration pattern"
                        )
                        return False
                        
        except Exception as e:
            self.log_test("ML Classification - Vibration", False, str(e))
            return False
    
    async def test_ml_classification_bump(self) -> bool:
        """Test bump classification (any speed, small deviation)"""
        try:
            lat, lng = 55.7564, 37.6182
            batch = self.create_raw_data_batch(
                "test_device_bump", lat, lng, "bump", 25.0
            )
            
            async with self.session.post(
                f"{BACKEND_URL}/raw-data",
                json=batch,
                headers={"Content-Type": "application/json"}
            ) as response:
                
                if response.status == 200:
                    data = await response.json()
                    events_detected = data.get("eventsDetected", 0)
                    
                    if events_detected > 0:
                        await asyncio.sleep(1)
                        
                        async with self.session.get(f"{BACKEND_URL}/admin/v2/events?limit=1") as events_response:
                            if events_response.status == 200:
                                events_data = await events_response.json()
                                events = events_data.get("events", [])
                                
                                if events and events[0].get("eventType") == "bump":
                                    self.log_test(
                                        "ML Classification - Bump",
                                        True,
                                        f"Correctly classified as bump (25 km/h, small deviation)"
                                    )
                                    return True
                                else:
                                    event_type = events[0].get("eventType", "none") if events else "none"
                                    self.log_test(
                                        "ML Classification - Bump",
                                        False,
                                        f"Incorrectly classified as {event_type}, expected bump"
                                    )
                                    return False
                    else:
                        self.log_test(
                            "ML Classification - Bump",
                            False,
                            "No events detected for bump pattern"
                        )
                        return False
                        
        except Exception as e:
            self.log_test("ML Classification - Bump", False, str(e))
            return False
    
    async def test_clustering_single_cluster(self) -> bool:
        """Test that 3+ events within 7 meters create ONE cluster"""
        try:
            # Create 4 events within 7 meters of each other
            base_lat, base_lng = 55.7570, 37.6190
            
            # Events within ~5 meters of each other
            events = [
                (base_lat, base_lng),
                (base_lat + 0.00003, base_lng + 0.00002),  # ~3m away
                (base_lat - 0.00002, base_lng + 0.00003),  # ~4m away
                (base_lat + 0.00001, base_lng - 0.00002),  # ~2m away
            ]
            
            # Send all events
            for i, (lat, lng) in enumerate(events):
                batch = self.create_raw_data_batch(
                    f"cluster_test_device_{i}", lat, lng, "pothole", 50.0
                )
                
                async with self.session.post(
                    f"{BACKEND_URL}/raw-data",
                    json=batch,
                    headers={"Content-Type": "application/json"}
                ) as response:
                    if response.status != 200:
                        self.log_test(
                            "Clustering - Single Cluster",
                            False,
                            f"Failed to send event {i}: HTTP {response.status}"
                        )
                        return False
            
            # Wait for clustering
            await asyncio.sleep(2)
            
            # Check clusters
            async with self.session.get(f"{BACKEND_URL}/admin/v2/clusters") as response:
                if response.status == 200:
                    data = await response.json()
                    clusters = data.get("clusters", [])
                    
                    # Find clusters near our test location
                    nearby_clusters = []
                    for cluster in clusters:
                        cluster_lat = cluster["location"]["latitude"]
                        cluster_lng = cluster["location"]["longitude"]
                        
                        # Check if cluster is near our test area
                        if (abs(cluster_lat - base_lat) < 0.0001 and 
                            abs(cluster_lng - base_lng) < 0.0001):
                            nearby_clusters.append(cluster)
                    
                    if len(nearby_clusters) == 1:
                        cluster = nearby_clusters[0]
                        report_count = cluster.get("reportCount", 0)
                        
                        if report_count >= 3:
                            self.log_test(
                                "Clustering - Single Cluster",
                                True,
                                f"Created 1 cluster with {report_count} reports (expected ≥3)"
                            )
                            return True
                        else:
                            self.log_test(
                                "Clustering - Single Cluster",
                                False,
                                f"Cluster has only {report_count} reports, expected ≥3"
                            )
                            return False
                    else:
                        self.log_test(
                            "Clustering - Single Cluster",
                            False,
                            f"Created {len(nearby_clusters)} clusters, expected 1"
                        )
                        return False
                else:
                    self.log_test(
                        "Clustering - Single Cluster",
                        False,
                        f"Failed to get clusters: HTTP {response.status}"
                    )
                    return False
                    
        except Exception as e:
            self.log_test("Clustering - Single Cluster", False, str(e))
            return False
    
    async def test_clustering_separate_clusters(self) -> bool:
        """Test that 2 events 20 meters apart create TWO separate clusters"""
        try:
            # Create 2 events 20+ meters apart
            lat1, lng1 = 55.7580, 37.6200
            lat2, lng2 = 55.7582, 37.6202  # ~20+ meters away
            
            # Send first event
            batch1 = self.create_raw_data_batch(
                "separate_test_device_1", lat1, lng1, "speed_bump", 30.0
            )
            
            async with self.session.post(
                f"{BACKEND_URL}/raw-data",
                json=batch1,
                headers={"Content-Type": "application/json"}
            ) as response:
                if response.status != 200:
                    self.log_test(
                        "Clustering - Separate Clusters",
                        False,
                        f"Failed to send first event: HTTP {response.status}"
                    )
                    return False
            
            # Send second event
            batch2 = self.create_raw_data_batch(
                "separate_test_device_2", lat2, lng2, "speed_bump", 30.0
            )
            
            async with self.session.post(
                f"{BACKEND_URL}/raw-data",
                json=batch2,
                headers={"Content-Type": "application/json"}
            ) as response:
                if response.status != 200:
                    self.log_test(
                        "Clustering - Separate Clusters",
                        False,
                        f"Failed to send second event: HTTP {response.status}"
                    )
                    return False
            
            # Wait for clustering
            await asyncio.sleep(2)
            
            # Check clusters
            async with self.session.get(f"{BACKEND_URL}/admin/v2/clusters") as response:
                if response.status == 200:
                    data = await response.json()
                    clusters = data.get("clusters", [])
                    
                    # Find clusters near our test locations
                    nearby_clusters = []
                    for cluster in clusters:
                        cluster_lat = cluster["location"]["latitude"]
                        cluster_lng = cluster["location"]["longitude"]
                        
                        # Check if cluster is near either test location
                        near_first = (abs(cluster_lat - lat1) < 0.0001 and 
                                     abs(cluster_lng - lng1) < 0.0001)
                        near_second = (abs(cluster_lat - lat2) < 0.0001 and 
                                      abs(cluster_lng - lng2) < 0.0001)
                        
                        if near_first or near_second:
                            nearby_clusters.append(cluster)
                    
                    if len(nearby_clusters) >= 2:
                        self.log_test(
                            "Clustering - Separate Clusters",
                            True,
                            f"Created {len(nearby_clusters)} separate clusters (expected ≥2)"
                        )
                        return True
                    else:
                        self.log_test(
                            "Clustering - Separate Clusters",
                            False,
                            f"Created only {len(nearby_clusters)} clusters, expected ≥2"
                        )
                        return False
                else:
                    self.log_test(
                        "Clustering - Separate Clusters",
                        False,
                        f"Failed to get clusters: HTTP {response.status}"
                    )
                    return False
                    
        except Exception as e:
            self.log_test("Clustering - Separate Clusters", False, str(e))
            return False
    
    async def test_min_confirmations_filter(self) -> bool:
        """Test min_confirmations=3 filter in nearby obstacles API"""
        try:
            # Use Moscow coordinates
            lat, lng = 55.7558, 37.6176
            
            # Test with min_confirmations=3
            async with self.session.get(
                f"{BACKEND_URL}/obstacles/nearby?latitude={lat}&longitude={lng}&min_confirmations=3"
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    obstacles = data.get("obstacles", [])
                    min_confirmations = data.get("minConfirmations", 0)
                    
                    # Verify all obstacles have ≥3 confirmations
                    all_confirmed = all(
                        obstacle.get("confirmations", 0) >= 3 
                        for obstacle in obstacles
                    )
                    
                    if min_confirmations == 3 and all_confirmed:
                        self.log_test(
                            "Min Confirmations Filter",
                            True,
                            f"Filter working: {len(obstacles)} obstacles with ≥3 confirmations"
                        )
                        return True
                    else:
                        self.log_test(
                            "Min Confirmations Filter",
                            False,
                            f"Filter not working properly: minConfirmations={min_confirmations}"
                        )
                        return False
                else:
                    self.log_test(
                        "Min Confirmations Filter",
                        False,
                        f"HTTP {response.status}"
                    )
                    return False
                    
        except Exception as e:
            self.log_test("Min Confirmations Filter", False, str(e))
            return False
    
    async def test_analytics_v2_endpoint(self) -> bool:
        """Test GET /api/admin/v2/analytics endpoint"""
        try:
            async with self.session.get(f"{BACKEND_URL}/admin/v2/analytics") as response:
                if response.status == 200:
                    data = await response.json()
                    summary = data.get("summary", {})
                    
                    required_fields = ["raw_data_points", "processed_events", "active_warnings"]
                    missing_fields = [field for field in required_fields if field not in summary]
                    
                    if not missing_fields:
                        raw_points = summary["raw_data_points"]
                        processed_events = summary["processed_events"]
                        
                        self.log_test(
                            "Analytics V2 Endpoint",
                            True,
                            f"Raw data: {raw_points}, Processed events: {processed_events}"
                        )
                        return True
                    else:
                        self.log_test(
                            "Analytics V2 Endpoint",
                            False,
                            f"Missing fields: {missing_fields}"
                        )
                        return False
                else:
                    self.log_test(
                        "Analytics V2 Endpoint",
                        False,
                        f"HTTP {response.status}"
                    )
                    return False
                    
        except Exception as e:
            self.log_test("Analytics V2 Endpoint", False, str(e))
            return False
    
    async def test_clusters_v2_endpoint(self) -> bool:
        """Test GET /api/admin/v2/clusters endpoint"""
        try:
            async with self.session.get(f"{BACKEND_URL}/admin/v2/clusters") as response:
                if response.status == 200:
                    data = await response.json()
                    
                    required_fields = ["total", "clusters"]
                    missing_fields = [field for field in required_fields if field not in data]
                    
                    if not missing_fields:
                        total = data["total"]
                        clusters = data["clusters"]
                        
                        # Verify cluster structure
                        if clusters:
                            cluster = clusters[0]
                            cluster_fields = ["clusterId", "obstacleType", "location", "reportCount", "confidence"]
                            missing_cluster_fields = [field for field in cluster_fields if field not in cluster]
                            
                            if not missing_cluster_fields:
                                self.log_test(
                                    "Clusters V2 Endpoint",
                                    True,
                                    f"Total clusters: {total}, Structure verified"
                                )
                                return True
                            else:
                                self.log_test(
                                    "Clusters V2 Endpoint",
                                    False,
                                    f"Missing cluster fields: {missing_cluster_fields}"
                                )
                                return False
                        else:
                            self.log_test(
                                "Clusters V2 Endpoint",
                                True,
                                f"Total clusters: {total} (empty result is valid)"
                            )
                            return True
                    else:
                        self.log_test(
                            "Clusters V2 Endpoint",
                            False,
                            f"Missing fields: {missing_fields}"
                        )
                        return False
                else:
                    self.log_test(
                        "Clusters V2 Endpoint",
                        False,
                        f"HTTP {response.status}"
                    )
                    return False
                    
        except Exception as e:
            self.log_test("Clusters V2 Endpoint", False, str(e))
            return False
    
    async def test_recalculate_clusters_endpoint(self) -> bool:
        """Test POST /api/admin/recalculate-clusters endpoint"""
        try:
            async with self.session.post(f"{BACKEND_URL}/admin/recalculate-clusters") as response:
                if response.status == 200:
                    data = await response.json()
                    
                    required_fields = ["success", "processed_events", "final_clusters"]
                    missing_fields = [field for field in required_fields if field not in data]
                    
                    if not missing_fields:
                        success = data["success"]
                        processed_events = data["processed_events"]
                        final_clusters = data["final_clusters"]
                        
                        if success:
                            self.log_test(
                                "Recalculate Clusters Endpoint",
                                True,
                                f"Processed {processed_events} events, created {final_clusters} clusters"
                            )
                            return True
                        else:
                            self.log_test(
                                "Recalculate Clusters Endpoint",
                                False,
                                "Operation reported failure"
                            )
                            return False
                    else:
                        self.log_test(
                            "Recalculate Clusters Endpoint",
                            False,
                            f"Missing fields: {missing_fields}"
                        )
                        return False
                else:
                    self.log_test(
                        "Recalculate Clusters Endpoint",
                        False,
                        f"HTTP {response.status}"
                    )
                    return False
                    
        except Exception as e:
            self.log_test("Recalculate Clusters Endpoint", False, str(e))
            return False
    
    async def test_performance_bulk_events(self) -> bool:
        """Test processing 50+ events in <5 seconds"""
        try:
            start_time = time.time()
            
            # Create 50 events with different patterns
            base_lat, base_lng = 55.7600, 37.6300
            
            tasks = []
            for i in range(50):
                # Vary location slightly
                lat = base_lat + (i % 10) * 0.0001
                lng = base_lng + (i % 10) * 0.0001
                
                # Vary pattern types
                patterns = ["pothole", "speed_bump", "bump", "vibration"]
                pattern = patterns[i % 4]
                speed = 30 + (i % 3) * 15  # 30, 45, 60 km/h
                
                batch = self.create_raw_data_batch(
                    f"perf_test_device_{i}", lat, lng, pattern, speed
                )
                
                # Create task for concurrent execution
                task = self.session.post(
                    f"{BACKEND_URL}/raw-data",
                    json=batch,
                    headers={"Content-Type": "application/json"}
                )
                tasks.append(task)
            
            # Execute all requests concurrently
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Check responses
            successful = 0
            for response in responses:
                if not isinstance(response, Exception):
                    if response.status == 200:
                        successful += 1
                    response.close()
            
            end_time = time.time()
            duration = end_time - start_time
            
            if successful >= 45 and duration < 5.0:  # Allow 90% success rate
                self.log_test(
                    "Performance - Bulk Events",
                    True,
                    f"Processed {successful}/50 events in {duration:.2f}s (target: <5s)"
                )
                return True
            else:
                self.log_test(
                    "Performance - Bulk Events",
                    False,
                    f"Only {successful}/50 events successful in {duration:.2f}s"
                )
                return False
                
        except Exception as e:
            self.log_test("Performance - Bulk Events", False, str(e))
            return False
    
    async def run_all_tests(self):
        """Run all test scenarios"""
        print("🚀 Starting ML Classification and Clustering Tests")
        print(f"Backend URL: {BACKEND_URL}")
        print("=" * 60)
        
        # Test sequence
        tests = [
            ("API Connectivity", self.test_api_connectivity),
            ("ML Classification - Speed Bump", self.test_ml_classification_speed_bump),
            ("ML Classification - Pothole", self.test_ml_classification_pothole),
            ("ML Classification - Vibration", self.test_ml_classification_vibration),
            ("ML Classification - Bump", self.test_ml_classification_bump),
            ("Clustering - Single Cluster", self.test_clustering_single_cluster),
            ("Clustering - Separate Clusters", self.test_clustering_separate_clusters),
            ("Min Confirmations Filter", self.test_min_confirmations_filter),
            ("Analytics V2 Endpoint", self.test_analytics_v2_endpoint),
            ("Clusters V2 Endpoint", self.test_clusters_v2_endpoint),
            ("Recalculate Clusters Endpoint", self.test_recalculate_clusters_endpoint),
            ("Performance - Bulk Events", self.test_performance_bulk_events),
        ]
        
        for test_name, test_func in tests:
            try:
                await test_func()
            except Exception as e:
                self.log_test(test_name, False, f"Exception: {str(e)}")
            
            # Small delay between tests
            await asyncio.sleep(0.5)
        
        # Summary
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results if result["success"])
        failed_tests = total_tests - passed_tests
        
        print(f"Total Tests: {total_tests}")
        print(f"✅ Passed: {passed_tests}")
        print(f"❌ Failed: {failed_tests}")
        print(f"Success Rate: {(passed_tests/total_tests)*100:.1f}%")
        
        if failed_tests > 0:
            print("\n🔍 FAILED TESTS:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"   ❌ {result['test']}: {result['details']}")
        
        return passed_tests, failed_tests


async def main():
    """Main test runner"""
    async with BackendTester() as tester:
        passed, failed = await tester.run_all_tests()
        
        # Exit with appropriate code
        if failed == 0:
            print("\n🎉 All tests passed!")
            return 0
        else:
            print(f"\n⚠️ {failed} tests failed!")
            return 1


if __name__ == "__main__":
    import sys
    exit_code = asyncio.run(main())
    sys.exit(exit_code)