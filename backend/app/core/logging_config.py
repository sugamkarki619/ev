import logging
import sys
from logging.config import dictConfig

LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "()": "logging.Formatter",
            "fmt": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
        "detailed": {
            "()": "logging.Formatter",
            "fmt": "%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
    },
    "handlers": {
        "console": {
            "formatter": "detailed",
            "class": "logging.StreamHandler",
            "stream": sys.stdout,
        },
    },
    "loggers": {
        "": {  # Root logger
            "handlers": ["console"],
            "level": "INFO",
        },
        "uvicorn": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "uvicorn.error": {
            "level": "INFO",
        },
        "uvicorn.access": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "sqlalchemy.engine": {
            "handlers": ["console"],
            "level": "WARNING",  # Set to INFO or DEBUG to log SQL queries
            "propagate": False,
        },
    },
}

def setup_logging():
    dictConfig(LOGGING_CONFIG)
    logger = logging.getLogger(__name__)
    logger.info("Logging configured successfully.")
