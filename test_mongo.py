import motor.motor_asyncio
import asyncio

async def test():
    client = motor.motor_asyncio.AsyncIOMotorClient('mongodb://localhost:27017')
    await client.admin.command('ping')
    print('OK')

asyncio.run(test())