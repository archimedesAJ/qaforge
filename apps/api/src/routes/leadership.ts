import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { buildLeadershipDeck } from '../services/leadershipPptx.js';
import { draftLeadershipEntry } from '../services/openaiLeadership.js';

const BulletList = z.array(z.string().trim().min(1).max(500)).max(20).default([]);
const ActionList = z.array(z.object({
  action: z.string().trim().min(1).max(500),
  owner: z.string().trim().max(200).optional(),
  dueDate: z.string().date().optional(),
  status: z.enum(['open', 'done']).default('open'),
})).max(30).default([]);

const OneOnOneSchema = z.object({
  reportId: z.string().uuid(), meetingDate: z.string().date(),
  wins: BulletList, discussionPoints: BulletList, challenges: BulletList,
  learningDevelopment: BulletList, managerFeedback: BulletList, actions: ActionList,
  privateNotes: z.string().max(10000).optional(),
  presentationSummary: z.string().max(3000).optional(),
  nextMeetingDate: z.string().date().optional(),
});

const ReviewSchema = z.object({
  department: z.string().trim().min(1).max(200),
  unitName: z.string().trim().min(1).max(200),
  reportingPeriod: z.string().date(),
  meetingDate: z.string().date(),
  reportIds: z.array(z.string().uuid()).min(1).max(50),
});

const OneOnOneQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

const LEARNING_TYPES = ['course', 'certification', 'workshop', 'conference', 'mentorship'] as const;
const LEARNING_STATUSES = ['planned', 'in_progress', 'completed', 'paused', 'cancelled'] as const;
const LearningRecordSchema = z.object({
  employeeId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  type: z.enum(LEARNING_TYPES),
  provider: z.string().trim().max(300).optional(),
  skillArea: z.string().trim().max(300).optional(),
  status: z.enum(LEARNING_STATUSES),
  startDate: z.string().date().optional(),
  targetCompletionDate: z.string().date().optional(),
  completionDate: z.string().date().optional(),
  expiryDate: z.string().date().optional(),
  learningHours: z.number().min(0).max(10000),
  evidenceUrl: z.string().url().max(2048).optional(),
  notes: z.string().trim().max(10000).optional(),
});
const LearningQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.enum(LEARNING_STATUSES).optional(),
  type: z.enum(LEARNING_TYPES).optional(),
});
const LearningTimeEntrySchema = z.object({
  loggedDate: z.string().date(),
  hours: z.number().positive().max(24),
  note: z.string().trim().max(1000).optional(),
  source: z.enum(['manual', 'one_on_one']).default('manual'),
});

const ReviewUpdateSchema = z.object({
  status: z.enum(['draft', 'ready', 'presented', 'closed']).optional(),
  department: z.string().trim().min(1).max(200).optional(),
  unitName: z.string().trim().min(1).max(200).optional(),
  meetingDate: z.string().date().nullable().optional(),
  unitHighlights: BulletList.optional(), nextPeriodFocus: BulletList.optional(),
  workingFeedback: BulletList.optional(), challengesSupport: BulletList.optional(),
  decisionsActions: ActionList.optional(), crossTeamDependencies: BulletList.optional(),
  followUps: BulletList.optional(), nextMeetingDate: z.string().date().nullable().optional(),
});

const EntryUpdateSchema = z.object({
  jobTitle: z.string().max(200).optional(), teamUnit: z.string().max(200).optional(),
  tasksAchieved: BulletList.optional(), inProgress: BulletList.optional(), planned: BulletList.optional(),
  oneOnOneSummary: BulletList.optional(), learningDevelopment: BulletList.optional(),
  managerFeedback: BulletList.optional(), ldHours: z.number().min(0).max(1000).optional(),
});

async function systemAdminOnly(req: FastifyRequest, reply: FastifyReply) {
  if (!(req as FastifyRequest & { isSystemAdmin?: boolean }).isSystemAdmin) {
    return reply.code(403).send({ error: 'System administrator access required' });
  }
}

const reviewInclude = {
  presenter: { select: { id: true, name: true, email: true } },
  entries: {
    include: { employee: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

const editorDirectReportWhere = {
  activated: true,
  systemAdmin: false,
  memberships: {
    some: { role: 'editor' },
  },
} as const;

const uniqueBullets = (items: string[]) => [...new Set(items.map(item => item.trim()).filter(Boolean))].slice(0, 20);
const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
const noChallengeStatement = /\b(no|none|nothing|not any)\b.*\b(issue|issues|challenge|challenges|blocker|blockers|concern|concerns)\b/i;
const actionList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is { action: string; owner?: string; dueDate?: string; status?: string } =>
  !!item && typeof item === 'object' && typeof (item as { action?: unknown }).action === 'string'
) : [];

function derivedWrapUp(review: { crossTeamDependencies: unknown; followUps: unknown; decisionsActions: unknown }, challenges: string[]) {
  const openActions = actionList(review.decisionsActions).filter(action => action.status !== 'done');
  return {
    crossTeamDependencies: uniqueBullets([
      ...stringList(review.crossTeamDependencies),
      ...challenges,
    ]),
    followUps: uniqueBullets([
      ...stringList(review.followUps),
      ...openActions.map(action => `Review progress: ${action.action}`),
    ]),
  };
}

function nextMonth(date: Date) {
  const year = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, targetMonth, Math.min(date.getUTCDate(), lastDay)));
}

