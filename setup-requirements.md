Act as a Principal Full-Stack Engineer and DevOps Expert. I need you to generate a complete boilerplate for a monorepo containing a FastAPI backend, a React frontend (using Vite and TypeScript), and a PostgreSQL database. 

The entire system must be containerized, production-ready, and adhere to industry best practices.

### 1. Project Structure & Monorepo Layout
Organize the repository cleanly as a monorepo:
/my-app
  ├── backend/
  ├── frontend/
  ├── docker-compose.yml
  └── README.md

### 2. Backend Requirements (FastAPI)
- Language/Tools: Python 3.11+, Poetry (or Pydantic v2 + Pipenv/requirements.txt) for dependency management.
- Database ORM: SQLAlchemy (async) with Asyncpg driver.
- Migrations: Alembic configured for automatic migration generation and async execution.
- Security & Auth: 
  - JWT Authentication (Access & Refresh tokens).
  - Secure password hashing using Passlib (Bcrypt).
- API Documentation: Swagger/OpenAPI fully documented with Pydantic models, detailed request/response schemas, and error responses (401, 403, 422).
- Configuration: Pydantic Settings for environment variable validation (`.env`).
- Code Quality: Linting/formatting setup (Ruff or Black/Flake8) and a basic `pytest` structure.
- Middleware: CORS middleware properly configured to allow requests from the frontend.

### 3. Frontend Requirements (React)
- Language/Tools: React 18+, Vite, TypeScript, Tailwind CSS.
- Project Layout: Feature-based or clean layered architecture (components, hooks, services, context).
- State Management & Data Fetching: React Query (TanStack Query) and Axios.

### 4. Containerization & DevOps (Docker)
- Multi-Stage Dockerfiles: Optimized, production-ready Dockerfiles for both frontend (using Nginx to serve static files) and backend (using Uvicorn/Gunicorn).
- Docker Compose:
  - `postgres` service with health checks.
  - `backend` service that waits for Postgres to be healthy before starting, and automatically runs Alembic migrations on startup.
  - `frontend` service for local development (with volume mounting for hot-reloading).
  - Proper environment variable forwarding using a root-level `.env` file.

### 5. Production Readiness
- Include a robust logging configuration in the backend.
- Add a api health check endpoint and UI for the same.
- Set up a global error handler/exception middleware in FastAPI to ensure uniform JSON error responses.
- Provide a clear, step-by-step README.md explaining how to clone, set up env variables, and spin up the entire system with a single `docker compose up --build` command.

Please generate the complete file structure, configuration files (docker-compose, Dockerfiles, vite.config, alembic.ini), and core application code (auth logic, main application entry points, and basic components) required to get this running seamlessly.