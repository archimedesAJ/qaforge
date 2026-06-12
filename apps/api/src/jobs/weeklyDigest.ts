import { Queue, Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { prisma } from '../lib/prisma.js';
import { sendWeeklyDigestEmail } from '../services/email.js';

const REDIS_URL = process.env.REDIS_URL;

async function processDigest(): Promise<void> {
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

    // Parallel queries for the week's stats
    const [runsThisWeek, newCases, newDefects, resolvedDefects, openDefectsCount] =
      await Promise.all([
        prisma.testRun.findMany({
          where: { projectId: project.id, startedAt: { gte: since } },
          select: { status: true },
        }),
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

    const runsPassed = runsThisWeek.filter(r => r.status === 'passed').length;
    const runsFailed = runsThisWeek.filter(r => r.status === 'failed').length;
    const runsOpen   = runsThisWeek.filter(r => r.status === 'open').length;

    // Skip if nothing happened — no point sending an empty digest
    const hasActivity =
      runsThisWeek.length > 0 || newCases > 0 || newDefects > 0 || resolvedDefects > 0;

    if (!hasActivity) continue;

    for (const user of recipients) {
      sendWeeklyDigestEmail({
        to:              user.email,
        userName:        user.name || user.email,
        projectName:     project.name,
        projectId:       project.id,
        runsTotal:       runsThisWeek.length,
        runsPassed,
        runsFailed,
        runsOpen,
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
  queue.upsertJobScheduler(
    'weekly-monday-8am',
    { pattern: '0 8 * * 1' },    // Every Monday at 08:00 UTC
    { name: 'digest', data: {} }
  ).catch(err => console.error('[digest] failed to register scheduler:', err));

  const worker = new Worker('weekly-digest', processDigest, { connection });

  worker.on('completed', () => console.log('[digest] weekly digest run completed'));
  worker.on('failed', (_, err) => console.error('[digest] weekly digest run failed:', err));
}
