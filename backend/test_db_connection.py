import asyncio
import sqlalchemy
from database import engine


async def test_connection():
    async with engine.connect() as conn:
        result = await conn.execute(sqlalchemy.text("SELECT 1"))
        print("Ket noi PostgreSQL thanh cong! SELECT 1 =", result.scalar())


asyncio.run(test_connection())
