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

def test_database_activity_analysis():
    """
    Comprehensive analysis of database activity patterns
    Focus: When was the database last populated with data points
    """
    print("🔍 GOOD ROAD DATABASE ACTIVITY ANALYSIS")
    print("=" * 60)
    print(f"Backend URL: {API_BASE}")
    print()
    
    results = {
        "last_record_analysis": None,
        "recent_activity": None,
        "activity_patterns": None,
        "summary": None
    }
    
    try:
        # 1. GET /api/admin/sensor-data?limit=10 - Get last 10 records
        print("📊 STEP 1: Analyzing Last 10 Database Records")
        print("-" * 50)
        
        response = requests.get(f"{API_BASE}/admin/sensor-data?limit=10")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            sensor_data = response.json()
            records = sensor_data.get('data', [])
            total_records = sensor_data.get('total', 0)
            
            print(f"✅ Successfully retrieved {len(records)} records out of {total_records} total")
            
            if records:
                # Analyze timestamps of each record
                print("\n📅 TIMESTAMP ANALYSIS OF LAST 10 RECORDS:")
                timestamps = []
                
                for i, record in enumerate(records, 1):
                    timestamp_str = record.get('timestamp', '')
                    try:
                        # Parse ISO timestamp
                        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                        timestamps.append(timestamp)
                        
                        # Show GPS coordinates to verify data quality
                        lat = record.get('latitude', 0)
                        lng = record.get('longitude', 0)
                        gps_status = "✅ Valid GPS" if (lat != 0 and lng != 0) else "❌ Zero GPS"
                        
                        print(f"  {i:2d}. {timestamp.strftime('%Y-%m-%d %H:%M:%S UTC')} | {gps_status} | ({lat:.4f}, {lng:.4f})")
                        
                    except Exception as e:
                        print(f"  {i:2d}. Invalid timestamp: {timestamp_str} | Error: {e}")
                
                # Find the most recent record
                if timestamps:
                    most_recent = max(timestamps)
                    oldest_in_sample = min(timestamps)
                    
                    print(f"\n🕐 MOST RECENT RECORD: {most_recent.strftime('%Y-%m-%d %H:%M:%S UTC')}")
                    print(f"🕐 OLDEST IN SAMPLE: {oldest_in_sample.strftime('%Y-%m-%d %H:%M:%S UTC')}")
                    
                    # Calculate time since last update
                    now = datetime.now(most_recent.tzinfo) if most_recent.tzinfo else datetime.utcnow()
                    time_since_last = now - most_recent
                    
                    print(f"⏰ TIME SINCE LAST UPDATE: {time_since_last}")
                    
                    results["last_record_analysis"] = {
                        "most_recent_timestamp": most_recent.isoformat(),
                        "time_since_last_update": str(time_since_last),
                        "total_records_in_db": total_records,
                        "sample_size": len(records)
                    }
                else:
                    print("❌ No valid timestamps found in records")
            else:
                print("❌ No records found in database")
                
        else:
            print(f"❌ Failed to get sensor data: {response.status_code}")
            print(f"Response: {response.text}")
        
        print("\n" + "=" * 60)
        
        # 2. GET /api/admin/analytics - Check general statistics
        print("📈 STEP 2: Analyzing Database Statistics & Recent Activity")
        print("-" * 50)
        
        response = requests.get(f"{API_BASE}/admin/analytics")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            analytics = response.json()
            
            total_points = analytics.get('total_points', 0)
            recent_points_7d = analytics.get('recent_points_7d', 0)
            verified_points = analytics.get('verified_points', 0)
            hazard_points = analytics.get('hazard_points', 0)
            avg_road_quality = analytics.get('avg_road_quality', 0)
            
            print(f"✅ Successfully retrieved analytics data")
            print(f"\n📊 DATABASE STATISTICS:")
            print(f"  • Total Points: {total_points}")
            print(f"  • Recent Points (7 days): {recent_points_7d}")
            print(f"  • Verified Points: {verified_points}")
            print(f"  • Hazard Points: {hazard_points}")
            print(f"  • Average Road Quality: {avg_road_quality}/100")
            
            # Calculate activity rate
            if total_points > 0:
                recent_percentage = (recent_points_7d / total_points) * 100
                print(f"  • Recent Activity Rate: {recent_percentage:.1f}% of total data")
            
            # Analyze hazard distribution
            hazard_dist = analytics.get('hazard_distribution', [])
            if hazard_dist:
                print(f"\n🚨 HAZARD DISTRIBUTION:")
                for hazard in hazard_dist:
                    hazard_type = hazard.get('hazard_type', 'Unknown')
                    count = hazard.get('count', 0)
                    print(f"  • {hazard_type}: {count} incidents")
            
            # Analyze quality distribution
            quality_dist = analytics.get('quality_distribution', [])
            if quality_dist:
                print(f"\n🛣️  ROAD QUALITY DISTRIBUTION:")
                for quality in quality_dist:
                    range_name = quality.get('range', 'Unknown')
                    count = quality.get('count', 0)
                    min_val = quality.get('min', 0)
                    max_val = quality.get('max', 0)
                    print(f"  • {range_name} ({min_val}-{max_val}): {count} records")
            
            results["recent_activity"] = {
                "total_points": total_points,
                "recent_points_7d": recent_points_7d,
                "recent_activity_percentage": (recent_points_7d / total_points * 100) if total_points > 0 else 0,
                "verified_points": verified_points,
                "hazard_points": hazard_points,
                "avg_road_quality": avg_road_quality
            }
            
        else:
            print(f"❌ Failed to get analytics: {response.status_code}")
            print(f"Response: {response.text}")
        
        print("\n" + "=" * 60)
        
        # 3. Analyze activity patterns by getting more historical data
        print("📋 STEP 3: Analyzing Activity Patterns & Time Gaps")
        print("-" * 50)
        
        # Get larger sample to analyze patterns
        response = requests.get(f"{API_BASE}/admin/sensor-data?limit=50")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            sensor_data = response.json()
            records = sensor_data.get('data', [])
            
            print(f"✅ Retrieved {len(records)} records for pattern analysis")
            
            if len(records) > 1:
                # Parse all timestamps
                valid_timestamps = []
                for record in records:
                    timestamp_str = record.get('timestamp', '')
                    try:
                        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                        valid_timestamps.append(timestamp)
                    except:
                        continue
                
                if len(valid_timestamps) > 1:
                    # Sort timestamps (should already be sorted, but ensure)
                    valid_timestamps.sort(reverse=True)  # Most recent first
                    
                    # Calculate time gaps between consecutive records
                    time_gaps = []
                    for i in range(len(valid_timestamps) - 1):
                        gap = valid_timestamps[i] - valid_timestamps[i + 1]
                        time_gaps.append(gap)
                    
                    # Analyze patterns
                    if time_gaps:
                        avg_gap = sum(time_gaps, timedelta()) / len(time_gaps)
                        min_gap = min(time_gaps)
                        max_gap = max(time_gaps)
                        
                        print(f"\n⏱️  TIME GAP ANALYSIS (between consecutive records):")
                        print(f"  • Average Gap: {avg_gap}")
                        print(f"  • Minimum Gap: {min_gap}")
                        print(f"  • Maximum Gap: {max_gap}")
                        
                        # Identify active periods (gaps < 1 hour) vs inactive periods (gaps > 24 hours)
                        active_gaps = [gap for gap in time_gaps if gap < timedelta(hours=1)]
                        inactive_gaps = [gap for gap in time_gaps if gap > timedelta(hours=24)]
                        
                        print(f"  • Active Periods (< 1 hour gaps): {len(active_gaps)}")
                        print(f"  • Inactive Periods (> 24 hour gaps): {len(inactive_gaps)}")
                        
                        # Show recent activity timeline
                        print(f"\n📅 RECENT ACTIVITY TIMELINE (Last 10 records):")
                        for i, timestamp in enumerate(valid_timestamps[:10]):
                            age = datetime.utcnow() - timestamp.replace(tzinfo=None)
                            print(f"  {i+1:2d}. {timestamp.strftime('%Y-%m-%d %H:%M:%S')} ({age} ago)")
                        
                        results["activity_patterns"] = {
                            "total_analyzed": len(valid_timestamps),
                            "average_gap": str(avg_gap),
                            "min_gap": str(min_gap),
                            "max_gap": str(max_gap),
                            "active_periods": len(active_gaps),
                            "inactive_periods": len(inactive_gaps)
                        }
                    
                else:
                    print("❌ Not enough valid timestamps for pattern analysis")
            else:
                print("❌ Not enough records for pattern analysis")
        else:
            print(f"❌ Failed to get extended sensor data: {response.status_code}")
        
        print("\n" + "=" * 60)
        
        # 4. Generate comprehensive summary
        print("📋 STEP 4: Database Population Summary")
        print("-" * 50)
        
        if results["last_record_analysis"] and results["recent_activity"]:
            last_update = results["last_record_analysis"]["most_recent_timestamp"]
            time_since = results["last_record_analysis"]["time_since_last_update"]
            total_points = results["recent_activity"]["total_points"]
            recent_7d = results["recent_activity"]["recent_points_7d"]
            
            print(f"🎯 ОТВЕТ НА ВОПРОС: Когда последний раз пополнялась база данных точек?")
            print(f"")
            print(f"📅 ПОСЛЕДНЕЕ ОБНОВЛЕНИЕ: {datetime.fromisoformat(last_update).strftime('%d.%m.%Y в %H:%M:%S UTC')}")
            print(f"⏰ ВРЕМЯ С ПОСЛЕДНЕГО ОБНОВЛЕНИЯ: {time_since}")
            print(f"📊 ВСЕГО ТОЧЕК В БАЗЕ: {total_points}")
            print(f"📈 ДОБАВЛЕНО ЗА ПОСЛЕДНИЕ 7 ДНЕЙ: {recent_7d} точек")
            
            if recent_7d > 0:
                print(f"✅ СТАТУС: База данных активно пополняется")
            else:
                print(f"⚠️  СТАТУС: Нет новых данных за последние 7 дней")
            
            results["summary"] = {
                "last_update_date": last_update,
                "time_since_last_update": time_since,
                "total_points": total_points,
                "recent_points_7d": recent_7d,
                "database_status": "active" if recent_7d > 0 else "inactive"
            }
        
        print("\n" + "=" * 60)
        print("✅ DATABASE ACTIVITY ANALYSIS COMPLETE")
        
        return results
        
    except Exception as e:
        print(f"❌ Error during database analysis: {e}")
        return {"error": str(e)}

def main():
    """Main test execution"""
    print("🚀 Starting Good Road Database Activity Analysis...")
    print()
    
    # Run the comprehensive database analysis
    results = test_database_activity_analysis()
    
    # Save results to file for reference
    try:
        with open('/app/database_activity_analysis.json', 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False, default=str)
        print(f"\n💾 Results saved to: /app/database_activity_analysis.json")
    except Exception as e:
        print(f"⚠️  Could not save results: {e}")
    
    print("\n🎉 Analysis Complete!")

if __name__ == "__main__":
    main()