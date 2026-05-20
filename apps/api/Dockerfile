# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Install native build tools and OpenSSL needed by Prisma on Alpine.
RUN apk add --no-cache python3 make g++ openssl

# Copy every workspace manifest first so npm ci can resolve the root workspace.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/types/package.json   packages/types/
COPY packages/db/package.json      packages/db/
COPY apps/api/package.json         apps/api/
COPY apps/web/package.json         apps/web/

RUN npm ci

COPY packages/types packages/types
COPY packages/db    packages/db
COPY apps/api       apps/api

RUN npx prisma generate --schema=packages/db/prisma/schema.prisma
RUN npm run build -w apps/api

# Runtime stage
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=builder /app/node_modules      ./node_modules
COPY --from=builder /app/packages/db       ./packages/db
COPY --from=builder /app/packages/types    ./packages/types
COPY --from=builder /app/apps/api/dist     ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/package.json      .

ENV NODE_ENV=production

EXPOSE 8000

COPY apps/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
