from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.logging_config import setup_logging
from app.middleware.exception_handler import setup_exception_handlers
from app.api.v1.api import api_router

# Configure logging at start
setup_logging()

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Production-ready FastAPI + PostgreSQL + React Monorepo Boilerplate",
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

# Set CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(origin).rstrip("/") for origin in settings.BACKEND_CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup global exceptions
setup_exception_handlers(app)

# Include API Router
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/", include_in_schema=False)
async def redirect_to_docs():
    """Redirect root path to interactive Swagger documentation."""
    return RedirectResponse(url="/docs")
