# Contributing to QAForge

Thanks for your interest in contributing!

## Development setup

```bash
git clone https://github.com/your-org/qaforge
cd qaforge
npm install
cp .env.example .env          # fill in values
docker compose -f docker/docker-compose.dev.yml up -d
npm run db:migrate
npm run db:seed
npm run dev
```

The API runs at `http://localhost:3001` and the web app at `http://localhost:3000`.

## Project structure

```
apps/
  api/        Fastify API (TypeScript, ESM)
  web/        React 18 + Vite frontend
packages/
  db/         Prisma schema, migrations, seed
  types/      Shared TypeScript types
docker/
  docker-compose.dev.yml   Local infrastructure (Postgres, Redis, MinIO)
  docker-compose.yml       Production deployment
  nginx.conf               Nginx reverse proxy config
```

## Making changes

1. **Fork** the repo and create a branch from `main`
2. **Follow** the existing code style — no formatter config means match what's there
3. **Type-check** before opening a PR: `npx tsc -p apps/api/tsconfig.json --noEmit && npx tsc -p apps/web/tsconfig.json --noEmit`
4. **Test** API changes: `npm test -w apps/api`
5. **Write a clear PR description** — what changed and why

## Database changes

Add models or fields in `packages/db/prisma/schema.prisma`, then:

```bash
npm run db:migrate        # creates migration + applies it
npm run db:generate       # regenerates Prisma client
```

Never edit existing migration files.

## Reporting bugs

Open a GitHub issue with:
- Steps to reproduce
- Expected vs actual behaviour
- Browser/Node.js version if relevant
