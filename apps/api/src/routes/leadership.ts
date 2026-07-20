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

function systemAdminOnly(req: FastifyRequest, reply: FastifyReply) {
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

export const leadershipRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', systemAdminOnly);

  app.get('/users', async () => ({
    users: await prisma.user.findMany({
      where: { activated: true }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' },
    }),
  }));

  app.get('/one-on-ones', async req => {
    const { userId } = req.user as { userId: string };
    return {
      meetings: await prisma.leadershipOneOnOne.findMany({
        where: { leadId: userId },
        include: { report: { select: { id: true, name: true, email: true } } },
        orderBy: { meetingDate: 'desc' },
      }),
    };
  });

  app.post('/one-on-ones', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const body = OneOnOneSchema.parse(req.body);
    const report = await prisma.user.findFirst({ where: { id: body.reportId, activated: true } });
    if (!report) return reply.code(404).send({ error: 'Selected user not found' });
    const meeting = await prisma.leadershipOneOnOne.create({
      data: {
        leadId: userId, reportId: body.reportId, meetingDate: new Date(body.meetingDate),
        wins: body.wins, discussionPoints: body.discussionPoints, challenges: body.challenges,
        learningDevelopment: body.learningDevelopment, managerFeedback: body.managerFeedback,
        actions: body.actions, privateNotes: body.privateNotes?.trim() || null,
        presentationSummary: body.presentationSummary?.trim() || null,
        nextMeetingDate: body.nextMeetingDate ? new Date(body.nextMeetingDate) : null,
      },
      include: { report: { select: { id: true, name: true, email: true } } },
    });
    return reply.code(201).send(meeting);
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
    const users = await prisma.user.findMany({ where: { id: { in: body.reportIds }, activated: true }, select: { id: true } });
    if (users.length !== new Set(body.reportIds).size) return reply.code(400).send({ error: 'One or more selected users are invalid' });
    const review = await prisma.leadershipReview.create({
      data: {
        presenterId: userId, department: body.department, unitName: body.unitName,
        reportingPeriod: new Date(body.reportingPeriod), meetingDate: body.meetingDate ? new Date(body.meetingDate) : null,
        entries: { create: users.map(user => ({ employeeId: user.id, teamUnit: body.unitName })) },
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
