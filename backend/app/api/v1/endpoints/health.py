from fastapi import APIRouter, status, Response
from app.core.database import verify_db_connection

router = APIRouter()

@router.get("", status_code=status.HTTP_200_OK)
async def health_check(response: Response):
    """
    Check API service and database connectivity.
    Returns 503 if database connection fails.
    """
    db_healthy = await verify_db_connection()
    
    if not db_healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "unhealthy",
            "database": "disconnected",
            "message": "Database connection verification failed"
        }
        
    return {
        "status": "healthy",
        "database": "connected",
        "message": "All systems operational"
    }
