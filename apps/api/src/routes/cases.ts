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
    const { suiteId, type, priority, tag, q, page = '1', limit = '25' } =
      req.query as Record<string, string>;

    const where: Record<string, unknown> = {
      projectId,
      archived: false,
      ...(suiteId && { suiteId }),
      ...(type && { type }),
      ...(priority && { priority }),
      ...(tag && { tags: { path: '$[*]', equals: tag } }),
      ...(q && { title: { contains: q, mode: 'insensitive' } }),
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

    // Set lineageId to own id (first version anchors the lineage)
    await prisma.testCase.update({
      where: { id: testCase.id },
      data: { lineageId: testCase.id },
    });

    return reply.code(201).send({ ...testCase, lineageId: testCase.id });
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

    // Create new version, carrying lineageId forward
    const newCase = await prisma.testCase.create({
      data: {
        projectId,
        lineageId: existing.lineageId ?? existing.id,
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

  // GET /projects/:projectId/cases/:caseId/history — viewer+
  app.get('/:projectId/cases/:caseId/history', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { caseId } = req.params as { caseId: string };

    const testCase = await prisma.testCase.findUnique({ where: { id: caseId }, select: { lineageId: true } });
    if (!testCase) return reply.code(404).send({ error: 'Test case not found' });

    const lineageId = testCase.lineageId ?? caseId;

    const versions = await prisma.testCase.findMany({
      where: { lineageId },
      orderBy: { version: 'asc' },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });

    return { versions };
  });

  // DELETE /projects/:projectId/cases/:caseId — editor+ (archive)
  app.delete('/:projectId/cases/:caseId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { caseId } = req.params as { caseId: string };
    await prisma.testCase.update({ where: { id: caseId }, data: { archived: true } });
    return reply.code(204).send();
  });

  // GET /projects/:projectId/cases/:caseId/comments — viewer+
  app.get('/:projectId/cases/:caseId/comments', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { caseId } = req.params as { caseId: string };
    const testCase = await prisma.testCase.findUnique({ where: { id: caseId }, select: { lineageId: true } });
    if (!testCase) return reply.code(404).send({ error: 'Test case not found' });

    const lineageId = testCase.lineageId ?? caseId;
    const comments = await prisma.caseComment.findMany({
      where: { lineageId, parentId: null },
      orderBy: { createdAt: 'asc' },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { createdBy: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    return { comments };
  });

  // POST /projects/:projectId/cases/:caseId/comments — viewer+
  app.post('/:projectId/cases/:caseId/comments', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { caseId } = req.params as { caseId: string };
    const { userId } = req.user as { userId: string };
    const { content, parentId } = req.body as { content: string; parentId?: string };

    if (!content?.trim()) return reply.code(400).send({ error: 'Comment content is required' });

    const testCase = await prisma.testCase.findUnique({ where: { id: caseId }, select: { lineageId: true } });
    if (!testCase) return reply.code(404).send({ error: 'Test case not found' });

    const lineageId = testCase.lineageId ?? caseId;
    const comment = await prisma.caseComment.create({
      data: { lineageId, content: content.trim(), parentId: parentId ?? null, createdById: userId },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    return reply.code(201).send(comment);
  });

  // DELETE /projects/:projectId/cases/:caseId/comments/:commentId — own comment or manager+
  app.delete('/:projectId/cases/:caseId/comments/:commentId', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { commentId } = req.params as { caseId: string; commentId: string };
    const { userId } = req.user as { userId: string };

    const comment = await prisma.caseComment.findUnique({ where: { id: commentId } });
    if (!comment) return reply.code(404).send({ error: 'Comment not found' });
    if (comment.createdById !== userId) return reply.code(403).send({ error: 'You can only delete your own comments' });

    await prisma.caseComment.delete({ where: { id: commentId } });
    return reply.code(204).send();
  });

  // GET /projects/:projectId/cases/:caseId/links — viewer+
  app.get('/:projectId/cases/:caseId/links', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { caseId } = req.params as { caseId: string };
    const testCase = await prisma.testCase.findUnique({ where: { id: caseId }, select: { lineageId: true } });
    if (!testCase) return reply.code(404).send({ error: 'Test case not found' });

    const links = await prisma.caseLink.findMany({
      where: { lineageId: testCase.lineageId ?? caseId },
      orderBy: { createdAt: 'asc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return { links };
  });

  // POST /projects/:projectId/cases/:caseId/links — editor+
  app.post('/:projectId/cases/:caseId/links', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { caseId } = req.params as { caseId: string };
    const { userId } = req.user as { userId: string };
    const { type, label, url } = req.body as { type: string; label: string; url?: string };

    const VALID_TYPES = new Set(['jira', 'github', 'requirement', 'other']);
    if (!VALID_TYPES.has(type)) return reply.code(400).send({ error: 'Invalid link type' });
    if (!label?.trim()) return reply.code(400).send({ error: 'Label is required' });

    const testCase = await prisma.testCase.findUnique({ where: { id: caseId }, select: { lineageId: true } });
    if (!testCase) return reply.code(404).send({ error: 'Test case not found' });

    const link = await prisma.caseLink.create({
      data: {
        lineageId: testCase.lineageId ?? caseId,
        type,
        label: label.trim(),
        url: url?.trim() || null,
        createdById: userId,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return reply.code(201).send(link);
  });

  // DELETE /projects/:projectId/cases/:caseId/links/:linkId — editor+
  app.delete('/:projectId/cases/:caseId/links/:linkId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { linkId } = req.params as { caseId: string; linkId: string };
    const link = await prisma.caseLink.findUnique({ where: { id: linkId } });
    if (!link) return reply.code(404).send({ error: 'Link not found' });
    await prisma.caseLink.delete({ where: { id: linkId } });
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

    // Pre-load suites so we can resolve paths → IDs.
    // Key format: `${parentId ?? ''}|${name.toLowerCase()}` — avoids collisions
    // between same-named suites under different parents.
    const suites = await prisma.testSuite.findMany({ where: { projectId }, select: { id: true, name: true, parentId: true } });
    const suiteMap = new Map(
      suites.map((s: { id: string; name: string; parentId: string | null }) => [
        `${s.parentId ?? ''}|${s.name.toLowerCase().trim()}`,
        s.id,
      ])
    );

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

      const type         = VALID_TYPES.has(row['type'] ?? '')     ? row['type']     : 'manual';
      const priority     = VALID_PRIOS.has(row['priority'] ?? '') ? row['priority'] : 'p2';
      const tags         = row['tags']  ? row['tags'].split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      const preconditions = (row['preconditions'] ?? row['precondition'])?.trim() || undefined;
      let suiteId: string | undefined;
      if (row['suite']) {
        // Support hierarchical paths: "Airtime/Section B" → Section B nested inside Airtime.
        // Each "/" segment is a level; suites are found or created at each level.
        const segments = row['suite'].split('/').map((s: string) => s.trim()).filter(Boolean);
        let parentId: string | null = null;
        for (const segment of segments) {
          const key: string = `${parentId ?? ''}|${segment.toLowerCase()}`;
          if (!suiteMap.has(key)) {
            const newSuite = await prisma.testSuite.create({
              data: { projectId, name: segment, parentId: parentId ?? undefined },
            });
            suiteMap.set(key, newSuite.id);
          }
          parentId = suiteMap.get(key)!;
        }
        suiteId = parentId ?? undefined;
      }
      const VALID_FRAMEWORKS = new Set(['Playwright', 'Cypress', 'Selenium', 'WebdriverIO', 'Appium']);
      let stepsData: unknown;
      if (type === 'ui_auto') {
        const framework = VALID_FRAMEWORKS.has(row['framework'] ?? '') ? row['framework'] : 'Playwright';
        stepsData = {
          framework,
          scriptPath:  row['script_path']?.trim() ?? '',
          testName:    row['test_name']?.trim()   ?? '',
          description: row['description']?.trim() ?? '',
        };
      } else {
        const parsed = parseSteps(row['steps'] ?? '');
        stepsData = parsed.length ? parsed : undefined;
      }

      try {
        const created = await prisma.testCase.create({
          data: { projectId, title, type, priority, tags, suiteId, preconditions, steps: stepsData as object | undefined, version: 1, createdById: userId },
        });
        await prisma.testCase.update({ where: { id: created.id }, data: { lineageId: created.id } });
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

  // PATCH /projects/:projectId/suites/:suiteId — reparent (drag-and-drop) — editor+
  app.patch('/:projectId/suites/:suiteId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId, suiteId } = req.params as { projectId: string; suiteId: string };
    const { parentId } = req.body as { parentId: string | null };

    // Guard: can't make a suite its own ancestor
    if (parentId) {
      const all = await prisma.testSuite.findMany({ where: { projectId }, select: { id: true, parentId: true } });
      function isDescendant(ancestorId: string, nodeId: string): boolean {
        if (nodeId === ancestorId) return true;
        const children = all.filter(s => s.parentId === ancestorId);
        return children.some(c => isDescendant(c.id, nodeId));
      }
      if (isDescendant(suiteId, parentId)) {
        return reply.code(400).send({ error: 'Cannot move a suite into one of its own descendants' });
      }
    }

    const suite = await prisma.testSuite.update({
      where: { id: suiteId },
      data: { parentId: parentId ?? null },
    });
    return suite;
  });

  // DELETE /projects/:projectId/suites/:suiteId — editor+
  app.delete('/:projectId/suites/:suiteId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { suiteId } = req.params as { suiteId: string };
    await prisma.testSuite.delete({ where: { id: suiteId } });
    return reply.code(204).send();
  });
};
