from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.config import settings

# Create async engine
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,  # Set to True to log SQL statements
    future=True,
    pool_pre_ping=True,  # Test connection health before using it
)

# Session factory for async database sessions
SessionLocal = async_sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    class_=AsyncSession,
)

# Dependency to get db session in endpoints
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as db:
        try:
            yield db
        finally:
            await db.close()
            
async def verify_db_connection() -> bool:
    """Helper to verify if the database is accessible."""
    try:
        from sqlalchemy import text
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
