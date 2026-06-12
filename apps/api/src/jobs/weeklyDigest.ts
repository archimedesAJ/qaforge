import { Queue, Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { prisma } from '../lib/prisma.js';
import { sendWeeklyDigestEmail } from '../services/email.js';

const REDIS_URL = process.env.REDIS_URL;

export async function processDigest(): Promise<void> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Load all projects with their non-viewer members (activated users only)
  const projects = await prisma.project.findMany({
    include: {
      members: {
        where: { role: { in: ['editor', 'manager', 'admin'] } },
        include: {
          user: { select: { id: true, email: true, name: true, activated: true } },
        },
      },
    },
  });

  for (const project of projects) {
    const recipients = project.members
      .map(m => m.user)
      .filter(u => u.activated && u.email);

    if (recipients.length === 0) continue;

    // Fetch runs started this week so we can aggregate their results
    const runsThisWeek = await prisma.testRun.findMany({
      where: { projectId: project.id, startedAt: { gte: since } },
      select: { id: true, status: true },
    });

    const runIds       = runsThisWeek.map(r => r.id);
    const runsOpen     = runsThisWeek.filter(r => r.status === 'open').length;
    const runsClosed   = runsThisWeek.filter(r => r.status === 'closed').length;

    // Aggregate individual test-case results across all runs this week
    const [resultGroups, newCases, newDefects, resolvedDefects, openDefectsCount] =
      await Promise.all([
        runIds.length > 0
          ? prisma.runResult.groupBy({
              by: ['status'],
              where: { runId: { in: runIds } },
              _count: { id: true },
            })
          : Promise.resolve([]),
        prisma.testCase.count({
          where: { projectId: project.id, archived: false, createdAt: { gte: since } },
        }),
        prisma.defect.count({
          where: { projectId: project.id, createdAt: { gte: since } },
        }),
        prisma.defect.count({
          where: {
            projectId: project.id,
            status: { in: ['resolved', 'closed'] },
            updatedAt: { gte: since },
          },
        }),
        prisma.defect.count({
          where: { projectId: project.id, status: { in: ['open', 'in_progress'] } },
        }),
      ]);

    // Map grouped counts by status
    const resultMap = Object.fromEntries(
      resultGroups.map((g: { status: string; _count: { id: number } }) => [g.status, g._count.id])
    );
    const resultsPassed  = resultMap['pass']    ?? 0;
    const resultsFailed  = resultMap['fail']    ?? 0;
    const resultsBlocked = resultMap['blocked'] ?? 0;

    for (const user of recipients) {
      sendWeeklyDigestEmail({
        to:              user.email,
        userName:        user.name || user.email,
        projectName:     project.name,
        projectId:       project.id,
        runsTotal:       runsThisWeek.length,
        runsOpen,
        runsClosed,
        resultsPassed,
        resultsFailed,
        resultsBlocked,
        newCases,
        newDefects,
        resolvedDefects,
        openDefectsCount,
      }).catch(err =>
        console.error(`[digest] failed to send to ${user.email} for ${project.name}:`, err)
      );
    }
  }
}

export function startWeeklyDigest(): void {
  if (!REDIS_URL) {
    console.log('[digest] REDIS_URL not set — weekly digest job will not run');
    return;
  }

  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  const queue = new Queue('weekly-digest', { connection });

  // Register the cron schedule — upsertJobScheduler is idempotent
  // Fires every Monday and Friday at 08:00 UTC
  queue.upsertJobScheduler(
    'biweekly-mon-fri-8am',
    { pattern: '0 8 * * 1,5' },
    { name: 'digest', data: {} }
  ).catch(err => console.error('[digest] failed to register scheduler:', err));

  const worker = new Worker('weekly-digest', processDigest, { connection });

  worker.on('completed', () => console.log('[digest] weekly digest run completed'));
  worker.on('failed', (_, err) => console.error('[digest] weekly digest run failed:', err));
}
