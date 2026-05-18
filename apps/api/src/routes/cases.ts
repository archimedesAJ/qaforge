import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';

const CreateCaseSchema = z.object({
  title: z.string().min(1).max(500),
  type: z.enum(['manual', 'functional', 'ui_auto', 'api', 'perf', 'exploratory']),
  priority: z.enum(['p0', 'p1', 'p2', 'p3']).default('p2'),
  suiteId: z.string().uuid().optional(),
  tags: z.array(z.string()).default([]),
  steps: z.unknown().optional(),
  preconditions: z.string().optional(),
});

const UpdateCaseSchema = CreateCaseSchema.partial();

export const casesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  // GET /projects/:projectId/cases
  app.get('/:projectId/cases', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { suiteId, type, priority, tag, page = '1', limit = '50' } =
      req.query as Record<string, string>;

    const where: Record<string, unknown> = {
      projectId,
      archived: false,
      ...(suiteId && { suiteId }),
      ...(type && { type }),
      ...(priority && { priority }),
      ...(tag && { tags: { path: '$[*]', equals: tag } }),
    };

    const [data, total] = await Promise.all([
      prisma.testCase.findMany({
        where,
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.testCase.count({ where }),
    ]);

    return { data, pagination: { page: Number(page), limit: Number(limit), total } };
  });

  // POST /projects/:projectId/cases
  app.post('/:projectId/cases', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { userId } = req.user as { userId: string };
    const body = CreateCaseSchema.parse(req.body);

    const testCase = await prisma.testCase.create({
      data: {
        ...body,
        projectId,
        createdById: userId,
        tags: body.tags,
        steps: body.steps as object | undefined,
        version: 1,
      },
    });

    return reply.code(201).send(testCase);
  });

  // GET /projects/:projectId/cases/:caseId
  app.get('/:projectId/cases/:caseId', async (req, reply) => {
    const { caseId } = req.params as { caseId: string };
    const testCase = await prisma.testCase.findUnique({ where: { id: caseId } });
    if (!testCase) return reply.code(404).send({ error: 'Test case not found' });
    return testCase;
  });

  // PUT /projects/:projectId/cases/:caseId
  // IMPORTANT: Never mutates — archives old, creates new version
  app.put('/:projectId/cases/:caseId', async (req, reply) => {
    const { projectId, caseId } = req.params as { projectId: string; caseId: string };
    const { userId } = req.user as { userId: string };
    const body = UpdateCaseSchema.parse(req.body);

    const existing = await prisma.testCase.findUnique({ where: { id: caseId } });
    if (!existing) return reply.code(404).send({ error: 'Test case not found' });

    // Archive old version
    await prisma.testCase.update({
      where: { id: caseId },
      data: { archived: true },
    });

    // Create new version with incremented version number
    const newCase = await prisma.testCase.create({
      data: {
        projectId,
        title: body.title ?? existing.title,
        type: body.type ?? existing.type,
        priority: body.priority ?? existing.priority,
        suiteId: body.suiteId ?? existing.suiteId,
        tags: body.tags ?? existing.tags as string[],
        steps: (body.steps ?? existing.steps) as object | undefined,
        preconditions: body.preconditions ?? existing.preconditions,
        version: existing.version + 1,
        createdById: userId,
        archived: false,
      },
    });

    return { ...newCase, previousVersion: existing.version };
  });

  // DELETE /projects/:projectId/cases/:caseId — soft delete (archive)
  app.delete('/:projectId/cases/:caseId', async (req, reply) => {
    const { caseId } = req.params as { caseId: string };
    await prisma.testCase.update({ where: { id: caseId }, data: { archived: true } });
    return reply.code(204).send();
  });

  // GET /projects/:projectId/suites
  app.get('/:projectId/suites', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const suites = await prisma.testSuite.findMany({
      where: { projectId },
      include: { children: true },
    });
    return { suites };
  });

  // POST /projects/:projectId/suites
  app.post('/:projectId/suites', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { name, parentId } = req.body as { name: string; parentId?: string };
    const suite = await prisma.testSuite.create({ data: { projectId, name, parentId } });
    return reply.code(201).send(suite);
  });

  // PUT /projects/:projectId/suites/:suiteId — rename
  app.put('/:projectId/suites/:suiteId', async (req, _reply) => {
    const { suiteId } = req.params as { suiteId: string };
    const { name } = req.body as { name: string };
    return prisma.testSuite.update({ where: { id: suiteId }, data: { name } });
  });

  // DELETE /projects/:projectId/suites/:suiteId
  app.delete('/:projectId/suites/:suiteId', async (req, reply) => {
    const { suiteId } = req.params as { suiteId: string };
    await prisma.testSuite.delete({ where: { id: suiteId } });
    return reply.code(204).send();
  });
};
