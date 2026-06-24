import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const VALID_TRACKERS = ['jira', 'github', 'linear', 'internal'] as const;
const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'wont_fix'] as const;

const AttachmentSchema = z.object({
  name: z.string(),
  type: z.enum(['screenshot', 'video', 'log', 'file']),
  url:  z.string(),
});

const CreateDefectSchema = z.object({
  title:       z.string().min(1),
  tracker:     z.enum(VALID_TRACKERS),
  externalRef: z.string().max(2048).nullish(),
  notes:       z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

const UpdateDefectSchema = z.object({
  title:       z.string().min(1).optional(),
  tracker:     z.enum(VALID_TRACKERS).optional(),
  externalRef: z.string().max(2048).nullish(),
  status:      z.enum(VALID_STATUSES).optional(),
  notes:       z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

const DEFECT_INCLUDE = {
  runResult: {
    select: {
      id: true, runId: true, status: true, executedAt: true,
      testCase: { select: { id: true, title: true, type: true } },
      run: { select: { id: true, name: true, env: true } },
    },
  },
} as const;

export const defectsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  // GET /:projectId/defects — list all defects for a project (filterable by status)
  app.get('/:projectId/defects', { preHandler: requireRole('viewer') }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { status } = req.query as { status?: string };

    const defects = await prisma.defect.findMany({
      where: {
        projectId,
        ...(status && VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])
          ? { status }
          : {}),
      },
      include: DEFECT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return { defects };
  });

  // POST /:projectId/defects — file a standalone defect (not linked to any test result)
  app.post('/:projectId/defects', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = CreateDefectSchema.parse(req.body);

    const defect = await prisma.defect.create({
      data: {
        projectId,
        title:       body.title.trim(),
        tracker:     body.tracker,
        externalRef: body.externalRef?.trim() || null,
        notes:       body.notes?.trim() || null,
        attachments: body.attachments ?? [],
        status:      'open',
      },
      include: DEFECT_INCLUDE,
    });

    return reply.code(201).send(defect);
  });

  // POST /:projectId/results/:resultId/defect — file a defect against a failed result
  app.post('/:projectId/results/:resultId/defect', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId, resultId } = req.params as { projectId: string; resultId: string };
    const body = CreateDefectSchema.parse(req.body);

    const result = await prisma.runResult.findUnique({
      where: { id: Number(resultId) },
      include: { run: { select: { projectId: true } } },
    });
    if (!result) return reply.code(404).send({ error: 'Result not found' });
    if (result.run.projectId !== projectId) return reply.code(403).send({ error: 'Forbidden' });
    if (result.status === 'pass') return reply.code(400).send({ error: 'Cannot file a defect against a passing result' });

    const existing = await prisma.defect.findUnique({ where: { runResultId: result.id } });
    if (existing) return reply.code(409).send({ error: 'A defect is already filed for this result' });

    const defect = await prisma.defect.create({
      data: {
        projectId,
        runResultId: result.id,
        title:       body.title.trim(),
        tracker:     body.tracker,
        externalRef: body.externalRef?.trim() || null,
        notes:       body.notes?.trim() || null,
        attachments: body.attachments ?? [],
        status:      'open',
      },
      include: DEFECT_INCLUDE,
    });

    return reply.code(201).send(defect);
  });

  // PATCH /:projectId/defects/:defectId — update status, ref, notes
  app.patch('/:projectId/defects/:defectId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId, defectId } = req.params as { projectId: string; defectId: string };
    const body = UpdateDefectSchema.parse(req.body);

    const existing = await prisma.defect.findUnique({ where: { id: defectId } });
    if (!existing) return reply.code(404).send({ error: 'Defect not found' });
    if (existing.projectId !== projectId) return reply.code(403).send({ error: 'Forbidden' });

    const updated = await prisma.defect.update({
      where: { id: defectId },
      data: {
        ...(body.title       !== undefined && { title: body.title.trim() }),
        ...(body.tracker     !== undefined && { tracker: body.tracker }),
        ...(body.externalRef !== undefined && { externalRef: body.externalRef?.trim() || null }),
        ...(body.status      !== undefined && { status: body.status }),
        ...(body.notes       !== undefined && { notes: body.notes.trim() || null }),
        ...(body.attachments !== undefined && { attachments: body.attachments }),
      },
      include: DEFECT_INCLUDE,
    });

    return updated;
  });

  // DELETE /:projectId/defects/:defectId — remove a defect
  app.delete('/:projectId/defects/:defectId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId, defectId } = req.params as { projectId: string; defectId: string };

    const existing = await prisma.defect.findUnique({ where: { id: defectId } });
    if (!existing) return reply.code(404).send({ error: 'Defect not found' });
    if (existing.projectId !== projectId) return reply.code(403).send({ error: 'Forbidden' });

    await prisma.defect.delete({ where: { id: defectId } });
    return reply.code(204).send();
  });
};
