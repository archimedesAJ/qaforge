import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireProjectCapability, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';

const VALID_TRACKERS  = ['jira', 'github', 'linear', 'internal'] as const;
const VALID_STATUSES  = ['open', 'in_progress', 'resolved', 'closed', 'wont_fix'] as const;
const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

const AttachmentSchema = z.object({
  name: z.string(),
  type: z.enum(['screenshot', 'video', 'log', 'file']),
  url:  z.string(),
});

const CreateDefectSchema = z.object({
  clientRequestId: z.string().uuid().optional(),
  title:       z.string().min(1),
  tracker:     z.enum(VALID_TRACKERS),
  severity:    z.enum(VALID_SEVERITIES).default('medium'),
  externalRef: z.string().max(2048).nullish(),
  notes:       z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

const UpdateDefectSchema = z.object({
  title:       z.string().min(1).optional(),
  tracker:     z.enum(VALID_TRACKERS).optional(),
  severity:    z.enum(VALID_SEVERITIES).optional(),
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

function splitCsvRow(row: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (quoted && row[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      fields.push(current); current = '';
    } else current += ch;
  }
  fields.push(current);
  return fields;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvRow(lines[0]).map(header => header.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const values = splitCsvRow(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? '']));
  });
}

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
    const { userId } = req.user as { userId: string };
    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };
    const body = CreateDefectSchema.parse(req.body);

    let defect;
    try {
      defect = await prisma.defect.create({
        data: {
          clientRequestId: body.clientRequestId,
          projectId,
          title:       body.title.trim(),
          tracker:     body.tracker,
          severity:    body.severity,
          externalRef: body.externalRef?.trim() || null,
          notes:       body.notes?.trim() || null,
          attachments: body.attachments ?? [],
          status:      'open',
        },
        include: DEFECT_INCLUDE,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || !body.clientRequestId) throw error;
      defect = await prisma.defect.findUnique({ where: { clientRequestId: body.clientRequestId }, include: DEFECT_INCLUDE });
      if (!defect || defect.projectId !== projectId || defect.runResultId !== null) throw error;
      return reply.code(200).send(defect);
    }

    logActivity({ userId, isSystemAdmin, projectId, action: 'defect_filed', entityType: 'defect', entityId: defect.id, entityName: defect.title ?? undefined });

    return reply.code(201).send(defect);
  });

  // POST /:projectId/defects/import/csv — editor+ with an explicit member capability
  app.post('/:projectId/defects/import/csv', {
    preHandler: [requireRole('editor'), requireProjectCapability('canBulkUploadDefects')],
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { userId } = req.user as { userId: string };
    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No CSV file uploaded' });
    if (!file.filename.toLowerCase().endsWith('.csv')) {
      return reply.code(400).send({ error: 'Only CSV files are supported' });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) chunks.push(chunk as Buffer);
    const rows = parseCsv(Buffer.concat(chunks).toString('utf-8'));
    if (rows.length === 0) return reply.code(400).send({ error: 'CSV has no data rows' });
    if (rows.length > 1000) return reply.code(400).send({ error: 'CSV cannot contain more than 1,000 defects' });

    let imported = 0;
    const issues: { row: number; title?: string; message: string }[] = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowNumber = index + 2;
      const title = row.title?.trim();
      if (!title) { issues.push({ row: rowNumber, message: 'Missing required title' }); continue; }

      const tracker = (row.tracker || 'internal').toLowerCase();
      const severity = (row.severity || 'medium').toLowerCase();
      const status = (row.status || 'open').toLowerCase();
      if (!VALID_TRACKERS.includes(tracker as typeof VALID_TRACKERS[number])) {
        issues.push({ row: rowNumber, title, message: `Invalid tracker "${row.tracker}"` }); continue;
      }
      if (!VALID_SEVERITIES.includes(severity as typeof VALID_SEVERITIES[number])) {
        issues.push({ row: rowNumber, title, message: `Invalid severity "${row.severity}"` }); continue;
      }
      if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
        issues.push({ row: rowNumber, title, message: `Invalid status "${row.status}"` }); continue;
      }
      if ((row.externalref || row.external_ref || '').length > 2048) {
        issues.push({ row: rowNumber, title, message: 'External reference exceeds 2,048 characters' }); continue;
      }

      try {
        await prisma.defect.create({
          data: {
            projectId, title,
            tracker, severity, status,
            externalRef: row.externalref || row.external_ref || null,
            notes: row.notes || null,
            attachments: [],
          },
        });
        imported++;
      } catch {
        issues.push({ row: rowNumber, title, message: 'Could not create defect' });
      }
    }

    logActivity({
      userId, isSystemAdmin, projectId, action: 'defects_bulk_imported',
      entityType: 'defect', entityName: `${imported} defects imported`,
    });
    return reply.code(201).send({ imported, failed: issues.length, total: rows.length, issues });
  });

  // POST /:projectId/results/:resultId/defect — file a defect against a failed result
  app.post('/:projectId/results/:resultId/defect', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId, resultId } = req.params as { projectId: string; resultId: string };
    const { userId } = req.user as { userId: string };
    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };
    const body = CreateDefectSchema.parse(req.body);

    const result = await prisma.runResult.findUnique({
      where: { id: Number(resultId) },
      include: { run: { select: { projectId: true } } },
    });
    if (!result) return reply.code(404).send({ error: 'Result not found' });
    if (result.run.projectId !== projectId) return reply.code(403).send({ error: 'Forbidden' });
    if (result.status === 'pass') return reply.code(400).send({ error: 'Cannot file a defect against a passing result' });

    let defect;
    try {
      defect = await prisma.defect.create({
        data: {
          clientRequestId: body.clientRequestId,
          projectId,
          runResultId: result.id,
          title:       body.title.trim(),
          tracker:     body.tracker,
          severity:    body.severity,
          externalRef: body.externalRef?.trim() || null,
          notes:       body.notes?.trim() || null,
          attachments: body.attachments ?? [],
          status:      'open',
        },
        include: DEFECT_INCLUDE,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || !body.clientRequestId) throw error;
      defect = await prisma.defect.findUnique({ where: { clientRequestId: body.clientRequestId }, include: DEFECT_INCLUDE });
      if (!defect || defect.projectId !== projectId || defect.runResultId !== result.id) throw error;
      return reply.code(200).send(defect);
    }

    logActivity({ userId, isSystemAdmin, projectId, action: 'defect_filed', entityType: 'defect', entityId: defect.id, entityName: defect.title ?? undefined });

    return reply.code(201).send(defect);
  });

  // PATCH /:projectId/defects/:defectId — update status, ref, notes
  app.patch('/:projectId/defects/:defectId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId, defectId } = req.params as { projectId: string; defectId: string };
    const { userId } = req.user as { userId: string };
    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };
    const body = UpdateDefectSchema.parse(req.body);

    const existing = await prisma.defect.findUnique({ where: { id: defectId } });
    if (!existing) return reply.code(404).send({ error: 'Defect not found' });
    if (existing.projectId !== projectId) return reply.code(403).send({ error: 'Forbidden' });

    const updated = await prisma.defect.update({
      where: { id: defectId },
      data: {
        ...(body.title       !== undefined && { title: body.title.trim() }),
        ...(body.tracker     !== undefined && { tracker:  body.tracker }),
        ...(body.severity    !== undefined && { severity: body.severity }),
        ...(body.externalRef !== undefined && { externalRef: body.externalRef?.trim() || null }),
        ...(body.status      !== undefined && { status:   body.status }),
        ...(body.notes       !== undefined && { notes: body.notes.trim() || null }),
        ...(body.attachments !== undefined && { attachments: body.attachments }),
      },
      include: DEFECT_INCLUDE,
    });

    logActivity({ userId, isSystemAdmin, projectId, action: 'defect_updated', entityType: 'defect', entityId: defectId, entityName: updated.title ?? undefined });

    return updated;
  });

  // DELETE /:projectId/defects/:defectId — remove a defect
  app.delete('/:projectId/defects/:defectId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId, defectId } = req.params as { projectId: string; defectId: string };
    const { userId } = req.user as { userId: string };
    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };

    const existing = await prisma.defect.findUnique({ where: { id: defectId } });
    if (!existing) return reply.code(404).send({ error: 'Defect not found' });
    if (existing.projectId !== projectId) return reply.code(403).send({ error: 'Forbidden' });

    await prisma.defect.delete({ where: { id: defectId } });

    logActivity({ userId, isSystemAdmin, projectId, action: 'defect_deleted', entityType: 'defect', entityId: defectId, entityName: existing.title ?? undefined });

    return reply.code(204).send();
  });
};
