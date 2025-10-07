#!/usr/bin/env python3
"""
Inspect MongoDB database to understand the actual data structure
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
from pathlib import Path
import json

# Load environment
ROOT_DIR = Path(__file__).parent / "backend"
load_dotenv(ROOT_DIR / '.env')

async def inspect_database():
    # Connect to MongoDB
    mongo_url = os.environ['MONGO_URL']
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ['DB_NAME']]
    
    print("=== INSPECTING MONGODB DATABASE ===")
    print(f"MongoDB URL: {mongo_url}")
    print(f"Database: {os.environ['DB_NAME']}")
    print()
    
    # Check collections
    collections = await db.list_collection_names()
    print(f"Collections: {collections}")
    print()
    
    # Inspect sensor_data collection
    print("=== SENSOR_DATA COLLECTION ===")
    sensor_count = await db.sensor_data.count_documents({})
    print(f"Total documents: {sensor_count}")
    
    if sensor_count > 0:
        # Get latest document
        latest_doc = await db.sensor_data.find_one({}, sort=[("timestamp", -1)])
        print("\nLatest document structure:")
        print(json.dumps(latest_doc, indent=2, default=str))
        
        # Check if rawData exists and show its structure
        if 'rawData' in latest_doc:
            print(f"\nrawData array length: {len(latest_doc['rawData'])}")
            if latest_doc['rawData']:
                print("First rawData item:")
                print(json.dumps(latest_doc['rawData'][0], indent=2, default=str))
    
    print()
    
    # Inspect road_conditions collection
    print("=== ROAD_CONDITIONS COLLECTION ===")
    conditions_count = await db.road_conditions.count_documents({})
    print(f"Total documents: {conditions_count}")
    
    if conditions_count > 0:
        latest_condition = await db.road_conditions.find_one({}, sort=[("created_at", -1)])
        print("\nLatest road condition:")
        print(json.dumps(latest_condition, indent=2, default=str))
    
    print()
    
    # Inspect road_warnings collection
    print("=== ROAD_WARNINGS COLLECTION ===")
    warnings_count = await db.road_warnings.count_documents({})
    print(f"Total documents: {warnings_count}")
    
    if warnings_count > 0:
        latest_warning = await db.road_warnings.find_one({}, sort=[("created_at", -1)])
        print("\nLatest road warning:")
        print(json.dumps(latest_warning, indent=2, default=str))
    
    client.close()

if __name__ == "__main__":
    asyncio.run(inspect_database())