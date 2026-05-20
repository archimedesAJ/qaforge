#!/bin/sh
set -e

# Construct DATABASE_URL from POSTGRES_* parts if not explicitly provided
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgresql://${POSTGRES_USER:-qaforge}:${POSTGRES_PASSWORD:-changeme}@postgres:5432/${POSTGRES_DB:-qaforge}"
  echo "DATABASE_URL constructed from POSTGRES_* variables"
fi

# Wait for Postgres to be reachable before running migrations
echo "Waiting for database..."
until nc -z "${POSTGRES_HOST:-postgres}" 5432; do
  sleep 2
done
echo "Database is ready."

echo "Running database migrations..."
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma

echo "Starting QAForge API..."
exec node apps/api/dist/index.js
