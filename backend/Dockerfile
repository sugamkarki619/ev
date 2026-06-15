# Multi-stage Dockerfile for FastAPI Backend
FROM python:3.11-slim AS builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install compiler dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Final runtime stage
FROM python:3.11-slim AS runner

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/root/.local/bin:$PATH

# Install postgres client libraries for runtime and curl for health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed dependencies from builder stage
COPY --from=builder /root/.local /root/.local

# Copy application source code
COPY . .

EXPOSE 8000

# Default development command - can be overridden in docker-compose for dev vs prod environments
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
