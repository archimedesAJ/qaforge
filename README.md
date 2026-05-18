# QAForge

A self-hosted test management platform for engineering teams. Run manual, exploratory, API, and automated test cases, ingest CI/CD results, and track coverage, flakiness, and trends — all in one place.

## Features

- **Test case library** — manual, functional, UI auto, API, perf, and exploratory types with versioning and tagging
- **Test runs** — pick cases, execute, and close with a pass-rate summary
- **Runners** — in-browser manual step runner, exploratory session logger, and API request runner
- **CI/CD ingest** — JUnit XML and performance metrics (k6, Locust, JMeter) via REST API
- **Results viewer** — filterable table with CSV and PDF export
- **Insights dashboard** — coverage snapshots, flakiness scores, and daily pass-rate trends
- **Team management** — multi-project workspaces with admin/editor/viewer roles
- **API keys** — project-scoped keys for CI/CD pipelines
- **AI assistant** — Claude-powered test case suggestions (optional)

## Quick start (Docker)

```bash
git clone https://github.com/your-org/qaforge
cd qaforge

cp .env.example .env
# Edit .env — set JWT_SECRET at minimum:
#   openssl rand -hex 32

docker compose -f docker/docker-compose.yml up -d
```

Open `http://localhost` — register an account and create your first project.

## Development setup

**Prerequisites:** Node.js 20+, Docker Desktop

```bash
npm install

cp .env.example .env
# Set DATABASE_URL=postgresql://qaforge:password@localhost:5433/qaforge

docker compose -f docker/docker-compose.dev.yml up -d

npm run db:migrate
npm run db:seed      # creates demo user: demo@qaforge.dev / password123

npm run dev          # API → :3001, web → :3000
```

## CI/CD integration

### JUnit XML

```bash
# After your test suite runs:
curl -X POST https://your-qaforge.example.com/projects/$PROJECT_ID/runs/$RUN_ID/ingest/junit \
  -H "Authorization: Bearer $QAFORGE_API_KEY" \
  -H "Content-Type: application/xml" \
  --data-binary @test-results.xml
```

### Performance metrics (k6 example)

```bash
curl -X POST https://your-qaforge.example.com/projects/$PROJECT_ID/runs/$RUN_ID/ingest/perf \
  -H "Authorization: Bearer $QAFORGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "scenario": "checkout_flow",
    "vus": 100, "durationS": 300,
    "p50Ms": 182, "p95Ms": 394, "p99Ms": 612,
    "errorRate": 0.008, "rps": 88.4
  }'
```

## Tech stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| API      | Node.js 20, Fastify, Prisma, Zod    |
| Web      | React 18, Vite, TanStack Query, Zustand |
| Database | PostgreSQL 16                        |
| Queue    | Redis + BullMQ                       |
| Storage  | MinIO (S3-compatible)                |
| AI       | Anthropic Claude                     |

## Environment variables

See `.env.example` for the full list. Required for production:

| Variable           | Description                             |
|--------------------|-----------------------------------------|
| `JWT_SECRET`       | Secret for signing JWTs (min 32 chars)  |
| `POSTGRES_PASSWORD`| Database password                        |
| `MINIO_ROOT_PASSWORD` | MinIO root password                  |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
