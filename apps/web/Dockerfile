# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY apps/web/package.json        apps/web/

RUN npm ci

COPY packages/types packages/types
COPY apps/web       apps/web

RUN npm run build -w apps/web

# ── Runtime stage (nginx) ─────────────────────────────────────
FROM nginx:1.25-alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
