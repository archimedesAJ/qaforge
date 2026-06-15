import { prisma } from '../lib/prisma.js';
import { sendWeeklyDigestEmail } from '../services/email.js';

export async function processDigest(): Promise<void> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

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

    const runsThisWeek = await prisma.testRun.findMany({
      where: { projectId: project.id, startedAt: { gte: since } },
      select: { id: true, status: true },
    });

    const runIds     = runsThisWeek.map(r => r.id);
    const runsOpen   = runsThisWeek.filter(r => r.status === 'open').length;
    const runsClosed = runsThisWeek.filter(r => r.status === 'closed').length;

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

    const resultMap = Object.fromEntries(
      resultGroups.map((g: { status: string; _count: { id: number } }) => [g.status, g._count.id])
    );

    for (const user of recipients) {
      sendWeeklyDigestEmail({
        to:              user.email,
        userName:        user.name || user.email,
        projectName:     project.name,
        projectId:       project.id,
        runsTotal:       runsThisWeek.length,
        runsOpen,
        runsClosed,
        resultsPassed:   resultMap['pass']    ?? 0,
        resultsFailed:   resultMap['fail']    ?? 0,
        resultsBlocked:  resultMap['blocked'] ?? 0,
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

// Returns milliseconds until the next Monday or Friday at 08:00 UTC
function msUntilNextRun(): number {
  const now = new Date();
  const RUN_DAYS = [1, 5]; // Monday, Friday (UTC day index)
  const RUN_HOUR = 8;

  let earliest = Infinity;

  for (const day of RUN_DAYS) {
    const target = new Date(now);
    target.setUTCHours(RUN_HOUR, 0, 0, 0);

    let daysAhead = (day - now.getUTCDay() + 7) % 7;
    // If it's the right day but the time has already passed, push to next week
    if (daysAhead === 0 && now.getTime() >= target.getTime()) daysAhead = 7;
    target.setUTCDate(target.getUTCDate() + daysAhead);

    const ms = target.getTime() - now.getTime();
    if (ms < earliest) earliest = ms;
  }

  return earliest;
}

function scheduleNext(): void {
  const ms = msUntilNextRun();
  const hours = Math.round(ms / 3_600_000);
  console.log(`[digest] next run in ~${hours}h (${new Date(Date.now() + ms).toUTCString()})`);

  setTimeout(async () => {
    console.log('[digest] running scheduled digest');
    try {
      await processDigest();
      console.log('[digest] completed');
    } catch (err) {
      console.error('[digest] failed:', err);
    }
    scheduleNext(); // Queue the next occurrence immediately after
  }, ms);
}

export function startWeeklyDigest(): void {
  scheduleNext();
}