async function unitSnapshotContent(
  periodStart: Date,
  periodEnd: Date,
  leadId?: string,
  employeeIds: string[] = [],
): Promise<{ highlights: string[]; focus: string[]; workingFeedback: string[]; challengesSupport: string[] }> {
  const period = { gte: periodStart, lt: periodEnd };
  const [testCasesCreated, totalTestCases, defectsIdentified, defectsResolved, defectsFromRuns, criticalProductionDefects, resolvedRecords, resultGroups, priorityDefects, activePlans, activeProjectRows, meetings] = await Promise.all([
    prisma.testCase.count({ where: { createdAt: period, archived: false } }),
    prisma.testCase.count({ where: { archived: false } }),
    prisma.defect.count({ where: { createdAt: period } }),
    prisma.defect.count({ where: { resolvedAt: period, status: { in: ['resolved', 'closed'] } } }),
    prisma.defect.count({ where: { createdAt: period, runResultId: { not: null } } }),
    prisma.defect.count({ where: { createdAt: period, severity: 'critical', detectedEnvironment: 'production' } }),
    prisma.defect.findMany({
      where: { resolvedAt: period, status: { in: ['resolved', 'closed'] } },
      select: { createdAt: true, resolvedAt: true },
    }),
    prisma.runResult.groupBy({
      by: ['status'], where: { executedAt: period, status: { in: ['pass', 'fail'] } }, _count: { id: true },
    }),
    prisma.defect.count({
      where: { createdAt: period, status: { in: ['open', 'in_progress'] }, severity: { in: ['critical', 'high'] } },
    }),
    prisma.testPlan.findMany({
      where: { status: 'active' },
      select: { name: true, milestone: true, endsAt: true, project: { select: { name: true } } },
      orderBy: { endsAt: 'asc' }, take: 3,
    }),
    prisma.activityLog.findMany({
      where: { createdAt: period, projectId: { not: null } },
      select: { projectId: true }, distinct: ['projectId'],
    }),
    leadId && employeeIds.length > 0 ? prisma.leadershipOneOnOne.findMany({
      where: { leadId, reportId: { in: employeeIds }, meetingDate: period },
      select: {
        wins: true, managerFeedback: true, challenges: true,
        report: { select: { name: true } },
      },
      orderBy: { meetingDate: 'desc' },
    }) : Promise.resolve([]),
  ]);
  const activeProjectIds = activeProjectRows.flatMap(row => row.projectId ? [row.projectId] : []);
  const staleCases = activeProjectIds.length > 0
    ? await prisma.coverageSnapshot.count({ where: { state: 'stale', projectId: { in: activeProjectIds } } })
    : 0;
  const pass = resultGroups.find(group => group.status === 'pass')?._count.id ?? 0;
  const fail = resultGroups.find(group => group.status === 'fail')?._count.id ?? 0;
  const passRate = pass + fail > 0 ? Math.round(pass / (pass + fail) * 100) : null;
  const detectionRate = defectsIdentified > 0 ? Math.round(defectsFromRuns / defectsIdentified * 100) : null;
  const resolutionHours = resolvedRecords.length > 0
    ? Math.round(resolvedRecords.reduce((sum, defect) => sum + (defect.resolvedAt?.getTime() ?? defect.createdAt.getTime()) - defect.createdAt.getTime(), 0)
      / resolvedRecords.length / 3_600_000 * 10) / 10
    : null;
  const positiveKpis = [
    ...(passRate !== null && passRate >= 90 ? [`${passRate}% regression pass rate`] : []),
    ...(detectionRate !== null && detectionRate >= 85 ? [`${detectionRate}% defect detection rate`] : []),
    ...(resolutionHours !== null && resolutionHours <= 24 ? [`${resolutionHours}h average defect resolution`] : []),
    ...(criticalProductionDefects === 0 ? ['zero critical production escapes'] : []),
  ];
  const kpiShortfalls = [
    ...(criticalProductionDefects > 0 ? [`Prevent recurrence and close corrective actions for ${criticalProductionDefects} critical production escape${criticalProductionDefects === 1 ? '' : 's'}`] : []),
    ...(passRate !== null && passRate < 90 ? [`Raise regression pass rate from ${passRate}% to the 90% target`] : []),
    ...(detectionRate !== null && detectionRate < 85 ? [`Improve defect detection rate from ${detectionRate}% to at least 85%`] : []),
    ...(resolutionHours !== null && resolutionHours > 24 ? [`Reduce average defect resolution from ${resolutionHours} hours to 24 hours or less`] : []),
    ...(staleCases > 0 ? [`Review and update ${staleCases} stale test case${staleCases === 1 ? '' : 's'} across active projects`] : []),
    ...(priorityDefects > 0 ? [`Resolve ${priorityDefects} open critical/high-severity defect${priorityDefects === 1 ? '' : 's'}`] : []),
  ];
  const focus = [
    ...kpiShortfalls,
    ...activePlans.map(plan => `Deliver ${plan.name}${plan.milestone ? ` — ${plan.milestone}` : ''} (${plan.project.name})`),
  ];
  const positiveFeedback = /\b(strong|excellent|good|great|consistent|dedicated|ownership|attention to detail|improved|successful|successfully|commendable|reliable|quality)\b/i;
  const meetingWins = meetings.flatMap(meeting => stringList(meeting.wins).map(item => `${meeting.report.name}: ${item}`));
  const recognisedFeedback = meetings.flatMap(meeting => stringList(meeting.managerFeedback)
    .filter(item => positiveFeedback.test(item))
    .map(item => `${meeting.report.name}: ${item}`));
  const recordedChallenges = meetings.flatMap(meeting => stringList(meeting.challenges)
    .filter(item => !noChallengeStatement.test(item))
    .map(item => `${meeting.report.name}: ${item}`));
  return {
    highlights: [
      `${testCasesCreated} test case${testCasesCreated === 1 ? '' : 's'} created this period, making the overall total ${totalTestCases}`,
      `${defectsIdentified} defect${defectsIdentified === 1 ? '' : 's'} identified; ${defectsResolved} resolved`,
      ...(positiveKpis.length ? [`Positive KPIs: ${positiveKpis.join(' · ')}`] : []),
    ],
    focus,
    workingFeedback: uniqueBullets([
      ...(positiveKpis.length ? [`Positive KPIs: ${positiveKpis.join(' · ')}`] : []),
      ...meetingWins,
      ...recognisedFeedback,
    ]),
    challengesSupport: uniqueBullets([...recordedChallenges, ...kpiShortfalls]),
  };
}

