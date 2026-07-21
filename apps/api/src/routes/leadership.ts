import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { buildLeadershipDeck } from '../services/leadershipPptx.js';

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
  meetingDate: z.string().date().optional(),
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
const actionList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is { action: string; owner?: string; dueDate?: string; status?: string } =>
  !!item && typeof item === 'object' && typeof (item as { action?: unknown }).action === 'string'
) : [];

function nextMonth(date: Date) {
  const year = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, targetMonth, Math.min(date.getUTCDate(), lastDay)));
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
        include: { employee: { select: { id: true, name: true, email: true } } },
        orderBy: [{ status: 'asc' }, { targetCompletionDate: 'asc' }, { createdAt: 'desc' }],
      }),
    };
  });

  app.get('/learning-records/:recordId', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { recordId } = req.params as { recordId: string };
    const record = await prisma.leadershipLearningRecord.findFirst({ where: { id: recordId, createdById: userId }, include: { employee: { select: { id: true, name: true, email: true } } } });
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
      include: { employee: { select: { id: true, name: true, email: true } } },
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
      include: { employee: { select: { id: true, name: true, email: true } } },
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
    const [meetings, activities, activePlans, learningRecords] = await Promise.all([
      prisma.leadershipOneOnOne.findMany({
        where: { leadId: userId, reportId: { in: body.reportIds }, meetingDate: { gte: periodStart, lt: periodEnd } },
        orderBy: { meetingDate: 'desc' },
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
        orderBy: { updatedAt: 'desc' }, take: 200,
      }),
    ]);
    const userById = new Map(users.map(user => [user.id, user]));
    const activitiesByUser = new Map<string, typeof activities>();
    activities.forEach(activity => activitiesByUser.set(activity.userId, [...(activitiesByUser.get(activity.userId) ?? []), activity]));
    const meetingsByUser = new Map<string, typeof meetings>();
    meetings.forEach(meeting => meetingsByUser.set(meeting.reportId, [...(meetingsByUser.get(meeting.reportId) ?? []), meeting]));
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
    const suggestedNextMeetingDate = nextMonth(body.meetingDate ? new Date(body.meetingDate) : periodStart);
    const review = await prisma.leadershipReview.create({
      data: {
        presenterId: userId, department: body.department, unitName: body.unitName,
        reportingPeriod: new Date(body.reportingPeriod), meetingDate: body.meetingDate ? new Date(body.meetingDate) : null,
        unitHighlights, nextPeriodFocus, workingFeedback, challengesSupport, decisionsActions, followUps,
        nextMeetingDate: suggestedNextMeetingDate,
        entries: { create: users.map(user => {
          const userMeetings = meetingsByUser.get(user.id) ?? [];
          const userActivities = activitiesByUser.get(user.id) ?? [];
          const userPlans = plansByUser.get(user.id) ?? [];
          const userLearning = learningByUser.get(user.id) ?? [];
          const periodLearning = userLearning.filter(record => ['planned', 'in_progress'].includes(record.status) || (record.completionDate && record.completionDate >= periodStart && record.completionDate < periodEnd));
          return {
            employeeId: user.id, teamUnit: body.unitName,
            tasksAchieved: uniqueBullets([
              ...userMeetings.flatMap(meeting => stringList(meeting.wins)),
              ...userActivities.map(describeActivity),
            ]),
            inProgress: uniqueBullets(userPlans.map(plan => `${plan.name}${plan.milestone ? ` — ${plan.milestone}` : ''}${plan.endsAt ? ` · due ${plan.endsAt.toISOString().slice(0, 10)}` : ''}`)),
            oneOnOneSummary: uniqueBullets(userMeetings.flatMap(meeting => meeting.presentationSummary ? [meeting.presentationSummary] : stringList(meeting.discussionPoints))),
            learningDevelopment: uniqueBullets([
              ...periodLearning.map(describeLearning),
              ...userMeetings.flatMap(meeting => stringList(meeting.learningDevelopment)),
            ]),
            managerFeedback: uniqueBullets(userMeetings.flatMap(meeting => stringList(meeting.managerFeedback))),
            ldHours: userLearning.filter(record => record.status === 'completed' && record.completionDate && record.completionDate >= periodStart && record.completionDate < periodEnd).reduce((sum, record) => sum + record.learningHours, 0),
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
    return review;
  });

  app.get('/reviews/:reviewId/export/pptx', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { reviewId } = req.params as { reviewId: string };
    const review = await prisma.leadershipReview.findFirst({ where: { id: reviewId, presenterId: userId }, include: reviewInclude });
    if (!review) return reply.code(404).send({ error: 'Review not found' });
    const buffer = await buildLeadershipDeck(review);
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
    return prisma.leadershipReview.update({
      where: { id: reviewId },
      data: {
        ...body,
        ...(body.meetingDate !== undefined && { meetingDate: body.meetingDate ? new Date(body.meetingDate) : null }),
        ...(body.nextMeetingDate !== undefined && { nextMeetingDate: body.nextMeetingDate ? new Date(body.nextMeetingDate) : null }),
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
