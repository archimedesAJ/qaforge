import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';

export const insightsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  // GET /projects/:projectId/insights/coverage
  // Query pre-aggregated CoverageSnapshot table — fast, no joins
  app.get('/:projectId/insights/coverage', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { env } = req.query as { env?: string };

    const snapshots = await prisma.coverageSnapshot.findMany({
      where: { projectId },
      orderBy: { state: 'asc' }, // failing first
    });

    // Join with test case titles
    const caseIds = snapshots.map((s: { testCaseId: string; lastRunAt: Date | null; passRate: number | null; state: string }) => s.testCaseId);
    const cases = await prisma.testCase.findMany({
      where: { id: { in: caseIds }, archived: false },
      select: { id: true, title: true, type: true },
    });
    const caseMap = Object.fromEntries(cases.map((c: { id: string; title: string; type: string }) => [c.id, c]));

    const result = snapshots.map((s: { testCaseId: string; lastRunAt: Date | null; passRate: number | null; state: string }) => ({
      id: s.testCaseId,
      title: caseMap[s.testCaseId]?.title ?? 'Unknown',
      type: caseMap[s.testCaseId]?.type ?? 'manual',
      lastRun: s.lastRunAt?.toISOString(),
      passRate: s.passRate,
      state: s.state,
    }));

    return { cases: result };
  });

  // GET /projects/:projectId/insights/flakiness
  // Only cases with score > 0 — ordered worst first
  app.get('/:projectId/insights/flakiness', async (req) => {
    const { projectId } = req.params as { projectId: string };

    const scores = await prisma.flakinessScore.findMany({
      where: { projectId, score: { gt: 0 } },
      orderBy: { score: 'desc' },
      take: 20,
    });

    const caseIds = scores.map((s: { testCaseId: string; score: number; runsAnalysed: number; lastSeenAt: Date }) => s.testCaseId);
    const cases = await prisma.testCase.findMany({
      where: { id: { in: caseIds } },
      select: { id: true, title: true, type: true },
    });
    const caseMap = Object.fromEntries(cases.map((c: { id: string; title: string; type: string }) => [c.id, c]));

    return {
      flaky: scores.map((s: { testCaseId: string; score: number; runsAnalysed: number; lastSeenAt: Date }) => ({
        testCaseId: s.testCaseId,
        title: caseMap[s.testCaseId]?.title ?? 'Unknown',
        type: caseMap[s.testCaseId]?.type ?? 'manual',
        flakinessScore: Number(s.score.toFixed(2)),
        runsAnalysed: s.runsAnalysed,
        lastSeen: s.lastSeenAt.toISOString(),
      })),
    };
  });

  // GET /projects/:projectId/insights/trends
  app.get('/:projectId/insights/trends', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { granularity = 'day', env, suiteId, since } =
      req.query as { granularity?: string; env?: string; suiteId?: string; since?: string };

    const where: Record<string, unknown> = {
      projectId,
      ...(env && { env }),
      ...(suiteId && { suiteId }),
      ...(since && { date: { gte: new Date(since) } }),
    };

    const series = await prisma.trendSeries.findMany({
      where,
      orderBy: { date: 'asc' },
    });

    return {
      series: series.map((s: { date: Date; passRate: number; totalRuns: number }) => ({
        date: s.date.toISOString().split('T')[0],
        passRate: Number(s.passRate.toFixed(1)),
        totalRuns: s.totalRuns,
      })),
    };
  });
};
