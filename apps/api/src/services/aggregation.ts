import { prisma } from '../lib/prisma.js';

/**
 * Called after a run is closed.
 * Recomputes CoverageSnapshot, FlakinessScore, and TrendSeries
 * for all test cases affected by this run.
 */
export async function aggregateOnRunClose(runId: string, projectId: string): Promise<void> {
  try {
    await Promise.all([
      updateCoverageSnapshots(projectId),
      updateFlakinessScores(projectId),
      updateTrendSeries(runId, projectId),
    ]);
  } catch (err) {
    // Aggregation failure must not break the run close response
    console.error('[aggregation] Failed:', err);
  }
}

// ── Coverage snapshots ────────────────────────────────────────
// Healthy  = run in last 14 days AND pass rate >= 80%
// Stale    = not run in last 14 days
// Failing  = pass rate < 80%
async function updateCoverageSnapshots(projectId: string): Promise<void> {
  const staleCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const cases = await prisma.testCase.findMany({
    where: { projectId, archived: false },
    select: { id: true },
  });

  for (const tc of cases) {
    // Get all results for this case across all runs in this project
    const results = await prisma.runResult.findMany({
      where: {
        testCaseId: tc.id,
        run: { projectId },
      },
      orderBy: { executedAt: 'desc' },
      take: 50,
      select: { status: true, executedAt: true },
    });

    if (results.length === 0) {
      await prisma.coverageSnapshot.upsert({
        where: { projectId_testCaseId: { projectId, testCaseId: tc.id } },
        update: { passRate: null, lastRunAt: null, state: 'stale', computedAt: new Date() },
        create: { projectId, testCaseId: tc.id, passRate: null, lastRunAt: null, state: 'stale' },
      });
      continue;
    }

    const lastRunAt   = results[0].executedAt;
    const isStale     = lastRunAt < staleCutoff;

    // Only pass/fail are conclusive verdicts. Blocked and skipped do not
    // reflect test quality and must not count against pass rate.
    const conclusive  = results.filter((r: { status: string }) => r.status === 'pass' || r.status === 'fail');
    const passRate    = conclusive.length > 0
      ? conclusive.filter((r: { status: string }) => r.status === 'pass').length / conclusive.length
      : null;

    const state = isStale || passRate === null
      ? 'stale'
      : passRate >= 0.8 ? 'healthy' : 'failing';

    await prisma.coverageSnapshot.upsert({
      where: { projectId_testCaseId: { projectId, testCaseId: tc.id } },
      update: { passRate, lastRunAt, state, computedAt: new Date() },
      create: { projectId, testCaseId: tc.id, passRate, lastRunAt, state },
    });
  }
}

// ── Flakiness scores ──────────────────────────────────────────
// Only ui_auto and api types can be flaky (manual tests fail for human reasons)
// Score = alternating pass/fail transitions / total runs
// Only computed for cases with >= 5 runs
async function updateFlakinessScores(projectId: string): Promise<void> {
  const cases = await prisma.testCase.findMany({
    where: { projectId, archived: false, type: { in: ['ui_auto', 'api'] } },
    select: { id: true },
  });

  for (const tc of cases) {
    const results = await prisma.runResult.findMany({
      where: { testCaseId: tc.id, run: { projectId } },
      orderBy: { executedAt: 'asc' },
      select: { status: true, executedAt: true },
    });

    if (results.length < 5) continue;

    // Count transitions between pass and non-pass
    let transitions = 0;
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1].status === 'pass';
      const curr = results[i].status === 'pass';
      if (prev !== curr) transitions++;
    }

    const score = transitions / results.length;
    const lastSeenAt = results[results.length - 1].executedAt;

    await prisma.flakinessScore.upsert({
      where: { projectId_testCaseId: { projectId, testCaseId: tc.id } },
      update: { score, runsAnalysed: results.length, lastSeenAt, computedAt: new Date() },
      create: { projectId, testCaseId: tc.id, score, runsAnalysed: results.length, lastSeenAt },
    });
  }
}

// ── Trend series ──────────────────────────────────────────────
// Upserts a single TrendSeries row for today's date for this project
async function updateTrendSeries(runId: string, projectId: string): Promise<void> {
  // Get today's date (UTC, truncated to day)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Count all results across all runs closed today for this project
  const todayEnd = new Date(today);
  todayEnd.setUTCHours(23, 59, 59, 999);

  const results = await prisma.runResult.findMany({
    where: {
      run: {
        projectId,
        status: 'closed',
        endedAt: { gte: today, lte: todayEnd },
      },
    },
    select: { status: true },
  });

  if (results.length === 0) return;

  const conclusive = results.filter((r: { status: string }) => r.status === 'pass' || r.status === 'fail');
  if (conclusive.length === 0) return;
  const passRate   = (conclusive.filter((r: { status: string }) => r.status === 'pass').length / conclusive.length) * 100;

  await prisma.trendSeries.upsert({
    where: {
      projectId_date_env_suiteId: {
        projectId,
        date: today,
        env: null as unknown as string,
        suiteId: null as unknown as string,
      },
    },
    update: { passRate, totalRuns: results.length },
    create: { projectId, date: today, passRate, totalRuns: results.length },
  });
}
