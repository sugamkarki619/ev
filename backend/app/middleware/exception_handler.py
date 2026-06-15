import logging
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

def setup_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        """Handler for Starlette/FastAPI HTTPExceptions."""
        logger.warning(
            f"HTTP error occurred: status_code={exc.status_code} detail={exc.detail} path={request.url.path}"
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        """Handler for validation errors (e.g. invalid Pydantic models)."""
        logger.warning(
            f"Validation error occurred: path={request.url.path} errors={exc.errors()}"
        )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": exc.errors()},
        )

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        """Catch-all for unhandled exceptions."""
        logger.exception(
            f"Unhandled exception occurred while processing request: path={request.url.path} error={str(exc)}"
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An unexpected server error occurred. Please try again later."},
        )
