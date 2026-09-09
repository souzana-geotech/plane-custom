# Running the Project

This is a monorepo project for **Plane** - an open-source project management tool. The project is built with a modern tech stack using Next.js, React Router, Node.js, and PostgreSQL.

## Project Structure

The monorepo contains multiple applications:

- **`apps/web`** - Main web application (React Router)
- **`apps/api`** - Backend API (Python/Django)
- **`apps/admin`** - Admin panel
- **`apps/space`** - Public space/documentation app
- **`apps/live`** - Real-time collaboration service
- **`packages/`** - Shared packages (UI, utilities, types, services, etc.)

## Prerequisites

Before running the project, ensure you have:

- **Node.js** >= 22.22.0
- **pnpm** >= 11.10.0 (package manager)
- **Docker** & **Docker Compose** (for running services like PostgreSQL, Redis, RabbitMQ, MinIO)
- **Git** (for version control)

### Install Node.js

Download from [nodejs.org](https://nodejs.org) or use a version manager like:

- **nvm** (Linux/Mac): `nvm install 22.22.0`
- **fnm** (Cross-platform): `fnm install 22.22.0`

### Install pnpm

```bash
npm install -g pnpm@11.10.0
```

Verify installation:

```bash
pnpm --version
```

## Setup & Installation

### 1. Clone & Navigate to Project

```bash
cd path/to/plane-custom
```

### 2. Install Dependencies

```bash
pnpm install
```

This installs all dependencies for the monorepo and all apps using pnpm's workspace feature.

### 3. Set Up Environment Variables

Copy the example environment files to `.env`:

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/admin/.env.example apps/admin/.env
cp apps/space/.env.example apps/space/.env
cp apps/live/.env.example apps/live/.env
```

Edit the `.env` files and fill in required values:

- Database credentials
- API keys
- AWS S3 / MinIO settings
- Redis configuration
- RabbitMQ settings

> **Tip:** For local development, default values in `.env.example` often work out of the box.

## Running the Project

### Option 1: Local Development (Recommended for Development)

This runs the frontend and backend services locally without Docker.

#### Start Database & Services (Docker)

```bash
docker-compose up -d plane-db plane-redis plane-mq plane-minio
```

This starts the background services required by the API:

- PostgreSQL database (`plane-db`)
- Redis cache (`plane-redis`)
- RabbitMQ message queue (`plane-mq`)
- MinIO object storage (`plane-minio`)

#### Run Migrations (First Time Only)

```bash
docker-compose run --rm migrator
```

#### Start Development Servers

In the project root, start all development servers with Turbo:

```bash
pnpm dev
```

This runs development servers for:

- **Web app** → `http://localhost:3000`
- **Admin panel** → `http://localhost:3001` (if configured)
- **API** → `http://localhost:8000` (if backend dev server configured)
- **Other apps** in their configured ports

The dev server supports **hot module reloading (HMR)** - changes are reflected immediately.

#### Individual App Development

To run a specific app:

```bash
pnpm --filter web dev
pnpm --filter api dev
```

### Option 2: Full Docker Setup (Production-like)

Build and run all services in Docker:

```bash
docker-compose up --build
```

This builds and starts:

- Web app
- Admin panel
- API
- Background worker
- Beat worker (scheduled tasks)
- Database
- Redis
- RabbitMQ
- MinIO
- Reverse proxy

The application will be available at `http://localhost` (via the proxy).

#### Stop All Services

```bash
docker-compose down
```

#### Stop Services and Remove Data

```bash
docker-compose down -v
```

## Available Commands

### Development

```bash
pnpm dev              # Start all dev servers
pnpm dev --concurrency=4  # Run with limited concurrency
```

### Building

```bash
pnpm build            # Build all apps
pnpm --filter web build  # Build specific app
```

### Production

```bash
pnpm start            # Start production servers
```

### Code Quality

```bash
pnpm check:lint       # Check code for linting issues
pnpm check:format     # Check code formatting
pnpm check:types      # Check TypeScript types
pnpm fix:lint         # Fix linting issues
pnpm fix:format       # Format code
```

### Cleaning

```bash
pnpm clean            # Remove all build artifacts and node_modules
```

## Accessing the Application

### Local Development

- **Web App**: `http://localhost:3000`
- **Admin Panel**: `http://localhost:3001` (if running)
- **API**: `http://localhost:8000`

### Docker Deployment

- **Application**: `http://localhost`
- **MinIO Console**: `http://localhost:9000` (or 9090)
- **RabbitMQ Management**: Access via Docker container

## Database Migrations

### Run Migrations

```bash
docker-compose run --rm migrator
```

### Create a New Migration

```bash
# Navigate to the API app
cd apps/api

# Create migration (Django/Alembic)
python manage.py makemigrations
```

## Troubleshooting

### Port Already in Use

If a port is already in use, change the port in:

- `apps/web/package.json` (dev script)
- Docker Compose environment variables

Example for web app:

```bash
PORT=3001 pnpm --filter web dev
```

### Database Connection Issues

Ensure PostgreSQL is running:

```bash
docker-compose ps plane-db
```

Check database credentials in `.env`:

```bash
POSTGRES_USER=postgres
POSTGRES_DB=plane
POSTGRES_PASSWORD=your_password
```

### Module Not Found Errors

Reinstall dependencies:

```bash
pnpm clean
pnpm install
```

### HMR Not Working

If hot module reloading isn't working:

1. Check that the dev server is running
2. Clear browser cache and reload
3. Restart the dev server

### Memory Issues

If Node.js runs out of memory during build:

```bash
NODE_OPTIONS=--max-old-space-size=4096 pnpm build
```

### Docker Build Fails

Clear Docker cache and rebuild:

```bash
docker system prune -a
docker-compose build --no-cache
```

## Performance Tips

- Use `--concurrency` flag to limit parallel tasks: `pnpm dev --concurrency=4`
- Run specific apps instead of all: `pnpm --filter web dev`
- Use VS Code extensions like ESLint and Prettier for real-time feedback

## Next Steps

- Check the project's main README for more detailed documentation
- Review individual app README files in `apps/*/`
- Check package.json scripts for available commands
- Review the `.env.example` files for configuration options

## Support

For issues or questions:

- Check the [Plane GitHub repository](https://github.com/makeplane/plane)
- Review error logs in the terminal
- Check Docker container logs: `docker-compose logs -f <service_name>`

---

**Last Updated**: 2026-09-09  
**Node.js Version**: >= 22.22.0  
**pnpm Version**: >= 11.10.0