async function withTrackedLearning<T extends {
  reportingPeriod: Date;
  entries: Array<{ employeeId: string; learningDevelopment: unknown; ldHours: number }>;
}>(review: T, userId: string): Promise<T> {
  const periodEnd = nextMonth(review.reportingPeriod);
  const records = await prisma.leadershipLearningRecord.findMany({
    where: { createdById: userId, employeeId: { in: review.entries.map(entry => entry.employeeId) } },
    select: {
      employeeId: true, title: true, provider: true, status: true, completionDate: true, learningHours: true,
      timeEntries: { where: { loggedDate: { gte: review.reportingPeriod, lt: periodEnd } }, select: { hours: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  const recordsByEmployee = new Map<string, typeof records>();
  records.forEach(record => recordsByEmployee.set(record.employeeId, [...(recordsByEmployee.get(record.employeeId) ?? []), record]));
  return {
    ...review,
    entries: review.entries.map(entry => {
      const employeeRecords = recordsByEmployee.get(entry.employeeId) ?? [];
      const periodRecords = employeeRecords.filter(record => ['planned', 'in_progress'].includes(record.status)
        || (record.completionDate && record.completionDate >= review.reportingPeriod && record.completionDate < periodEnd));
      return {
        ...entry,
        learningDevelopment: uniqueBullets(periodRecords.map(record => `${record.title}${record.provider ? ` — ${record.provider}` : ''} (${record.status.replace('_', ' ')})`)),
        ldHours: employeeRecords.reduce((sum, record) => sum
          + record.timeEntries.reduce((entrySum, entry) => entrySum + entry.hours, 0), 0),
      };
    }),
  } as T;
}

const activityLabel: Record<string, string> = {
  case_created: 'Created test case',
  defect_filed: 'Filed defect',
  defects_bulk_imported: 'Imported defects',
  plan_created: 'Created test plan',
  run_started: 'Started test run',
  exploratory_session_started: 'Started exploratory session',
  run_closed: 'Completed test run',
};

export const leadershipRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', systemAdminOnly);

  app.get('/users', async () => ({
    users: await prisma.user.findMany({
      where: editorDirectReportWhere, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' },
    }),
  }));

  app.get('/one-on-ones', async req => {
    const { userId } = req.user as { userId: string };
    const query = OneOnOneQuerySchema.parse(req.query);
    return {
      meetings: await prisma.leadershipOneOnOne.findMany({
        where: {
          leadId: userId,
          ...((query.from || query.to) && {
            meetingDate: {
              ...(query.from && { gte: new Date(query.from) }),
              ...(query.to && { lte: new Date(query.to) }),
            },
          }),
        },
        include: { report: { select: { id: true, name: true, email: true } } },
        orderBy: { meetingDate: 'desc' },
      }),
    };
  });

  app.post('/one-on-ones', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const body = OneOnOneSchema.parse(req.body);
    const today = new Date().toISOString().slice(0, 10);
    if (body.meetingDate > today) return reply.code(400).send({ error: 'Meeting date cannot be in the future' });
    const meetingDate = new Date(body.meetingDate);
    const defaultNextMeetingDate = new Date(meetingDate);
    defaultNextMeetingDate.setUTCDate(defaultNextMeetingDate.getUTCDate() + 14);
    const report = await prisma.user.findFirst({ where: { id: body.reportId, ...editorDirectReportWhere } });
    if (!report) return reply.code(400).send({ error: 'Direct report must be an activated editor' });
    const meeting = await prisma.leadershipOneOnOne.create({
      data: {
        leadId: userId, reportId: body.reportId, meetingDate,
        wins: body.wins, discussionPoints: body.discussionPoints, challenges: body.challenges,
        learningDevelopment: body.learningDevelopment, managerFeedback: body.managerFeedback,
        actions: body.actions, privateNotes: body.privateNotes?.trim() || null,
        presentationSummary: body.presentationSummary?.trim() || null,
        nextMeetingDate: body.nextMeetingDate ? new Date(body.nextMeetingDate) : defaultNextMeetingDate,
      },
      include: { report: { select: { id: true, name: true, email: true } } },
    });
    return reply.code(201).send(meeting);
  });

  app.get('/one-on-ones/:meetingId', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { meetingId } = req.params as { meetingId: string };
    const meeting = await prisma.leadershipOneOnOne.findFirst({
      where: { id: meetingId, leadId: userId },
      include: { report: { select: { id: true, name: true, email: true } } },
    });
    if (!meeting) return reply.code(404).send({ error: 'One-on-one not found' });
    return meeting;
  });

  app.patch('/one-on-ones/:meetingId', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { meetingId } = req.params as { meetingId: string };
    const body = OneOnOneSchema.parse(req.body);
    const today = new Date().toISOString().slice(0, 10);
    if (body.meetingDate > today) return reply.code(400).send({ error: 'Meeting date cannot be in the future' });
    const existing = await prisma.leadershipOneOnOne.findFirst({ where: { id: meetingId, leadId: userId } });
    if (!existing) return reply.code(404).send({ error: 'One-on-one not found' });
    const report = await prisma.user.findFirst({ where: { id: body.reportId, ...editorDirectReportWhere } });
    if (!report) return reply.code(400).send({ error: 'Direct report must be an activated editor' });
    return prisma.leadershipOneOnOne.update({
      where: { id: meetingId },
      data: {
        reportId: body.reportId, meetingDate: new Date(body.meetingDate),
        wins: body.wins, discussionPoints: body.discussionPoints, challenges: body.challenges,
        learningDevelopment: body.learningDevelopment, managerFeedback: body.managerFeedback,
        actions: body.actions, privateNotes: body.privateNotes?.trim() || null,
        presentationSummary: body.presentationSummary?.trim() || null,
        nextMeetingDate: body.nextMeetingDate ? new Date(body.nextMeetingDate) : null,
      },
      include: { report: { select: { id: true, name: true, email: true } } },
    });
  });

  app.delete('/one-on-ones/:meetingId', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { meetingId } = req.params as { meetingId: string };
    const existing = await prisma.leadershipOneOnOne.findFirst({ where: { id: meetingId, leadId: userId }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: 'One-on-one not found' });
    await prisma.leadershipOneOnOne.delete({ where: { id: meetingId } });
    return reply.code(204).send();
  });

  app.get('/learning-records', async req => {
    const { userId } = req.user as { userId: string };
    const query = LearningQuerySchema.parse(req.query);
    return {
      records: await prisma.leadershipLearningRecord.findMany({
        where: { createdById: userId, ...(query.employeeId && { employeeId: query.employeeId }), ...(query.status && { status: query.status }), ...(query.type && { type: query.type }) },
        include: {
          employee: { select: { id: true, name: true, email: true } },
          timeEntries: { orderBy: [{ loggedDate: 'desc' }, { createdAt: 'desc' }] },
        },
        orderBy: [{ status: 'asc' }, { targetCompletionDate: 'asc' }, { createdAt: 'desc' }],
      }),
    };
  });

  app.get('/learning-records/:recordId', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { recordId } = req.params as { recordId: string };
    const record = await prisma.leadershipLearningRecord.findFirst({ where: { id: recordId, createdById: userId }, include: { employee: { select: { id: true, name: true, email: true } }, timeEntries: { orderBy: [{ loggedDate: 'desc' }, { createdAt: 'desc' }] } } });
    if (!record) return reply.code(404).send({ error: 'Learning record not found' });
    return record;
  });

  app.post('/learning-records', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const body = LearningRecordSchema.parse(req.body);
    const employee = await prisma.user.findFirst({ where: { id: body.employeeId, ...editorDirectReportWhere }, select: { id: true } });
    if (!employee) return reply.code(400).send({ error: 'L&D records can only be created for activated editors' });
    const record = await prisma.leadershipLearningRecord.create({
      data: {
        createdById: userId, employeeId: body.employeeId, title: body.title, type: body.type,
        provider: body.provider || null, skillArea: body.skillArea || null, status: body.status,
        startDate: body.startDate ? new Date(body.startDate) : null,
        targetCompletionDate: body.targetCompletionDate ? new Date(body.targetCompletionDate) : null,
        completionDate: body.completionDate ? new Date(body.completionDate) : null,
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        learningHours: body.learningHours, evidenceUrl: body.evidenceUrl || null, notes: body.notes || null,
      },
      include: { employee: { select: { id: true, name: true, email: true } }, timeEntries: true },
    });
    return reply.code(201).send(record);
  });

  app.patch('/learning-records/:recordId', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { recordId } = req.params as { recordId: string };
    const body = LearningRecordSchema.parse(req.body);
    const existing = await prisma.leadershipLearningRecord.findFirst({ where: { id: recordId, createdById: userId }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: 'Learning record not found' });
    const employee = await prisma.user.findFirst({ where: { id: body.employeeId, ...editorDirectReportWhere }, select: { id: true } });
    if (!employee) return reply.code(400).send({ error: 'L&D records can only be created for activated editors' });
    return prisma.leadershipLearningRecord.update({
      where: { id: recordId },
      data: {
        employeeId: body.employeeId, title: body.title, type: body.type, provider: body.provider || null,
        skillArea: body.skillArea || null, status: body.status,
        startDate: body.startDate ? new Date(body.startDate) : null,
        targetCompletionDate: body.targetCompletionDate ? new Date(body.targetCompletionDate) : null,
        completionDate: body.completionDate ? new Date(body.completionDate) : null,
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        learningHours: body.learningHours, evidenceUrl: body.evidenceUrl || null, notes: body.notes || null,
      },
      include: { employee: { select: { id: true, name: true, email: true } }, timeEntries: { orderBy: [{ loggedDate: 'desc' }, { createdAt: 'desc' }] } },
    });
  });

  app.delete('/learning-records/:recordId', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { recordId } = req.params as { recordId: string };
    const existing = await prisma.leadershipLearningRecord.findFirst({ where: { id: recordId, createdById: userId }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: 'Learning record not found' });
    await prisma.leadershipLearningRecord.delete({ where: { id: recordId } });
    return reply.code(204).send();
  });

  app.post('/learning-records/:recordId/time-entries', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { recordId } = req.params as { recordId: string };
    const body = LearningTimeEntrySchema.parse(req.body);
    if (body.loggedDate > new Date().toISOString().slice(0, 10)) {
      return reply.code(400).send({ error: 'Learning date cannot be in the future' });
    }
    const record = await prisma.leadershipLearningRecord.findFirst({ where: { id: recordId, createdById: userId }, select: { id: true } });
    if (!record) return reply.code(404).send({ error: 'L&D record not found' });
    const entry = await prisma.leadershipLearningTimeEntry.create({
      data: { learningRecordId: recordId, loggedDate: new Date(body.loggedDate), hours: body.hours, note: body.note || null, source: body.source },
    });
    return reply.code(201).send(entry);
  });

  app.delete('/learning-time-entries/:entryId', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { entryId } = req.params as { entryId: string };
    const entry = await prisma.leadershipLearningTimeEntry.findFirst({
      where: { id: entryId, learningRecord: { createdById: userId } }, select: { id: true },
    });
    if (!entry) return reply.code(404).send({ error: 'L&D time entry not found' });
    await prisma.leadershipLearningTimeEntry.delete({ where: { id: entryId } });
    return reply.code(204).send();
  });

  app.get('/reviews', async req => {
    const { userId } = req.user as { userId: string };
    return {
      reviews: await prisma.leadershipReview.findMany({
        where: { presenterId: userId }, include: { _count: { select: { entries: true } } }, orderBy: { reportingPeriod: 'desc' },
      }),
    };
  });

  app.post('/reviews', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const body = ReviewSchema.parse(req.body);
    const users = await prisma.user.findMany({ where: { id: { in: body.reportIds }, ...editorDirectReportWhere }, select: { id: true, name: true } });
    if (users.length !== new Set(body.reportIds).size) return reply.code(400).send({ error: 'All direct reports must be activated editors' });
    const periodStart = new Date(body.reportingPeriod);
    const periodEnd = nextMonth(periodStart);
    const [meetings, latestMeetings, activities, activePlans, learningRecords] = await Promise.all([
      prisma.leadershipOneOnOne.findMany({
        where: { leadId: userId, reportId: { in: body.reportIds }, meetingDate: { gte: periodStart, lt: periodEnd } },
        orderBy: { meetingDate: 'desc' },
      }),
      prisma.leadershipOneOnOne.groupBy({
        by: ['reportId'],
        where: { leadId: userId, reportId: { in: body.reportIds } },
        _max: { meetingDate: true },
      }),
      prisma.activityLog.findMany({
        where: { userId: { in: body.reportIds }, createdAt: { gte: periodStart, lt: periodEnd }, action: { in: Object.keys(activityLabel) } },
        orderBy: { createdAt: 'desc' }, take: 100,
      }),
      prisma.testPlan.findMany({
        where: { createdById: { in: body.reportIds }, status: 'active' },
        select: { name: true, milestone: true, endsAt: true, createdById: true, project: { select: { name: true } } },
        orderBy: { endsAt: 'asc' }, take: 50,
      }),
      prisma.leadershipLearningRecord.findMany({
        where: { createdById: userId, employeeId: { in: body.reportIds } },
        include: { timeEntries: { where: { loggedDate: { gte: periodStart, lt: periodEnd } }, select: { hours: true } } },
        orderBy: { updatedAt: 'desc' }, take: 200,
      }),
    ]);
    const userById = new Map(users.map(user => [user.id, user]));
    const activitiesByUser = new Map<string, typeof activities>();
    activities.forEach(activity => activitiesByUser.set(activity.userId, [...(activitiesByUser.get(activity.userId) ?? []), activity]));
    const meetingsByUser = new Map<string, typeof meetings>();
    meetings.forEach(meeting => meetingsByUser.set(meeting.reportId, [...(meetingsByUser.get(meeting.reportId) ?? []), meeting]));
    const latestMeetingByUser = new Map(latestMeetings.map(meeting => [meeting.reportId, meeting._max.meetingDate]));
    const plansByUser = new Map<string, typeof activePlans>();
    activePlans.forEach(plan => plansByUser.set(plan.createdById, [...(plansByUser.get(plan.createdById) ?? []), plan]));
    const learningByUser = new Map<string, typeof learningRecords>();
    learningRecords.forEach(record => learningByUser.set(record.employeeId, [...(learningByUser.get(record.employeeId) ?? []), record]));
    const describeActivity = (activity: typeof activities[number]) => `${activityLabel[activity.action] ?? activity.action}${activity.entityName ? `: ${activity.entityName}` : ''}${activity.projectName ? ` (${activity.projectName})` : ''}`;
    const describeLearning = (record: typeof learningRecords[number]) => `${record.title}${record.provider ? ` — ${record.provider}` : ''} (${record.status.replace('_', ' ')})`;
    const unitHighlights = uniqueBullets(users.flatMap(user => [
      ...(meetingsByUser.get(user.id) ?? []).flatMap(meeting => stringList(meeting.wins).map(win => `${user.name}: ${win}`)),
      ...(activitiesByUser.get(user.id) ?? []).map(activity => `${user.name}: ${describeActivity(activity)}`),
      ...(learningByUser.get(user.id) ?? []).filter(record => record.status === 'completed' && record.completionDate && record.completionDate >= periodStart && record.completionDate < periodEnd).map(record => `${user.name}: completed ${record.title}`),
    ]));
    const nextPeriodFocus = uniqueBullets([
      ...activePlans.map(plan => `${userById.get(plan.createdById)?.name ?? 'Team'}: ${plan.name}${plan.milestone ? ` — ${plan.milestone}` : ''} (${plan.project.name})`),
      ...users.flatMap(user => (learningByUser.get(user.id) ?? []).filter(record => ['planned', 'in_progress'].includes(record.status)).map(record => `${user.name}: ${describeLearning(record)}`)),
    ]);
    const workingFeedback = uniqueBullets(users.flatMap(user => (meetingsByUser.get(user.id) ?? []).flatMap(meeting => stringList(meeting.managerFeedback).map(item => `${user.name}: ${item}`))));
    const challengesSupport = uniqueBullets(users.flatMap(user => (meetingsByUser.get(user.id) ?? []).flatMap(meeting => stringList(meeting.challenges).map(item => `${user.name}: ${item}`))));
    const decisionsActions = meetings.flatMap(meeting => actionList(meeting.actions).filter(action => action.status !== 'done').map(action => ({ ...action, owner: action.owner || userById.get(meeting.reportId)?.name, status: action.status === 'done' ? 'done' as const : 'open' as const }))).slice(0, 30);
    const followUps = uniqueBullets(users.flatMap(user => (meetingsByUser.get(user.id) ?? []).flatMap(meeting => [
      ...actionList(meeting.actions).filter(action => action.status !== 'done').map(action => `${user.name}: ${action.action}`),
      ...(meeting.nextMeetingDate ? [`${user.name}: next 1:1 on ${meeting.nextMeetingDate.toISOString().slice(0, 10)}`] : []),
    ])));
    const meetingDate = new Date(body.meetingDate);
    const suggestedNextMeetingDate = nextMonth(meetingDate);
    const review = await prisma.leadershipReview.create({
      data: {
        presenterId: userId, department: body.department, unitName: body.unitName,
        reportingPeriod: new Date(body.reportingPeriod), meetingDate,
        unitHighlights, nextPeriodFocus, workingFeedback, challengesSupport, decisionsActions, followUps,
        nextMeetingDate: suggestedNextMeetingDate,
        entries: { create: users.map(user => {
          const userMeetings = meetingsByUser.get(user.id) ?? [];
          const userActivities = activitiesByUser.get(user.id) ?? [];
          const userPlans = plansByUser.get(user.id) ?? [];
          const userLearning = learningByUser.get(user.id) ?? [];
          const latestMeetingDate = latestMeetingByUser.get(user.id);
          const periodLearning = userLearning.filter(record => ['planned', 'in_progress'].includes(record.status) || (record.completionDate && record.completionDate >= periodStart && record.completionDate < periodEnd));
          return {
            employeeId: user.id, teamUnit: body.unitName,
            tasksAchieved: uniqueBullets([
              ...userMeetings.flatMap(meeting => stringList(meeting.wins)),
              ...userActivities.map(describeActivity),
            ]),
            inProgress: uniqueBullets(userPlans.map(plan => `${plan.name}${plan.milestone ? ` — ${plan.milestone}` : ''}${plan.endsAt ? ` · due ${plan.endsAt.toISOString().slice(0, 10)}` : ''}`)),
            oneOnOneSummary: uniqueBullets([
              ...(latestMeetingDate ? [`Last 1:1: ${latestMeetingDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`] : []),
              ...userMeetings.flatMap(meeting => meeting.presentationSummary ? [meeting.presentationSummary] : stringList(meeting.discussionPoints)),
            ]),
            learningDevelopment: uniqueBullets([
              ...periodLearning.map(describeLearning),
            ]),
            managerFeedback: uniqueBullets(userMeetings.flatMap(meeting => stringList(meeting.managerFeedback))),
            ldHours: userLearning.reduce((sum, record) => sum
              + record.timeEntries.reduce((entrySum, entry) => entrySum + entry.hours, 0), 0),
          };
        }) },
      },
      include: reviewInclude,
    });
    return reply.code(201).send(review);
  });

  app.get('/reviews/:reviewId', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { reviewId } = req.params as { reviewId: string };
    const review = await prisma.leadershipReview.findFirst({ where: { id: reviewId, presenterId: userId }, include: reviewInclude });
    if (!review) return reply.code(404).send({ error: 'Review not found' });
    const [reviewWithLearning, snapshotContent] = await Promise.all([
      withTrackedLearning(review, userId),
      unitSnapshotContent(review.reportingPeriod, nextMonth(review.reportingPeriod), userId, review.entries.map(entry => entry.employeeId)),
    ]);
    const workingFeedback = uniqueBullets([...stringList(reviewWithLearning.workingFeedback), ...snapshotContent.workingFeedback]);
    const challengesSupport = uniqueBullets([
      ...stringList(reviewWithLearning.challengesSupport).filter(item => !noChallengeStatement.test(item)),
      ...snapshotContent.challengesSupport,
    ]);
    const wrapUp = derivedWrapUp(reviewWithLearning, challengesSupport);
    return {
      ...reviewWithLearning,
      unitHighlights: snapshotContent.highlights,
      nextPeriodFocus: snapshotContent.focus,
      workingFeedback,
      challengesSupport,
      crossTeamDependencies: wrapUp.crossTeamDependencies,
      followUps: wrapUp.followUps,
    };
  });

  app.post('/reviews/:reviewId/entries/:entryId/ai-draft', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { reviewId, entryId } = req.params as { reviewId: string; entryId: string };
    const review = await prisma.leadershipReview.findFirst({
      where: { id: reviewId, presenterId: userId },
      include: { entries: { where: { id: entryId }, include: { employee: { select: { name: true } } } } },
    });
    const entry = review?.entries[0];
    if (!review || !entry) return reply.code(404).send({ error: 'Leadership review entry not found' });

    const periodStart = review.reportingPeriod;
    const periodEnd = nextMonth(periodStart);
    const inPeriod = { gte: periodStart, lt: periodEnd };
    const [activities, meetings, learningRecords, plans] = await Promise.all([
      prisma.activityLog.findMany({
        where: { userId: entry.employeeId, createdAt: inPeriod, action: { in: Object.keys(activityLabel) } },
        select: { createdAt: true, action: true, entityName: true, projectName: true },
        orderBy: { createdAt: 'asc' }, take: 100,
      }),
      prisma.leadershipOneOnOne.findMany({
        where: { leadId: userId, reportId: entry.employeeId, meetingDate: inPeriod },
        select: { meetingDate: true, wins: true, discussionPoints: true, challenges: true, managerFeedback: true, presentationSummary: true },
        orderBy: { meetingDate: 'asc' }, take: 10,
      }),
      prisma.leadershipLearningRecord.findMany({
        where: {
          createdById: userId, employeeId: entry.employeeId,
          OR: [
            { createdAt: inPeriod }, { updatedAt: inPeriod }, { startDate: inPeriod },
            { targetCompletionDate: inPeriod }, { completionDate: inPeriod },
          ],
        },
        select: {
          title: true, type: true, provider: true, skillArea: true, status: true, startDate: true,
          targetCompletionDate: true, completionDate: true, learningHours: true,
          timeEntries: { where: { loggedDate: inPeriod }, select: { hours: true } },
        },
        orderBy: { updatedAt: 'desc' }, take: 50,
      }),
      prisma.testPlan.findMany({
        where: { createdById: entry.employeeId, OR: [{ createdAt: inPeriod }, { updatedAt: inPeriod }] },
        select: { name: true, milestone: true, status: true, endsAt: true, project: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' }, take: 30,
      }),
    ]);
    const periodLastDay = new Date(periodEnd);
    periodLastDay.setUTCDate(periodLastDay.getUTCDate() - 1);

    try {
      const draft = await draftLeadershipEntry({
        reportingPeriod: { from: periodStart.toISOString().slice(0, 10), to: periodLastDay.toISOString().slice(0, 10) },
        employee: { name: entry.employee.name, jobTitle: entry.jobTitle, teamUnit: entry.teamUnit },
        activities: activities.map(activity => ({
          date: activity.createdAt.toISOString(),
          action: activityLabel[activity.action] ?? activity.action,
          item: activity.entityName,
          project: activity.projectName,
        })),
        oneOnOnes: meetings.map(meeting => ({
          date: meeting.meetingDate.toISOString().slice(0, 10),
          wins: stringList(meeting.wins),
          discussionPoints: stringList(meeting.discussionPoints),
          challenges: stringList(meeting.challenges),
          managerFeedback: stringList(meeting.managerFeedback),
          presentationSummary: meeting.presentationSummary,
        })),
        learningTracker: learningRecords.map(record => ({
          title: record.title, type: record.type, provider: record.provider, skillArea: record.skillArea,
          status: record.status, startDate: record.startDate?.toISOString().slice(0, 10),
          targetCompletionDate: record.targetCompletionDate?.toISOString().slice(0, 10),
          completionDate: record.completionDate?.toISOString().slice(0, 10),
          learningHours: record.timeEntries.reduce((sum, entry) => sum + entry.hours, 0),
        })),
        plans: plans.map(plan => ({
          name: plan.name, project: plan.project.name, milestone: plan.milestone,
          status: plan.status, endDate: plan.endsAt?.toISOString().slice(0, 10),
        })),
      }, userId);
      return { draft, reportingPeriod: { from: periodStart, to: periodLastDay } };
    } catch (error) {
      req.log.error({ err: error, reviewId, entryId }, 'Leadership AI draft failed');
      const message = error instanceof Error ? error.message : 'AI drafting failed';
      return reply.code(message.startsWith('OpenAI is not configured') ? 503 : 502).send({ error: message });
    }
  });

  app.get('/reviews/:reviewId/export/pptx', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { reviewId } = req.params as { reviewId: string };
    const review = await prisma.leadershipReview.findFirst({ where: { id: reviewId, presenterId: userId }, include: reviewInclude });
    if (!review) return reply.code(404).send({ error: 'Review not found' });
    const [oneOnOneCount, reviewWithLearning, snapshotContent] = await Promise.all([
      prisma.leadershipOneOnOne.count({
      where: {
        leadId: userId,
        reportId: { in: review.entries.map(entry => entry.employeeId) },
        meetingDate: { gte: review.reportingPeriod, lt: nextMonth(review.reportingPeriod) },
      },
      }),
      withTrackedLearning(review, userId),
      unitSnapshotContent(review.reportingPeriod, nextMonth(review.reportingPeriod), userId, review.entries.map(entry => entry.employeeId)),
    ]);
    const workingFeedback = uniqueBullets([...stringList(reviewWithLearning.workingFeedback), ...snapshotContent.workingFeedback]);
    const challengesSupport = uniqueBullets([
      ...stringList(reviewWithLearning.challengesSupport).filter(item => !noChallengeStatement.test(item)),
      ...snapshotContent.challengesSupport,
    ]);
    const wrapUp = derivedWrapUp(reviewWithLearning, challengesSupport);
    const buffer = await buildLeadershipDeck({
      ...reviewWithLearning,
      unitHighlights: snapshotContent.highlights,
      nextPeriodFocus: snapshotContent.focus,
      workingFeedback,
      challengesSupport,
      crossTeamDependencies: wrapUp.crossTeamDependencies,
      followUps: wrapUp.followUps,
      oneOnOneCount,
    });
    const period = review.reportingPeriod.toISOString().slice(0, 7);
    const safeUnit = review.unitName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    reply.header('Content-Disposition', `attachment; filename="leadership-review-${safeUnit}-${period}.pptx"`);
    return reply.send(buffer);
  });

  app.patch('/reviews/:reviewId', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { reviewId } = req.params as { reviewId: string };
    const body = ReviewUpdateSchema.parse(req.body);
    const existing = await prisma.leadershipReview.findFirst({ where: { id: reviewId, presenterId: userId } });
    if (!existing) return reply.code(404).send({ error: 'Review not found' });
    const nextMeetingDate = body.nextMeetingDate !== undefined
      ? (body.nextMeetingDate ? new Date(body.nextMeetingDate) : null)
      : body.meetingDate
        ? nextMonth(new Date(body.meetingDate))
        : undefined;
    return prisma.leadershipReview.update({
      where: { id: reviewId },
      data: {
        ...body,
        ...(body.meetingDate !== undefined && { meetingDate: body.meetingDate ? new Date(body.meetingDate) : null }),
        ...(nextMeetingDate !== undefined && { nextMeetingDate }),
      },
      include: reviewInclude,
    });
  });

  app.patch('/reviews/:reviewId/entries/:entryId', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { reviewId, entryId } = req.params as { reviewId: string; entryId: string };
    const body = EntryUpdateSchema.parse(req.body);
    const review = await prisma.leadershipReview.findFirst({ where: { id: reviewId, presenterId: userId } });
    if (!review) return reply.code(404).send({ error: 'Review not found' });
    const entry = await prisma.leadershipReviewEntry.findFirst({ where: { id: entryId, reviewId } });
    if (!entry) return reply.code(404).send({ error: 'Direct-report entry not found' });
    return prisma.leadershipReviewEntry.update({
      where: { id: entryId }, data: body,
      include: { employee: { select: { id: true, name: true, email: true } } },
    });
  });
};
