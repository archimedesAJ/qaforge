# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Copy every workspace manifest first so npm ci can resolve the root workspace.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/types/package.json   packages/types/
COPY packages/db/package.json      packages/db/
COPY apps/api/package.json         apps/api/
COPY apps/web/package.json         apps/web/

RUN npm ci

COPY packages/types packages/types
COPY apps/web       apps/web

RUN npm run build -w apps/web

# Runtime stage
FROM nginx:1.25-alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf.template

EXPOSE 80
CMD ["/bin/sh", "-c", "envsubst '$API_UPSTREAM' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
