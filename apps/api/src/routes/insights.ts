import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';

export const insightsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  // GET /projects/:projectId/insights/coverage
  // Query pre-aggregated CoverageSnapshot table — fast, no joins
  app.get('/:projectId/insights/coverage', async (req) => {
    const { projectId } = req.params as { projectId: string };
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

    const result = snapshots
      .filter((s: { testCaseId: string; lastRunAt: Date | null; passRate: number | null; state: string }) => !!caseMap[s.testCaseId])
      .map((s: { testCaseId: string; lastRunAt: Date | null; passRate: number | null; state: string }) => ({
        id: s.testCaseId,
        title: caseMap[s.testCaseId].title,
        type: caseMap[s.testCaseId].type,
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
  // Computed live from RunResult — no dependency on TrendSeries cache
  app.get('/:projectId/insights/trends', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { granularity = 'day', since } =
      req.query as { granularity?: string; since?: string };

    const sinceDate = since
      ? new Date(since)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    sinceDate.setUTCHours(0, 0, 0, 0);

    const closedRuns = await prisma.testRun.findMany({
      where: { projectId, status: 'closed', endedAt: { gte: sinceDate } },
      select: { id: true, endedAt: true },
      orderBy: { endedAt: 'asc' },
    });

    if (closedRuns.length === 0) return { series: [] };

    const runIds = closedRuns.map((r: { id: string }) => r.id);
    const results = await prisma.runResult.findMany({
      where: { runId: { in: runIds } },
      select: { runId: true, status: true },
    });

    const runDateMap = new Map<string, Date>(
      closedRuns.map((r: { id: string; endedAt: Date | null }) => [r.id, r.endedAt!] as [string, Date])
    );
    const dateGroups = new Map<string, { pass: number; total: number }>();

    for (const r of results) {
      const runDate = runDateMap.get(r.runId);
      if (!runDate) continue;
      const d = new Date(runDate);
      if (granularity === 'week') {
        const day = d.getUTCDay();
        d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
      }
      d.setUTCHours(0, 0, 0, 0);
      const key = d.toISOString().split('T')[0];
      const g = dateGroups.get(key) ?? { pass: 0, total: 0 };
      g.total++;
      if (r.status === 'pass') g.pass++;
      dateGroups.set(key, g);
    }

    const series = [...dateGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, g]) => ({
        date,
        passRate: Number(((g.pass / g.total) * 100).toFixed(1)),
        totalRuns: g.total,
      }));

    return { series };
  });
};
