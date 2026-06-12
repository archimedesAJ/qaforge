import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { authRoutes } from './routes/auth.js';
import { projectsRoutes } from './routes/projects.js';
import { casesRoutes } from './routes/cases.js';
import { runsRoutes } from './routes/runs.js';
import { plansRoutes } from './routes/plans.js';
import { setsRoutes } from './routes/sets.js';
import { defectsRoutes } from './routes/defects.js';
import { insightsRoutes } from './routes/insights.js';
import { aiRoutes } from './routes/ai.js';
import { uploadsRoutes } from './routes/uploads.js';
import { startWeeklyDigest } from './jobs/weeklyDigest.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

// ── Plugins ──────────────────────────────────────────────────
await app.register(cors, {
  origin: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
  credentials: true,
});

await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
});

await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } }); // 5 MB

// ── Routes ───────────────────────────────────────────────────
await app.register(authRoutes,     { prefix: '/api/auth' });
await app.register(projectsRoutes, { prefix: '/api/projects' });
await app.register(casesRoutes,    { prefix: '/api/projects' });
await app.register(runsRoutes,     { prefix: '/api/projects' });
await app.register(plansRoutes,    { prefix: '/api/projects' });
await app.register(setsRoutes,     { prefix: '/api/projects' });
await app.register(defectsRoutes,  { prefix: '/api/projects' });
await app.register(insightsRoutes, { prefix: '/api/projects' });
await app.register(aiRoutes,       { prefix: '/api/projects' });
await app.register(uploadsRoutes,  { prefix: '/api/uploads' });

// ── Health check ─────────────────────────────────────────────
app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Start ────────────────────────────────────────────────────
const port = Number(process.env.API_PORT) || 3001;

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`QAForge API running on http://localhost:${port}`);
  startWeeklyDigest();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
