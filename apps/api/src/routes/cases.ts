import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole } from '../middleware/auth.js';

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

function splitCsvRow(row: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current); current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseSteps(raw: string): { order: number; action: string; expected: string }[] {
  if (!raw.trim()) return [];
  return raw.split('|').map((s, i) => {
    const [action = '', expected = ''] = s.split('>>').map(p => p.trim());
    return { order: i + 1, action, expected };
  }).filter(s => s.action);
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvRow(lines[0]).map(h => h.toLowerCase().trim());
  return lines.slice(1).map(line => {
    const vals = splitCsvRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

export const casesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  // GET /projects/:projectId/cases — viewer+
  app.get('/:projectId/cases', { preHandler: requireRole('viewer') }, async (req) => {
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

  // POST /projects/:projectId/cases — editor+
  app.post('/:projectId/cases', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { userId } = req.user as { userId: string };
    const body = CreateCaseSchema.parse(req.body);

    const existing = await prisma.testCase.findFirst({
      where: { projectId, archived: false, title: { equals: body.title, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) return reply.code(409).send({ error: `A test case named "${body.title}" already exists in this project` });

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

  // GET /projects/:projectId/cases/:caseId — viewer+
  app.get('/:projectId/cases/:caseId', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { caseId } = req.params as { caseId: string };
    const testCase = await prisma.testCase.findUnique({ where: { id: caseId } });
    if (!testCase) return reply.code(404).send({ error: 'Test case not found' });
    return testCase;
  });

  // PUT /projects/:projectId/cases/:caseId — editor+
  // IMPORTANT: Never mutates — archives old, creates new version
  app.put('/:projectId/cases/:caseId', { preHandler: requireRole('editor') }, async (req, reply) => {
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

  // DELETE /projects/:projectId/cases/:caseId — editor+ (archive)
  app.delete('/:projectId/cases/:caseId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { caseId } = req.params as { caseId: string };
    await prisma.testCase.update({ where: { id: caseId }, data: { archived: true } });
    return reply.code(204).send();
  });

  // POST /projects/:projectId/cases/import/csv — editor+
  app.post('/:projectId/cases/import/csv', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { userId } = req.user as { userId: string };

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) chunks.push(chunk as Buffer);
    const csvText = Buffer.concat(chunks).toString('utf-8');

    const rows = parseCsv(csvText);
    if (rows.length === 0) return reply.code(400).send({ error: 'CSV has no data rows' });

    // Pre-load suites so we can resolve names → IDs
    const suites = await prisma.testSuite.findMany({ where: { projectId }, select: { id: true, name: true } });
    const suiteMap = new Map(suites.map((s: { id: string; name: string }) => [s.name.toLowerCase().trim(), s.id]));

    // Pre-load existing titles to prevent duplicates
    const existingCases = await prisma.testCase.findMany({
      where: { projectId, archived: false },
      select: { title: true },
    });
    const existingTitles = new Set(existingCases.map((c: { title: string }) => c.title.toLowerCase().trim()));

    const VALID_TYPES  = new Set(['manual', 'functional', 'ui_auto', 'api', 'perf', 'exploratory']);
    const VALID_PRIOS  = new Set(['p0', 'p1', 'p2', 'p3']);

    let imported = 0;
    let skipped  = 0;
    const errors: { row: number; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row    = rows[i];
      const rowNum = i + 2;

      const title = row['title']?.trim();
      if (!title) { errors.push({ row: rowNum, error: 'Missing title' }); continue; }

      if (existingTitles.has(title.toLowerCase())) { skipped++; continue; }

      const type     = VALID_TYPES.has(row['type'] ?? '')     ? row['type']     : 'manual';
      const priority = VALID_PRIOS.has(row['priority'] ?? '') ? row['priority'] : 'p2';
      const tags     = row['tags']  ? row['tags'].split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      const suiteId  = row['suite'] ? (suiteMap.get(row['suite'].toLowerCase().trim()) ?? undefined) : undefined;
      const steps    = parseSteps(row['steps'] ?? '');

      try {
        await prisma.testCase.create({
          data: { projectId, title, type, priority, tags, suiteId, steps: steps.length ? steps : undefined, version: 1, createdById: userId },
        });
        existingTitles.add(title.toLowerCase()); // prevent in-file duplicates too
        imported++;
      } catch (err) {
        errors.push({ row: rowNum, error: String(err) });
      }
    }

    return reply.code(201).send({ imported, skipped, errors });
  });

  // GET /projects/:projectId/suites — viewer+
  app.get('/:projectId/suites', { preHandler: requireRole('viewer') }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    const suites = await prisma.testSuite.findMany({
      where: { projectId },
      include: { children: true },
    });
    return { suites };
  });

  // POST /projects/:projectId/suites — editor+
  app.post('/:projectId/suites', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { name, parentId } = req.body as { name: string; parentId?: string };
    const suite = await prisma.testSuite.create({ data: { projectId, name, parentId } });
    return reply.code(201).send(suite);
  });

  // PUT /projects/:projectId/suites/:suiteId — rename — editor+
  app.put('/:projectId/suites/:suiteId', { preHandler: requireRole('editor') }, async (req, _reply) => {
    const { suiteId } = req.params as { suiteId: string };
    const { name } = req.body as { name: string };
    return prisma.testSuite.update({ where: { id: suiteId }, data: { name } });
  });

  // DELETE /projects/:projectId/suites/:suiteId — editor+
  app.delete('/:projectId/suites/:suiteId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { suiteId } = req.params as { suiteId: string };
    await prisma.testSuite.delete({ where: { id: suiteId } });
    return reply.code(204).send();
  });
};
