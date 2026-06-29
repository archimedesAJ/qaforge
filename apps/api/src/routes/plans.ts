import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';

const CreatePlanSchema = z.object({
  name:        z.string().min(1),
  milestone:   z.string().optional(),
  description: z.string().optional(),
  endsAt:      z.string().datetime().optional(),
});

const UpdatePlanSchema = z.object({
  name:        z.string().min(1).optional(),
  milestone:   z.string().optional(),
  description: z.string().optional(),
  status:      z.enum(['active', 'archived']).optional(),
  endsAt:      z.string().datetime().nullable().optional(),
});

export const plansRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  // GET /:projectId/plans — list all plans with run counts + aggregate stats
  app.get('/:projectId/plans', { preHandler: requireRole('viewer') }, async (req) => {
    const { projectId } = req.params as { projectId: string };

    const plans = await prisma.testPlan.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        runs: {
          select: {
            id: true,
            name: true,
            env: true,
            status: true,
            startedAt: true,
            endedAt: true,
            results: { select: { status: true } },
          },
        },
      },
    });

    return {
      plans: plans.map(plan => ({
        ...plan,
        runs: plan.runs.map(run => ({
          id: run.id,
          name: run.name,
          env: run.env,
          status: run.status,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          ...computeRunStats(run.results),
        })),
        aggregate: computeAggregate(plan.runs.map(r => r.results)),
      })),
    };
  });

  // POST /:projectId/plans — create a plan
  app.post('/:projectId/plans', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { userId } = req.user as { userId: string };
    const body = CreatePlanSchema.parse(req.body);

    const plan = await prisma.testPlan.create({
      data: {
        projectId,
        name: body.name.trim(),
        milestone: body.milestone?.trim() || null,
        description: body.description?.trim() || null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        createdById: userId,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };
    const { projectId: pid } = req.params as { projectId: string };
    logActivity({ userId, isSystemAdmin, projectId: pid, action: 'plan_created', entityType: 'plan', entityId: plan.id, entityName: plan.name });

    return reply.code(201).send({ ...plan, runs: [], aggregate: emptyAggregate() });
  });

  // GET /:projectId/plans/:planId — plan detail with full run list
  app.get('/:projectId/plans/:planId', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { planId } = req.params as { projectId: string; planId: string };

    const plan = await prisma.testPlan.findUnique({
      where: { id: planId },
      include: {
        createdBy: { select: { id: true, name: true } },
        runs: {
          select: {
            id: true,
            name: true,
            env: true,
            status: true,
            source: true,
            startedAt: true,
            endedAt: true,
            results: { select: { status: true } },
            runCases: { select: { status: true } },
          },
          orderBy: { startedAt: 'asc' },
        },
      },
    });

    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    return {
      ...plan,
      runs: plan.runs.map(run => ({
        id: run.id,
        name: run.name,
        env: run.env,
        status: run.status,
        source: run.source,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        ...computeRunStats(run.results),
        caseCount: run.runCases.length,
        doneCount: run.runCases.filter(rc => rc.status !== 'not_run').length,
      })),
      aggregate: computeAggregate(plan.runs.map(r => r.results)),
    };
  });

  // GET /:projectId/plans/:planId/summary — sprint summary
  app.get('/:projectId/plans/:planId/summary', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { planId } = req.params as { projectId: string; planId: string };

    const runs = await prisma.testRun.findMany({
      where: { planId },
      select: { id: true },
    });
    const runIds = runs.map(r => r.id);

    if (runIds.length === 0) {
      return { stories: [], unlinked: [], overall: { total: 0, pass: 0, fail: 0, blocked: 0, skipped: 0, passRate: null } };
    }

    // All results across plan runs, newest first
    const allResults = await prisma.runResult.findMany({
      where: { runId: { in: runIds } },
      orderBy: { executedAt: 'desc' },
      select: {
        id: true,
        testCaseId: true,
        status: true,
        failureNote: true,
        errorMessage: true,
        executedAt: true,
        testCase: { select: { seqId: true, title: true, type: true, lineageId: true } },
      },
    });

    // Latest result per testCaseId
    const latestMap = new Map<string, typeof allResults[0]>();
    for (const r of allResults) {
      if (!latestMap.has(r.testCaseId)) latestMap.set(r.testCaseId, r);
    }
    const latestResults = Array.from(latestMap.values());

    // Collect lineageIds for CaseLink lookup
    const lineageIds = [
      ...new Set(
        latestResults.map(r => {
          const tc = r.testCase as { lineageId?: string | null } | null;
          return tc?.lineageId ?? r.testCaseId;
        })
      ),
    ];

    const caseLinks = await prisma.caseLink.findMany({
      where: { lineageId: { in: lineageIds } },
    });

    const linksByLineage: Record<string, typeof caseLinks> = {};
    for (const link of caseLinks) {
      if (!linksByLineage[link.lineageId]) linksByLineage[link.lineageId] = [];
      linksByLineage[link.lineageId].push(link);
    }

    type CaseEntry = { id: string; seqId: number | null; title: string; status: string; failureNote: string | null; errorMessage: string | null };
    type StoryGroup = { key: string; label: string; url: string | null; type: string; cases: CaseEntry[]; storyStatus: string };

    const storyMap = new Map<string, StoryGroup>();
    const unlinked: CaseEntry[] = [];

    for (const r of latestResults) {
      const tc = r.testCase as { seqId: number; title: string; type: string; lineageId?: string | null } | null;
      const lineageId = tc?.lineageId ?? r.testCaseId;
      const links = linksByLineage[lineageId] ?? [];
      const storyLink = links.find(l => l.type === 'jira' || l.type === 'requirement') ?? links[0];
      const entry: CaseEntry = {
        id: r.testCaseId,
        seqId: tc?.seqId ?? null,
        title: tc?.title ?? `Test #${r.testCaseId.slice(-6)}`,
        status: r.status,
        failureNote: r.failureNote,
        errorMessage: r.errorMessage,
      };
      if (storyLink) {
        const key = storyLink.url ?? storyLink.label;
        if (!storyMap.has(key)) {
          storyMap.set(key, { key, label: storyLink.label, url: storyLink.url, type: storyLink.type, cases: [], storyStatus: 'not_run' });
        }
        storyMap.get(key)!.cases.push(entry);
      } else {
        unlinked.push(entry);
      }
    }

    // Compute story-level status
    const stories = Array.from(storyMap.values()).map(s => {
      const statuses = s.cases.map(c => c.status);
      let storyStatus: string;
      if (statuses.every(st => st === 'pass')) storyStatus = 'pass';
      else if (statuses.some(st => st === 'fail')) storyStatus = 'fail';
      else if (statuses.some(st => st === 'blocked')) storyStatus = 'blocked';
      else if (statuses.some(st => st === 'pass')) storyStatus = 'partial';
      else storyStatus = 'not_run';
      return { ...s, storyStatus };
    });

    // Overall counts
    const counts = { pass: 0, fail: 0, blocked: 0, skipped: 0 };
    for (const r of latestResults) {
      const k = r.status as keyof typeof counts;
      if (k in counts) counts[k]++;
    }
    const total = latestResults.length;
    const passRate = total > 0 ? Math.round((counts.pass / total) * 100) : null;

    return { stories, unlinked, overall: { ...counts, total, passRate } };
  });

  // PUT /:projectId/plans/:planId — update plan metadata
  app.put('/:projectId/plans/:planId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId, planId } = req.params as { projectId: string; planId: string };
    const { userId } = req.user as { userId: string };
    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };
    const body = UpdatePlanSchema.parse(req.body);

    const existing = await prisma.testPlan.findUnique({ where: { id: planId } });
    if (!existing) return reply.code(404).send({ error: 'Plan not found' });

    const updated = await prisma.testPlan.update({
      where: { id: planId },
      data: {
        ...(body.name        !== undefined && { name: body.name.trim() }),
        ...(body.milestone   !== undefined && { milestone: body.milestone.trim() || null }),
        ...(body.description !== undefined && { description: body.description.trim() || null }),
        ...(body.status      !== undefined && { status: body.status }),
        ...(body.endsAt      !== undefined && { endsAt: body.endsAt ? new Date(body.endsAt) : null }),
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    if (body.status === 'archived') {
      logActivity({ userId, isSystemAdmin, projectId, action: 'plan_archived', entityType: 'plan', entityId: planId, entityName: updated.name });
    }

    return updated;
  });

  // DELETE /:projectId/plans/:planId — delete plan (detaches runs, does not delete them)
  app.delete('/:projectId/plans/:planId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId, planId } = req.params as { projectId: string; planId: string };
    const { userId } = req.user as { userId: string };
    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };

    const existing = await prisma.testPlan.findUnique({ where: { id: planId } });
    if (!existing) return reply.code(404).send({ error: 'Plan not found' });

    // Detach all runs first
    await prisma.testRun.updateMany({ where: { planId }, data: { planId: null } });
    await prisma.testPlan.delete({ where: { id: planId } });

    logActivity({ userId, isSystemAdmin, projectId, action: 'plan_deleted', entityType: 'plan', entityId: planId, entityName: existing.name });

    return reply.code(204).send();
  });

  // POST /:projectId/plans/:planId/runs/:runId — assign a run to this plan
  app.post('/:projectId/plans/:planId/runs/:runId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { projectId, planId, runId } = req.params as { projectId: string; planId: string; runId: string };

    const [plan, run] = await Promise.all([
      prisma.testPlan.findUnique({ where: { id: planId } }),
      prisma.testRun.findUnique({ where: { id: runId } }),
    ]);

    if (!plan) return reply.code(404).send({ error: 'Plan not found' });
    if (!run)  return reply.code(404).send({ error: 'Run not found' });
    if (run.projectId !== projectId) return reply.code(403).send({ error: 'Run belongs to a different project' });
    if (run.planId && run.planId !== planId) return reply.code(409).send({ error: 'Run is already assigned to another plan' });

    await prisma.testRun.update({ where: { id: runId }, data: { planId } });

    return reply.code(200).send({ message: 'Run assigned to plan' });
  });

  // DELETE /:projectId/plans/:planId/runs/:runId — remove run from plan
  app.delete('/:projectId/plans/:planId/runs/:runId', { preHandler: requireRole('editor') }, async (req, reply) => {
    const { planId, runId } = req.params as { projectId: string; planId: string; runId: string };

    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    if (run.planId !== planId) return reply.code(409).send({ error: 'Run is not in this plan' });

    await prisma.testRun.update({ where: { id: runId }, data: { planId: null } });

    return reply.code(200).send({ message: 'Run removed from plan' });
  });
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeRunStats(results: { status: string }[]) {
  const counts = { pass: 0, fail: 0, blocked: 0, skipped: 0, not_applicable: 0 };
  results.forEach(r => {
    if (r.status in counts) counts[r.status as keyof typeof counts]++;
  });
  const total = results.length;
  const passRate = total > 0 ? Math.round((counts.pass / total) * 100) : null;
  return { resultCounts: counts, resultTotal: total, passRate };
}

function computeAggregate(allResults: { status: string }[][]) {
  const flat = allResults.flat();
  return computeRunStats(flat);
}

function emptyAggregate() {
  return { resultCounts: { pass: 0, fail: 0, blocked: 0, skipped: 0, not_applicable: 0 }, resultTotal: 0, passRate: null };
}
