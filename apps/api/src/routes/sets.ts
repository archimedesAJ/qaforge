import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const CreateSetSchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional(),
  caseIds:     z.array(z.string().uuid()).optional(),
});

const UpdateSetSchema = z.object({
  name:        z.string().min(1).optional(),
  description: z.string().optional(),
});

const CASE_SELECT = {
  id: true, title: true, type: true, priority: true, suiteId: true,
  suite: { select: { id: true, name: true } },
} as const;

export const setsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  // GET /:projectId/sets — list all sets with case count
  app.get('/:projectId/sets', { preHandler: requireRole('viewer') }, async (req) => {
    const { projectId } = req.params as { projectId: string };

    const sets = await prisma.testSet.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });

    return { sets: sets.map(s => ({ ...s, caseCount: s._count.items })) };
  });

  // POST /:projectId/sets — create a set (optionally pre-populate with caseIds)
  app.post('/:projectId/sets', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { userId } = req.user as { userId: string };
    const body = CreateSetSchema.parse(req.body);

    const set = await prisma.testSet.create({
      data: {
        projectId,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        createdById: userId,
        items: body.caseIds?.length
          ? { createMany: { data: body.caseIds.map(testCaseId => ({ testCaseId })), skipDuplicates: true } }
          : undefined,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });

    return reply.code(201).send({ ...set, caseCount: set._count.items });
  });

  // GET /:projectId/sets/:setId — set detail with full case list
  app.get('/:projectId/sets/:setId', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { setId } = req.params as { projectId: string; setId: string };

    const set = await prisma.testSet.findUnique({
      where: { id: setId },
      include: {
        createdBy: { select: { id: true, name: true } },
        items: {
          orderBy: { id: 'asc' },
          include: { testCase: { select: CASE_SELECT } },
        },
      },
    });

    if (!set) return reply.code(404).send({ error: 'Test set not found' });

    return { ...set, cases: set.items.map(i => i.testCase) };
  });

  // PUT /:projectId/sets/:setId — update name / description
  app.put('/:projectId/sets/:setId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { setId } = req.params as { projectId: string; setId: string };
    const body = UpdateSetSchema.parse(req.body);

    const existing = await prisma.testSet.findUnique({ where: { id: setId } });
    if (!existing) return reply.code(404).send({ error: 'Test set not found' });

    const updated = await prisma.testSet.update({
      where: { id: setId },
      data: {
        ...(body.name        !== undefined && { name: body.name.trim() }),
        ...(body.description !== undefined && { description: body.description.trim() || null }),
      },
      include: { createdBy: { select: { id: true, name: true } }, _count: { select: { items: true } } },
    });

    return { ...updated, caseCount: updated._count.items };
  });

  // DELETE /:projectId/sets/:setId — delete set (items cascade)
  app.delete('/:projectId/sets/:setId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { setId } = req.params as { projectId: string; setId: string };

    const existing = await prisma.testSet.findUnique({ where: { id: setId } });
    if (!existing) return reply.code(404).send({ error: 'Test set not found' });

    await prisma.testSet.delete({ where: { id: setId } });
    return reply.code(204).send();
  });

  // PUT /:projectId/sets/:setId/cases — replace entire case list (full sync)
  app.put('/:projectId/sets/:setId/cases', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { setId } = req.params as { projectId: string; setId: string };
    const { caseIds } = req.body as { caseIds: string[] };

    const existing = await prisma.testSet.findUnique({ where: { id: setId } });
    if (!existing) return reply.code(404).send({ error: 'Test set not found' });

    await prisma.$transaction([
      prisma.testSetItem.deleteMany({ where: { setId } }),
      prisma.testSetItem.createMany({
        data: caseIds.map(testCaseId => ({ setId, testCaseId })),
        skipDuplicates: true,
      }),
    ]);

    const updated = await prisma.testSet.findUnique({
      where: { id: setId },
      include: {
        createdBy: { select: { id: true, name: true } },
        items: { orderBy: { id: 'asc' }, include: { testCase: { select: CASE_SELECT } } },
        _count: { select: { items: true } },
      },
    });

    return { ...updated, cases: updated!.items.map(i => i.testCase), caseCount: updated!._count.items };
  });

  // POST /:projectId/sets/:setId/cases/:caseId — add one case
  app.post('/:projectId/sets/:setId/cases/:caseId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { setId, caseId } = req.params as { projectId: string; setId: string; caseId: string };

    const [set, tc] = await Promise.all([
      prisma.testSet.findUnique({ where: { id: setId } }),
      prisma.testCase.findUnique({ where: { id: caseId } }),
    ]);
    if (!set) return reply.code(404).send({ error: 'Test set not found' });
    if (!tc)  return reply.code(404).send({ error: 'Test case not found' });

    await prisma.testSetItem.upsert({
      where: { setId_testCaseId: { setId, testCaseId: caseId } },
      create: { setId, testCaseId: caseId },
      update: {},
    });

    return reply.code(201).send({ message: 'Case added to set' });
  });

  // DELETE /:projectId/sets/:setId/cases/:caseId — remove one case
  app.delete('/:projectId/sets/:setId/cases/:caseId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { setId, caseId } = req.params as { projectId: string; setId: string; caseId: string };

    await prisma.testSetItem.deleteMany({ where: { setId, testCaseId: caseId } });
    return reply.code(200).send({ message: 'Case removed from set' });
  });
};
