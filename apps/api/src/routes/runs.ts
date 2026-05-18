import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { aggregateOnRunClose } from '../services/aggregation.js';
import { parseJUnitXml } from '../services/junitParser.js';
import { ingestPerfResult } from '../services/perfIngest.js';

const CreateRunSchema = z.object({
  name: z.string().min(1),
  env: z.string().min(1),
  source: z.enum(['manual', 'ci_github', 'ci_gitlab', 'ci_jenkins', 'api']).default('manual'),
  caseIds: z.array(z.string().uuid()).optional(),
});

const ResultSchema = z.object({
  testCaseId: z.string().uuid(),
  status: z.enum(['pass', 'fail', 'blocked', 'skipped', 'not_applicable']),
  durationMs: z.number().optional(),
  stepsLog: z.unknown().optional(),
  attachments: z.array(z.object({ type: z.string(), url: z.string() })).optional(),
  failureNote: z.string().optional(),
  errorMessage: z.string().optional(),
  stackTrace: z.string().optional(),
});

export const runsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  // POST /projects/:projectId/runs — create a new run
  app.post('/:projectId/runs', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { userId } = req.user as { userId: string };
    const body = CreateRunSchema.parse(req.body);

    const run = await prisma.testRun.create({
      data: {
        projectId,
        name: body.name,
        env: body.env,
        source: body.source,
        triggeredBy: userId,
        status: 'open',
      },
    });

    return reply.code(201).send(run);
  });

  // GET /projects/:projectId/runs
  app.get('/:projectId/runs', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const runs = await prisma.testRun.findMany({
      where: { projectId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return { runs };
  });

  // GET /projects/:projectId/runs/:runId/results
  app.get('/:projectId/runs/:runId/results', async (req) => {
    const { runId } = req.params as { projectId: string; runId: string };
    const results = await prisma.runResult.findMany({
      where: { runId },
      orderBy: { executedAt: 'asc' },
      include: { testCase: { select: { title: true, type: true } } },
    });
    return { results };
  });

  // POST /projects/:projectId/runs/:runId/results
  app.post('/:projectId/runs/:runId/results', async (req, reply) => {
    const { runId } = req.params as { projectId: string; runId: string };
    const body = req.body as { results?: unknown[] } | unknown;
    const rawResults = Array.isArray((body as { results?: unknown[] }).results)
      ? (body as { results: unknown[] }).results
      : [body];
    const validated = rawResults.map((r) => ResultSchema.parse(r));
    const caseIds = [...new Set(validated.map((r) => r.testCaseId))];
    const cases = await prisma.testCase.findMany({
      where: { id: { in: caseIds }, archived: false },
      select: { id: true, version: true },
    });
    const versionMap = Object.fromEntries(cases.map((c: { id: string; version: number }) => [c.id, c.version]));
    await prisma.runResult.createMany({
      data: validated.map((r) => ({
        runId, testCaseId: r.testCaseId,
        testCaseVersion: versionMap[r.testCaseId] ?? 1,
        status: r.status, durationMs: r.durationMs,
        stepsLog: r.stepsLog as object | undefined,
        attachments: r.attachments as object | undefined,
        failureNote: r.failureNote, errorMessage: r.errorMessage, stackTrace: r.stackTrace,
      })),
    });
    return reply.code(201).send({ inserted: validated.length });
  });

  // PUT /projects/:projectId/runs/:runId/close
  app.put('/:projectId/runs/:runId/close', async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    if (run.status === 'closed') return reply.code(409).send({ error: 'Run already closed' });
    const results = await prisma.runResult.groupBy({
      by: ['status'], where: { runId }, _count: { status: true },
    });
    const counts = { pass: 0, fail: 0, blocked: 0, skipped: 0, not_applicable: 0 };
    results.forEach((r: { status: string; _count: { status: number } }) => {
      counts[r.status as keyof typeof counts] = r._count.status;
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const passRate = total > 0 ? Math.round((counts.pass / total) * 100) : 0;
    await prisma.testRun.update({ where: { id: runId }, data: { status: 'closed', endedAt: new Date() } });
    aggregateOnRunClose(runId, projectId).catch(() => {});
    return { status: 'closed', summary: { ...counts, total, passRate } };
  });

  // POST /runs/:runId/results — submit one or many results (append-only)
  app.post('/:runId/results', async (req, reply) => {
    const { runId } = req.params as { runId: string };

    const body = req.body as { results?: unknown[] } | unknown;
    const rawResults = Array.isArray((body as { results?: unknown[] }).results)
      ? (body as { results: unknown[] }).results
      : [body];

    const validated = rawResults.map((r) => ResultSchema.parse(r));

    const caseIds = [...new Set(validated.map((r) => r.testCaseId))];
    const cases = await prisma.testCase.findMany({
      where: { id: { in: caseIds }, archived: false },
      select: { id: true, version: true },
    });
    const versionMap = Object.fromEntries(cases.map((c: { id: string; version: number }) => [c.id, c.version]));

    await prisma.runResult.createMany({
      data: validated.map((r) => ({
        runId,
        testCaseId: r.testCaseId,
        testCaseVersion: versionMap[r.testCaseId] ?? 1,
        status: r.status,
        durationMs: r.durationMs,
        stepsLog: r.stepsLog as object | undefined,
        attachments: r.attachments as object | undefined,
        failureNote: r.failureNote,
        errorMessage: r.errorMessage,
        stackTrace: r.stackTrace,
      })),
    });

    return reply.code(201).send({ inserted: validated.length });
  });

  // POST /projects/:projectId/runs/:runId/ingest/junit — project-scoped alias
  app.post('/:projectId/runs/:runId/ingest/junit', async (req, reply) => {
    const { runId } = req.params as { projectId: string; runId: string };
    return app.inject({
      method: 'POST',
      url: `/runs/${runId}/ingest/junit`,
      headers: { ...req.headers, 'content-type': req.headers['content-type'] ?? 'application/xml' },
      body: req.body as string,
    }).then(res => {
      reply.code(res.statusCode);
      return JSON.parse(res.body);
    });
  });

  // POST /runs/:runId/ingest/junit — CI/CD JUnit XML ingest
  app.post('/:runId/ingest/junit', async (req, reply) => {
    const { runId } = req.params as { runId: string };

    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) return reply.code(404).send({ error: 'Run not found' });

    const xml = typeof req.body === 'string'
      ? req.body
      : Buffer.isBuffer(req.body)
      ? req.body.toString('utf-8')
      : JSON.stringify(req.body);

    let parsed;
    try {
      parsed = parseJUnitXml(xml);
    } catch (err) {
      return reply.code(400).send({ error: 'Invalid JUnit XML', detail: String(err) });
    }

    const allTestCases = parsed.suites.flatMap(s => s.testCases);
    if (allTestCases.length === 0) {
      return { processed: 0, auto_imported: 0, run_id: runId, totals: parsed.totals };
    }

    const existingCases = await prisma.testCase.findMany({
      where: { projectId: run.projectId, archived: false },
      select: { id: true, title: true, version: true },
    });

    const titleMap = new Map<string, { id: string; title: string; version: number }>(
      existingCases.map((c: { id: string; title: string; version: number }) => [
        c.title.toLowerCase().trim(), c,
      ])
    );

    let processed    = 0;
    let autoImported = 0;

    for (const tc of allTestCases) {
      const fullTitle = tc.classname ? `${tc.classname}.${tc.name}` : tc.name;

      let matched: { id: string; title: string; version: number } | undefined =
        titleMap.get(tc.name.toLowerCase().trim()) ??
        titleMap.get(fullTitle.toLowerCase().trim());

      if (!matched) {
        const projectOwner = await prisma.project.findUnique({
          where: { id: run.projectId },
          select: { ownerId: true },
        });
        const created = await prisma.testCase.create({
          data: {
            projectId:   run.projectId,
            title:       tc.name,
            type:        'ui_auto',
            priority:    'p2',
            version:     1,
            tags:        JSON.stringify(['auto-import']),
            createdById: run.triggeredBy ?? projectOwner?.ownerId ?? '',
          },
        });
        matched = { id: created.id, title: created.title, version: 1 };
        autoImported++;
      }

      const status = tc.status === 'pass'    ? 'pass'
                   : tc.status === 'skipped' ? 'skipped'
                   : 'fail';

      await prisma.runResult.create({
        data: {
          runId,
          testCaseId:      matched.id,
          testCaseVersion: matched.version,
          status,
          durationMs:      tc.time ? Math.round(tc.time * 1000) : undefined,
          errorMessage:    tc.errorMessage ?? undefined,
          stackTrace:      tc.stackTrace   ?? undefined,
          stepsLog:        tc.systemOut ? { systemOut: tc.systemOut } : undefined,
        },
      });

      processed++;
    }

    return {
      processed,
      auto_imported: autoImported,
      run_id:        runId,
      totals:        parsed.totals,
      suites:        parsed.suites.map(s => ({ name: s.name, tests: s.testCases.length })),
    };
  });

  // POST /runs/:runId/ingest/perf — k6 / Locust / JMeter JSON ingest
  app.post('/:runId/ingest/perf', async (req, reply) => {
    const { runId } = req.params as { runId: string };

    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) return reply.code(404).send({ error: 'Run not found' });

    const body = req.body as {
      scenario:    string;
      vus:         number;
      durationS:   number;
      p50Ms:       number;
      p95Ms:       number;
      p99Ms:       number;
      errorRate:   number;
      rps:         number;
      testCaseId?: string;
      thresholds?: {
        p95Ms?:        number;
        p99Ms?:        number;
        maxErrorRate?: number;
        minRps?:       number;
      };
    };

    if (!body.scenario) return reply.code(400).send({ error: 'scenario is required' });

    let testCaseId = body.testCaseId ?? null;
    if (!testCaseId) {
      const matched = await prisma.testCase.findFirst({
        where: {
          projectId: run.projectId,
          type: 'perf',
          archived: false,
          title: { contains: body.scenario, mode: 'insensitive' },
        },
        select: { id: true },
      });
      testCaseId = matched?.id ?? null;
    }

    const result = await ingestPerfResult(
      runId,
      run.projectId,
      testCaseId,
      {
        scenario:  body.scenario,
        vus:       body.vus,
        durationS: body.durationS,
        p50Ms:     body.p50Ms,
        p95Ms:     body.p95Ms,
        p99Ms:     body.p99Ms,
        errorRate: body.errorRate,
        rps:       body.rps,
      },
      body.thresholds
    );

    return reply.code(200).send({
      status:             result.status,
      threshold_breaches: result.thresholdBreaches,
      is_new_baseline:    result.isNewBaseline,
      run_id:             runId,
      scenario:           body.scenario,
    });
  });

  // POST /projects/:projectId/runs/:runId/ingest/perf — project-scoped alias
  app.post('/:projectId/runs/:runId/ingest/perf', async (req, reply) => {
    const { runId } = req.params as { projectId: string; runId: string };
    return app.inject({
      method: 'POST',
      url: `/runs/${runId}/ingest/perf`,
      headers: req.headers as Record<string, string>,
      body: JSON.stringify(req.body),
    }).then(res => {
      reply.code(res.statusCode);
      return JSON.parse(res.body);
    });
  });

  // PUT /runs/:runId/close — finalise run, compute aggregates
  app.put('/:runId/close', async (req, reply) => {
    const { runId } = req.params as { runId: string };

    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    if (run.status === 'closed') return reply.code(409).send({ error: 'Run already closed' });

    const results = await prisma.runResult.groupBy({
      by: ['status'],
      where: { runId },
      _count: { status: true },
    });

    const counts = { pass: 0, fail: 0, blocked: 0, skipped: 0, not_applicable: 0 };
    results.forEach((r: { status: string; _count: { status: number } }) => { counts[r.status as keyof typeof counts] = r._count.status; });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const passRate = total > 0 ? Math.round((counts.pass / total) * 100) : 0;

    await prisma.testRun.update({
      where: { id: runId },
      data: { status: 'closed', endedAt: new Date() },
    });

    return {
      status: 'closed',
      summary: { ...counts, total, passRate },
    };
  });
};
