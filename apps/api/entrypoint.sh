#!/bin/sh
set -e

# If DATABASE_URL is not explicitly set, construct it from POSTGRES_* parts.
# This handles deployments where individual DB vars are injected instead of
# the full connection string.
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgresql://${POSTGRES_USER:-qaforge}:${POSTGRES_PASSWORD:-changeme}@postgres:5432/${POSTGRES_DB:-qaforge}"
  echo "DATABASE_URL constructed from POSTGRES_* variables"
fi

echo "Running database migrations..."
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma

echo "Starting QAForge API..."
exec node apps/api/dist/index.js
