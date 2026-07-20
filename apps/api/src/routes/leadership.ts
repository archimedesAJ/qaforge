import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
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

const editorDirectReportWhere = {
  activated: true,
  systemAdmin: false,
  memberships: {
    some: { role: 'editor' },
  },
} as const;

interface OneOnOneRow {
  id: string;
  leadId: string;
  reportId: string;
  meetingDate: Date;
  wins: unknown;
  discussionPoints: unknown;
  challenges: unknown;
  learningDevelopment: unknown;
  managerFeedback: unknown;
  actions: unknown;
  privateNotes: string | null;
  presentationSummary: string | null;
  nextMeetingDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  report: { id: string; name: string; email: string };
}

async function findOneOnOnes(leadId: string, from?: string, to?: string, meetingId?: string) {
  return prisma.$queryRaw<OneOnOneRow[]>(Prisma.sql`
    SELECT
      meeting.*,
      json_build_object('id', report."id", 'name', report."name", 'email', report."email") AS report
    FROM "LeadershipOneOnOne" AS meeting
    INNER JOIN "User" AS report ON report."id" = meeting."reportId"
    WHERE meeting."leadId" = ${leadId}
      AND (${from ?? null}::date IS NULL OR meeting."meetingDate" >= ${from ?? null}::date)
      AND (${to ?? null}::date IS NULL OR meeting."meetingDate" <= ${to ?? null}::date)
      AND (${meetingId ?? null}::text IS NULL OR meeting."id" = ${meetingId ?? null}::text)
    ORDER BY meeting."meetingDate" DESC
  `);
}

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
      meetings: await findOneOnOnes(userId, query.from, query.to),
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
    const meetingId = randomUUID();
    const nextMeetingDate = body.nextMeetingDate ?? defaultNextMeetingDate.toISOString().slice(0, 10);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "LeadershipOneOnOne" (
        "id", "leadId", "reportId", "meetingDate", "wins", "discussionPoints", "challenges",
        "learningDevelopment", "managerFeedback", "actions", "privateNotes", "presentationSummary",
        "nextMeetingDate", "createdAt", "updatedAt"
      ) VALUES (
        ${meetingId}, ${userId}, ${body.reportId}, ${body.meetingDate}::date,
        ${JSON.stringify(body.wins)}::jsonb, ${JSON.stringify(body.discussionPoints)}::jsonb,
        ${JSON.stringify(body.challenges)}::jsonb, ${JSON.stringify(body.learningDevelopment)}::jsonb,
        ${JSON.stringify(body.managerFeedback)}::jsonb, ${JSON.stringify(body.actions)}::jsonb,
        ${body.privateNotes?.trim() || null}, ${body.presentationSummary?.trim() || null},
        ${nextMeetingDate}::date, NOW(), NOW()
      )
    `);
    const [meeting] = await findOneOnOnes(userId, undefined, undefined, meetingId);
    if (!meeting) return reply.code(500).send({ error: 'Meeting was saved but could not be reloaded' });
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
    const users = await prisma.user.findMany({ where: { id: { in: body.reportIds }, ...editorDirectReportWhere }, select: { id: true } });
    if (users.length !== new Set(body.reportIds).size) return reply.code(400).send({ error: 'All direct reports must be activated editors' });
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
