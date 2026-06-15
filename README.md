# Scaling Octo-Waffle: Containerized Monorepo Boilerplate

A containerized, production-ready monorepo boilerplate featuring a **FastAPI** backend, a **React (Vite + TypeScript)** frontend, and a **PostgreSQL** database. 

## Stack Overview
- **Backend**: Python 3.11, FastAPI, SQLAlchemy 2.0 (async), asyncpg, Alembic migrations, custom token-based JWT auth, native bcrypt password hashing, Pydantic settings.
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS v4, Axios API client (with automated token refresh and request interceptors).
- **Orchestration**: Docker & Docker Compose with pg-ready database health checks and hot-reload mount volumes.

---

## Getting Started

### 1. Prerequisites
Ensure you have the following installed on your machine:
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### 2. Configuration (`.env`)
The system expects a `.env` file at the root of the project to set up the database credentials and JWT parameters. A boilerplate `.env` is already created for you. You can adjust the credentials if needed:
```env
# Security / JWT
SECRET_KEY=e8f9a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# Database Connection (Postgres)
POSTGRES_SERVER=db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=app
POSTGRES_PORT=5432

# CORS Config (Origins allowed to access API)
BACKEND_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost
```

### 3. Spin Up the Stack
Start all services by running the following command from the root directory:
```bash
docker compose up --build
```
This single command handles:
1. Building and mounting the **PostgreSQL** container.
2. Waiting for the database health check to pass.
3. Building the **FastAPI** container, running **Alembic migrations** to create tables, and starting Uvicorn with hot-reload.
4. Building the **React + TS** container and running the Vite server with live hot-reload.

---

## Local Service Ports

Once running, you can access the components at the following local endpoints:
- **React Frontend Dashboard**: [http://localhost:5173/](http://localhost:5173/)
- **FastAPI interactive Swagger UI docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **FastAPI API Health Check Endpoint**: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)
- **PostgreSQL Database**: `localhost:5432`

---

## Architecture and File Layout
```text
scaling-octo-waffle/
├── docker-compose.yml       # Docker service orchestrator (DB, Backend, Frontend)
├── .env                     # Environment variables
├── README.md                # System documentation
├── backend/                 # FastAPI application
│   ├── app/
│   │   ├── api/             # API routes and router definitions
│   │   ├── core/            # Config, security, DB connections, logging configurations
│   │   ├── crud/            # Database operations logic (User authentication and signup)
│   │   ├── middleware/      # Global exceptions standardizer
│   │   ├── models/          # Declarative SQLAlchemy models (User base mapping)
│   │   ├── schemas/         # Pydantic validation schemas (User and Token inputs)
│   │   └── main.py          # FastAPI application entry point
│   ├── alembic/             # Migration configurations and versions
│   ├── alembic.ini          # Migration config file
│   └── Dockerfile           # Backend multi-stage slim builder
└── frontend/                # React (Vite, TS, Tailwind CSS v4)
    ├── src/
    │   ├── api/             # Axios instance and response/request interceptors
    │   ├── components/      # HealthCheck and Auth (Login/Signup) layouts
    │   ├── App.tsx          # Main Dashboard and account controller panel
    │   └── main.tsx         # Mounting point
    ├── vite.config.ts       # Vite build configurations with Tailwind v4 loader
    └── Dockerfile           # Frontend multi-stage developer and production builder
```

---

## Key Technical Implementations

### Automatic Database Migrations
On backend boot, the container runs `alembic upgrade head`. This ensures the database schema is automatically updated to match the SQLAlchemy models.

### Authentication & Token Rotation
Alembic migrations bootstrap a `users` table. The backend employs secure **bcrypt** password hashing and returns both an **Access Token** and a **Refresh Token** on login. The frontend Axios client intercepts expired requests, automatically requests a new access token using the refresh token, and retries the original request.
