import type { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { sendInviteEmail, sendProjectAddedEmail } from '../services/email.js';
import { logActivity } from '../lib/activityLog.js';
import { processDigest } from '../jobs/weeklyDigest.js';

const CATEGORIES = ['client-facing', 'internal', 'infrastructure', 'third-party'] as const;
const STAGES     = ['live', 'in_development', 'new'] as const;

const CreateProjectSchema = z.object({
  name:     z.string().min(1).max(100),
  slug:     z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  category: z.enum(CATEGORIES).optional(),
  stage:    z.enum(STAGES).optional(),
});

const UpdateProjectSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  category: z.enum(CATEGORIES).nullable().optional(),
  stage:    z.enum(STAGES).nullable().optional(),
});

const InviteSchema = z.object({
  email: z.string().email(),
  role:  z.enum(['manager', 'editor', 'viewer']).default('editor'),
});

export const projectsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  // GET /projects — list projects; system admins see all
  app.get('/', async (req) => {
    const { userId } = req.user as { userId: string };
    const isSystemAdmin = (req as unknown as { isSystemAdmin?: boolean }).isSystemAdmin;

    if (isSystemAdmin) {
      const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
      return { projects: projects.map(p => ({ ...p, userRole: 'admin' })), isSystemAdmin: true };
    }

    const memberships = await prisma.projectMember.findMany({
      where: { userId },
      include: { project: true },
    });
    return {
      projects: memberships.map((m: { project: unknown; role: string }) => ({ ...(m.project as object), userRole: m.role })),
      isSystemAdmin: false,
    };
  });

  // POST /projects — create a new project (any authenticated user)
  app.post('/', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
    }
    const body = parsed.data;

    const existing = await prisma.project.findUnique({ where: { slug: body.slug } });
    if (existing) return reply.code(409).send({ error: 'Slug already taken' });

    const project = await prisma.project.create({
      data: {
        name: body.name,
        slug: body.slug,
        category: body.category ?? null,
        stage: body.stage ?? null,
        ownerId: userId,
        members: { create: { userId, role: 'admin' } },
      },
    });

    return reply.code(201).send(project);
  });

  // GET /projects/:projectId — viewer+
  app.get('/:projectId', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, name: true, activated: true } } },
        },
      },
    });
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    // Attach pending invites so the UI can show them alongside members
    const pendingInvites = await prisma.userInvite.findMany({
      where: { projectId },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
    });

    return { ...project, pendingInvites };
  });

  // PATCH /projects/:projectId — update name / category — admin only
  app.patch('/:projectId', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = UpdateProjectSchema.parse(req.body);

    const existing = await prisma.project.findUnique({ where: { id: projectId } });
    if (!existing) return reply.code(404).send({ error: 'Project not found' });

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(body.name     !== undefined && { name: body.name.trim() }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.stage    !== undefined && { stage: body.stage }),
      },
    });

    return updated;
  });

  // GET /projects/:projectId/api-keys — admin only
  app.get('/:projectId/api-keys', { preHandler: requireRole('admin') }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    const keys = await prisma.apiKey.findMany({
      where: { projectId },
      select: { id: true, name: true, scope: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { keys };
  });

  // GET /projects/:projectId/members/search-users?q= — manager+
  // Search existing activated users not already on this project, for the invite picker.
  app.get('/:projectId/members/search-users', { preHandler: requireRole('manager') }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { q = '' } = req.query as { q?: string };
    if (q.trim().length < 2) return { users: [] };

    const existingMemberIds = await prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
    });

    const users = await prisma.user.findMany({
      where: {
        activated: true,
        id: { notIn: existingMemberIds.map(m => m.userId) },
        OR: [
          { name:  { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
      take: 8,
    });
    return { users };
  });

  // POST /projects/:projectId/members/invite — manager+
  app.post('/:projectId/members/invite', { preHandler: requireRole('manager') }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { userId } = req.user as { userId: string };
    const body = InviteSchema.parse(req.body);

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const inviter = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    // If user already exists and is activated, check they aren't already a member
    const existingUser = await prisma.user.findUnique({ where: { email: body.email } });
    if (existingUser?.activated) {
      const alreadyMember = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: existingUser.id } },
      });
      if (alreadyMember) {
        return reply.code(409).send({ error: 'User is already a member of this project' });
      }
      await prisma.projectMember.create({
        data: { projectId, userId: existingUser.id, role: body.role },
      });
      sendProjectAddedEmail({
        to:          body.email,
        inviterName: inviter?.name ?? 'A team member',
        projectName: project.name,
        role:        body.role,
      }).catch(() => {});
      const { isSystemAdmin } = req as { isSystemAdmin?: boolean };
      logActivity({ userId, isSystemAdmin, projectId, action: 'member_added', entityType: 'member', entityName: body.email });
      return reply.code(201).send({ status: 'added', email: body.email });
    }

    // Reject if a non-expired invite already exists for this email + project
    const existingInvite = await prisma.userInvite.findFirst({
      where: { email: body.email, projectId, expiresAt: { gt: new Date() } },
    });
    if (existingInvite) {
      return reply.code(409).send({ error: 'A pending invite already exists for this email. Delete it first or wait for it to expire.' });
    }

    // Create a placeholder user if they don't exist yet
    if (!existingUser) {
      const newUser = await prisma.user.create({
        data: {
          email:        body.email,
          name:         '',
          passwordHash: '',
          activated:    false,
        },
      });
      await prisma.projectMember.create({
        data: { projectId, userId: newUser.id, role: body.role },
      });
    } else {
      // Exists but not activated — ensure project membership exists
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: existingUser.id } },
        update: { role: body.role },
        create: { projectId, userId: existingUser.id, role: body.role },
      });
    }

    // Create or refresh invite token (delete old one first)
    await prisma.userInvite.deleteMany({ where: { email: body.email, projectId } });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.userInvite.create({
      data: { email: body.email, token, projectId, role: body.role, invitedById: userId, expiresAt },
    });

    await sendInviteEmail({
      to:          body.email,
      inviterName: inviter?.name ?? 'A team member',
      projectName: project.name,
      role:        body.role,
      token,
    });

    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };
    logActivity({ userId, isSystemAdmin, projectId, action: 'member_invited', entityType: 'member', entityName: body.email });
    return reply.code(201).send({ status: 'invited', email: body.email });
  });

  // PATCH /projects/:projectId/members/:memberId — change role — admin only
  app.patch('/:projectId/members/:memberId', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { projectId, memberId } = req.params as { projectId: string; memberId: string };
    const { userId } = req.user as { userId: string };
    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };
    const { role } = req.body as { role: string };

    const validRoles = ['admin', 'manager', 'editor', 'viewer'];
    if (!validRoles.includes(role)) return reply.code(400).send({ error: 'Invalid role' });

    await prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId: memberId } },
      data: {
        role,
        // A viewer must never retain an actionable editor-level capability.
        ...(role === 'viewer' && { canBulkUploadDefects: false }),
      },
    });

    logActivity({ userId, isSystemAdmin, projectId, action: 'member_role_changed', entityType: 'member', entityId: memberId });

    return { updated: true };
  });

  // PATCH /projects/:projectId/members/:memberId/permissions — grant member-specific capabilities
  app.patch('/:projectId/members/:memberId/permissions', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { projectId, memberId } = req.params as { projectId: string; memberId: string };
    const { userId } = req.user as { userId: string };
    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };
    const body = z.object({ canBulkUploadDefects: z.boolean() }).parse(req.body);

    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: memberId } },
      select: { role: true },
    });
    if (!member) return reply.code(404).send({ error: 'Project member not found' });
    if (body.canBulkUploadDefects && !['editor', 'manager', 'admin'].includes(member.role)) {
      return reply.code(400).send({ error: 'Bulk defect upload can only be granted to editor-level members' });
    }

    await prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId: memberId } },
      data: body,
    });
    logActivity({
      userId, isSystemAdmin, projectId,
      action: body.canBulkUploadDefects ? 'member_permission_granted' : 'member_permission_revoked',
      entityType: 'member', entityId: memberId, entityName: 'Bulk defect upload',
    });
    return { updated: true };
  });

  // DELETE /projects/:projectId/members/:memberId — admin only
  app.delete('/:projectId/members/:memberId', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { projectId, memberId } = req.params as { projectId: string; memberId: string };
    const { userId } = req.user as { userId: string };
    const { isSystemAdmin } = req as { isSystemAdmin?: boolean };

    const memberUser = await prisma.user.findUnique({ where: { id: memberId }, select: { name: true, email: true } });

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: memberId } },
    });

    logActivity({ userId, isSystemAdmin, projectId, action: 'member_removed', entityType: 'member', entityId: memberId, entityName: memberUser?.name || memberUser?.email });

    return reply.code(204).send();
  });

  // DELETE /projects/:projectId/invites/:inviteId — cancel a pending invite — manager+
  app.delete('/:projectId/invites/:inviteId', { preHandler: requireRole('manager') }, async (req, reply) => {
    const { inviteId } = req.params as { projectId: string; inviteId: string };
    await prisma.userInvite.delete({ where: { id: inviteId } });
    return reply.code(204).send();
  });

  // DELETE /projects/:projectId — admin only, deletes everything
  app.delete('/:projectId', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    await prisma.project.delete({ where: { id: projectId } });
    return reply.code(204).send();
  });

  // ── System-admin management ───────────────────────────────────────────────
  // Only an existing system admin can promote or demote another user.

  // PATCH /sysadmin/users/:userId — promote or demote a user
  app.patch('/sysadmin/users/:userId', async (req, reply) => {
    const caller = (req as unknown as { isSystemAdmin?: boolean });
    if (!caller.isSystemAdmin) return reply.code(403).send({ error: 'System admin access required' });

    const { userId } = req.params as { userId: string };
    const { systemAdmin } = req.body as { systemAdmin: boolean };
    if (typeof systemAdmin !== 'boolean') return reply.code(400).send({ error: 'systemAdmin must be a boolean' });

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
    if (!target) return reply.code(404).send({ error: 'User not found' });

    await prisma.user.update({ where: { id: userId }, data: { systemAdmin } });
    return { userId, email: target.email, name: target.name, systemAdmin };
  });

  // GET /sysadmin/overview — system-wide stats and per-project health (sysadmin only)
  // Optional query params: since=<ISO> &until=<ISO> for date-bounded KPI metrics
  app.get('/sysadmin/overview', async (req, reply) => {
    const caller = (req as unknown as { isSystemAdmin?: boolean });
    if (!caller.isSystemAdmin) return reply.code(403).send({ error: 'System admin access required' });

    const { since, until } = req.query as { since?: string; until?: string };
    const sinceDate    = since ? new Date(since) : null;
    const untilDate    = until ? new Date(until) : null;
    const isDateBounded = !!(sinceDate && untilDate);

    // ── Base queries (always run, unaffected by date range) ──────
    const AUTOMATED_TYPES = ['ui_auto', 'api', 'perf', 'functional'];

    const [
      totalUsers, activatedUsers, projects, recentRuns,
      openDefectsGroups, openRunsCount, flakyGroups, activePlans, caseTypeGroups, recentlyClosedPlans,
      resolvedDefectsCount,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { activated: true } }),
      prisma.project.findMany({
        include: {
          _count: { select: { cases: { where: { archived: false } }, runs: true, members: true } },
          runs: {
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: { id: true, name: true, env: true, status: true, startedAt: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.testRun.findMany({
        select: {
          id: true, name: true, env: true, status: true, startedAt: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: { startedAt: 'desc' },
        take: 10,
      }),
      prisma.defect.groupBy({
        by: ['projectId'],
        where: { status: { in: ['open', 'in_progress'] } },
        _count: { id: true },
      }),
      prisma.testRun.count({ where: { status: 'open' } }),
      // Flakiness is always current-state — date-filtering it is not meaningful
      prisma.flakinessScore.groupBy({
        by: ['projectId'],
        where: { score: { gt: 0 } },
        _count: { id: true },
      }),
      // Active sprint plans with result counts for sprint health
      prisma.testPlan.findMany({
        where: { status: 'active' },
        select: {
          id: true,
          projectId: true,
          name: true,
          milestone: true,
          endsAt: true,
          runs: {
            select: {
              results: { select: { status: true } },
            },
          },
        },
      }),
      // Automation split — automated (ui_auto, api, perf, functional) vs manual
      prisma.testCase.groupBy({
        by: ['projectId', 'type'],
        where: { archived: false },
        _count: { id: true },
      }),
      // Plans archived in the last 14 days — "recently completed"
      prisma.testPlan.findMany({
        where: {
          status: 'archived',
          updatedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
        select: {
          id: true,
          projectId: true,
          name: true,
          milestone: true,
          updatedAt: true,
          project: { select: { name: true } },
          runs: { select: { results: { select: { status: true } } } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      // Defects resolved/closed within the selected period (or all-time if no range)
      prisma.defect.count({
        where: {
          status: { in: ['resolved', 'closed'] },
          ...(isDateBounded && { updatedAt: { gte: sinceDate!, lte: untilDate! } }),
        },
      }),
    ]);

    // Build per-project active plan map with sprint pass rate
    type ActivePlanInfo = { id: string; name: string; milestone: string | null; endsAt: string | null; passRate: number | null; failCount: number; blockedCount: number };
    const activePlanByProject: Record<string, ActivePlanInfo> = {};
    for (const plan of activePlans) {
      const allResults = plan.runs.flatMap(r => r.results);
      const conclusive = allResults.filter(r => r.status === 'pass' || r.status === 'fail');
      const passCount  = conclusive.filter(r => r.status === 'pass').length;
      const failCount  = allResults.filter(r => r.status === 'fail').length;
      const blockedCount = allResults.filter(r => r.status === 'blocked').length;
      const sprintPassRate = conclusive.length > 0 ? Math.round((passCount / conclusive.length) * 100) : null;
      activePlanByProject[plan.projectId] = {
        id: plan.id, name: plan.name, milestone: plan.milestone,
        endsAt: (plan as unknown as { endsAt?: Date | null }).endsAt?.toISOString() ?? null,
        passRate: sprintPassRate, failCount, blockedCount,
      };
    }

    // Build recently completed list
    const recentlyCompleted = recentlyClosedPlans.map(plan => {
      const allResults = plan.runs.flatMap(r => r.results);
      const conclusive = allResults.filter(r => r.status === 'pass' || r.status === 'fail');
      const passCount  = conclusive.filter(r => r.status === 'pass').length;
      const failCount  = allResults.filter(r => r.status === 'fail').length;
      const passRate   = conclusive.length > 0 ? Math.round((passCount / conclusive.length) * 100) : null;
      return {
        id: plan.id, name: plan.name, milestone: plan.milestone,
        projectId: plan.projectId,
        projectName: (plan as unknown as { project: { name: string } }).project.name,
        closedAt: plan.updatedAt.toISOString(),
        passRate, failCount, total: allResults.length,
      };
    });

    const openDefectsMap: Record<string, number> = {};
    for (const g of openDefectsGroups) openDefectsMap[g.projectId] = g._count.id;

    const flakyMap: Record<string, number> = {};
    for (const g of flakyGroups) flakyMap[g.projectId] = g._count.id;

    const automatedMap: Record<string, number> = {};
    const manualMap:    Record<string, number> = {};
    for (const g of caseTypeGroups) {
      const pid = g.projectId;
      if (AUTOMATED_TYPES.includes(g.type)) {
        automatedMap[pid] = (automatedMap[pid] ?? 0) + g._count.id;
      } else {
        manualMap[pid] = (manualMap[pid] ?? 0) + g._count.id;
      }
    }

    // ── KPI queries — date-bounded live OR pre-aggregated snapshot ──
    let covStateMap:     Record<string, { healthy: number; stale: number; failing: number }> = {};
    let passRateMap:     Record<string, number | null> = {};
    let executedCasesMap: Record<string, number> = {};

    if (isDateBounded) {
      // Fetch every RunResult in the period
      const periodResults = await prisma.runResult.findMany({
        where: { executedAt: { gte: sinceDate!, lte: untilDate! } },
        select: { testCaseId: true, status: true, run: { select: { projectId: true } } },
      });

      // Group: projectId → testCaseId → {pass, total}
      // Only pass/fail are conclusive verdicts — blocked and skipped do not
      // reflect test quality and must not count against pass rate.
      const pcMap: Record<string, Record<string, { pass: number; total: number }>> = {};
      for (const r of periodResults) {
        if (r.status !== 'pass' && r.status !== 'fail') continue;
        const pid  = r.run.projectId;
        const tcid = r.testCaseId;
        if (!pcMap[pid])       pcMap[pid] = {};
        if (!pcMap[pid][tcid]) pcMap[pid][tcid] = { pass: 0, total: 0 };
        pcMap[pid][tcid].total++;
        if (r.status === 'pass') pcMap[pid][tcid].pass++;
      }

      // Resolve lineageId for every executed testCaseId so that multiple versions
      // of the same case (created by in-run editing) count as one executed case.
      // Without this, executed can exceed totalCases and coverage exceeds 100%.
      const allExecutedIds = [...new Set(periodResults.map(r => r.testCaseId))];
      const caseLineages = allExecutedIds.length > 0
        ? await prisma.testCase.findMany({
            where: { id: { in: allExecutedIds } },
            select: { id: true, projectId: true, lineageId: true },
          })
        : [];
      const lineageById: Record<string, string> = {};
      for (const c of caseLineages) {
        lineageById[c.id] = (c as unknown as { lineageId?: string | null }).lineageId ?? c.id;
      }

      // Fetch currently active (non-archived) cases for each project that has period results.
      // This lets us exclude deprecated/deleted lineages from the executed count so the
      // numerator can never exceed the denominator (p._count.cases).
      const projectIdsWithResults = Object.keys(pcMap);
      const activeCasesInScope = projectIdsWithResults.length > 0
        ? await prisma.testCase.findMany({
            where: { projectId: { in: projectIdsWithResults }, archived: false },
            select: { id: true, projectId: true, lineageId: true },
          })
        : [];
      const activeLineagesPerProject: Record<string, Set<string>> = {};
      for (const c of activeCasesInScope) {
        if (!activeLineagesPerProject[c.projectId]) activeLineagesPerProject[c.projectId] = new Set();
        activeLineagesPerProject[c.projectId].add(
          (c as unknown as { lineageId?: string | null }).lineageId ?? c.id,
        );
      }

      for (const [pid, casesMap] of Object.entries(pcMap)) {
        // Merge results by lineageId so versions of the same case aren't double-counted
        const byLineage: Record<string, { pass: number; total: number }> = {};
        for (const [tcid, counts] of Object.entries(casesMap)) {
          const lid = lineageById[tcid] ?? tcid;
          if (!byLineage[lid]) byLineage[lid] = { pass: 0, total: 0 };
          byLineage[lid].pass  += counts.pass;
          byLineage[lid].total += counts.total;
        }

        // Only count lineages that have a currently active case — excludes deprecated/deleted
        // lineages that would otherwise make the numerator exceed p._count.cases (denominator).
        const activeLineages = activeLineagesPerProject[pid] ?? new Set<string>();
        const activeEntries  = Object.entries(byLineage)
          .filter(([lid]) => activeLineages.has(lid))
          .map(([, e]) => e);

        const executed = activeEntries.length;
        const healthy  = activeEntries.filter(e => e.pass / e.total >= 0.8).length;
        const failing  = executed - healthy;
        const project  = projects.find(p => p.id === pid);
        const stale    = Math.max(0, (project?._count.cases ?? 0) - executed);

        covStateMap[pid]      = { healthy, stale, failing };
        executedCasesMap[pid] = executed;
        passRateMap[pid]      = executed > 0 ? Math.round(
          (activeEntries.reduce((s, e) => s + e.pass / e.total, 0) / executed) * 100
        ) : null;
      }
    } else {
      // Use pre-aggregated CoverageSnapshot (all-time, fast)
      const [coverageStateGroups, passRateGroups, executedCasesGroups] = await Promise.all([
        prisma.coverageSnapshot.groupBy({
          by: ['projectId', 'state'],
          _count: { testCaseId: true },
        }),
        prisma.coverageSnapshot.groupBy({
          by: ['projectId'],
          where: { passRate: { not: null } },
          _avg: { passRate: true },
        }),
        prisma.coverageSnapshot.groupBy({
          by: ['projectId'],
          where: { lastRunAt: { not: null } },
          _count: { testCaseId: true },
        }),
      ]);

      for (const g of coverageStateGroups) {
        if (!covStateMap[g.projectId]) covStateMap[g.projectId] = { healthy: 0, stale: 0, failing: 0 };
        const state = g.state as 'healthy' | 'stale' | 'failing';
        if (state in covStateMap[g.projectId]) covStateMap[g.projectId][state] = g._count.testCaseId;
      }
      for (const g of passRateGroups) {
        passRateMap[g.projectId] = g._avg.passRate != null
          ? Math.round(g._avg.passRate * 100)
          : null;
      }
      for (const g of executedCasesGroups) executedCasesMap[g.projectId] = g._count.testCaseId;
    }

    const totalCases       = projects.reduce((s, p) => s + p._count.cases, 0);
    const totalOpenDefects = openDefectsGroups.reduce((s, g) => s + g._count.id, 0);

    const activeSprints  = activePlans.length;
    const sprintsAtRisk  = Object.values(activePlanByProject)
      .filter(ap => ap.failCount > 0 || (ap.passRate !== null && ap.passRate < 70)).length;

    return {
      stats: {
        totalProjects: projects.length,
        totalUsers,
        activatedUsers,
        totalCases,
        openRuns: openRunsCount,
        openDefects:     totalOpenDefects,
        resolvedDefects: resolvedDefectsCount,
        activeSprints,
        sprintsAtRisk,
      },
      projects: projects.map(p => {
        const cov        = covStateMap[p.id] ?? { healthy: 0, stale: 0, failing: 0 };
        const executed   = executedCasesMap[p.id]; // undefined = no runs in scope (show —, not 0%)
        const totalCases = p._count.cases;
        return {
          id: p.id,
          name: p.name,
          slug: p.slug,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          counts: { cases: totalCases, runs: p._count.runs, members: p._count.members },
          openDefects: openDefectsMap[p.id] ?? 0,
          latestRun: p.runs[0] ?? null,
          passRate: passRateMap[p.id] ?? null,
          coveragePct: executed !== undefined && totalCases > 0
            ? Math.round((executed / totalCases) * 100)
            : null,
          coverageStats: cov,
          flakyCount:     flakyMap[p.id]     ?? 0,
          activePlan:     activePlanByProject[p.id] ?? null,
          automatedCases: automatedMap[p.id] ?? 0,
          manualCases:    manualMap[p.id]    ?? 0,
        };
      }),
      recentRuns,
      recentlyCompleted,
    };
  });

  // POST /sysadmin/digest/trigger — fire the weekly digest immediately (sysadmin only)
  app.post('/sysadmin/digest/trigger', async (req, reply) => {
    const caller = (req as unknown as { isSystemAdmin?: boolean });
    if (!caller.isSystemAdmin) return reply.code(403).send({ error: 'System admin access required' });

    // Run in the background so the HTTP response returns immediately
    processDigest()
      .then(() => app.log.info('[digest] manual trigger completed'))
      .catch(err => app.log.error('[digest] manual trigger failed:', err));

    return reply.code(202).send({ status: 'running', message: 'Digest job started — check server logs and your inbox.' });
  });

  // GET /sysadmin/users — list all users with their project memberships (sysadmin only)
  app.get('/sysadmin/users', async (req, reply) => {
    const caller = (req as unknown as { isSystemAdmin?: boolean });
    if (!caller.isSystemAdmin) return reply.code(403).send({ error: 'System admin access required' });

    const users = await prisma.user.findMany({
      select: {
        id: true, email: true, name: true,
        activated: true, systemAdmin: true, createdAt: true,
        memberships: {
          include: { project: { select: { id: true, name: true, slug: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { users };
  });

  // GET /sysadmin/weekly-summary — per-project activity counts for a date window (sysadmin only)
  app.get('/sysadmin/weekly-summary', async (req, reply) => {
    const caller = req as unknown as { isSystemAdmin?: boolean };
    if (!caller.isSystemAdmin) return reply.code(403).send({ error: 'System admin access required' });

    const { since, until } = req.query as { since?: string; until?: string };

    const sinceDate = since ? new Date(since) : (() => {
      const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); return d;
    })();
    const untilDate = until ? new Date(until) : new Date();

    const [projects, runsStarted, runsClosed, casesCreated, defectsFiled, defectsResolved, plansCreated] =
      await Promise.all([
        prisma.project.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } }),
        prisma.testRun.groupBy({ by: ['projectId'], where: { startedAt: { gte: sinceDate, lte: untilDate } }, _count: { id: true } }),
        prisma.testRun.groupBy({ by: ['projectId'], where: { endedAt: { gte: sinceDate, lte: untilDate }, status: 'closed' }, _count: { id: true } }),
        prisma.testCase.groupBy({ by: ['projectId'], where: { createdAt: { gte: sinceDate, lte: untilDate }, archived: false }, _count: { id: true } }),
        prisma.defect.groupBy({ by: ['projectId'], where: { createdAt: { gte: sinceDate, lte: untilDate } }, _count: { id: true } }),
        prisma.defect.groupBy({ by: ['projectId'], where: { updatedAt: { gte: sinceDate, lte: untilDate }, status: { in: ['resolved', 'closed'] } }, _count: { id: true } }),
        prisma.testPlan.groupBy({ by: ['projectId'], where: { createdAt: { gte: sinceDate, lte: untilDate } }, _count: { id: true } }),
      ]);

    const toMap = (arr: { projectId: string; _count: { id: number } }[]) =>
      Object.fromEntries(arr.map(r => [r.projectId, r._count.id]));

    const startedMap  = toMap(runsStarted);
    const closedMap   = toMap(runsClosed);
    const casesMap    = toMap(casesCreated);
    const filedMap    = toMap(defectsFiled);
    const resolvedMap = toMap(defectsResolved);
    const plansMap    = toMap(plansCreated);

    const allProjects = projects.map(p => ({
      id:              p.id,
      name:            p.name,
      slug:            p.slug,
      runsStarted:     startedMap[p.id]  ?? 0,
      runsClosed:      closedMap[p.id]   ?? 0,
      casesCreated:    casesMap[p.id]    ?? 0,
      defectsFiled:    filedMap[p.id]    ?? 0,
      defectsResolved: resolvedMap[p.id] ?? 0,
      plansCreated:    plansMap[p.id]    ?? 0,
    }));

    const active   = allProjects.filter(p => p.runsStarted + p.runsClosed + p.casesCreated + p.defectsFiled + p.defectsResolved + p.plansCreated > 0);
    const inactive = allProjects.filter(p => p.runsStarted + p.runsClosed + p.casesCreated + p.defectsFiled + p.defectsResolved + p.plansCreated === 0);

    const totals = active.reduce((acc, p) => ({
      runsStarted:     acc.runsStarted     + p.runsStarted,
      runsClosed:      acc.runsClosed      + p.runsClosed,
      casesCreated:    acc.casesCreated    + p.casesCreated,
      defectsFiled:    acc.defectsFiled    + p.defectsFiled,
      defectsResolved: acc.defectsResolved + p.defectsResolved,
      plansCreated:    acc.plansCreated    + p.plansCreated,
    }), { runsStarted: 0, runsClosed: 0, casesCreated: 0, defectsFiled: 0, defectsResolved: 0, plansCreated: 0 });

    return { since: sinceDate, until: untilDate, active, inactive: inactive.map(p => p.name), totals };
  });

  // GET /sysadmin/kpi-performance — 7 KPIs for current period + 3 prior same-length periods
  app.get('/sysadmin/kpi-performance', async (req, reply) => {
    const caller = req as unknown as { isSystemAdmin?: boolean };
    if (!caller.isSystemAdmin) return reply.code(403).send({ error: 'System admin access required' });

    const { since, until } = req.query as { since?: string; until?: string };
    const sinceDate = since ? new Date(since) : (() => {
      const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); return d;
    })();
    const untilDate = until ? new Date(until) : new Date();
    const periodMs  = untilDate.getTime() - sinceDate.getTime();

    // Build 4 periods: W-3, W-2, W-1, current
    const periods = [
      { label: 'w3',      gte: new Date(sinceDate.getTime() - 3 * periodMs), lte: new Date(sinceDate.getTime() - 2 * periodMs) },
      { label: 'w2',      gte: new Date(sinceDate.getTime() - 2 * periodMs), lte: new Date(sinceDate.getTime() - 1 * periodMs) },
      { label: 'w1',      gte: new Date(sinceDate.getTime() - 1 * periodMs), lte: sinceDate },
      { label: 'current', gte: sinceDate, lte: untilDate },
    ];

    // Total active cases — constant across periods
    const [totalCases, staleCases, totalProjects] = await Promise.all([
      prisma.testCase.count({ where: { archived: false } }),
      prisma.coverageSnapshot.count({ where: { state: 'stale' } }),
      prisma.project.count(),
    ]);

    async function computePeriod(gte: Date, lte: Date) {
      const [
        executedGroups,
        defectsFromRuns,
        totalDefectsFiled,
        criticalEscaping,
        resolvedDefects,
        runResultGroups,
        activeProjectGroups,
      ] = await Promise.all([
        prisma.runResult.groupBy({ by: ['testCaseId'], where: { executedAt: { gte, lte } } }),
        prisma.defect.count({ where: { createdAt: { gte, lte }, runResultId: { not: null } } }),
        prisma.defect.count({ where: { createdAt: { gte, lte } } }),
        prisma.defect.count({ where: { createdAt: { gte, lte }, severity: 'critical', runResultId: null } }),
        prisma.defect.findMany({
          where: { updatedAt: { gte, lte }, status: { in: ['resolved', 'closed'] } },
          select: { createdAt: true, updatedAt: true },
        }),
        prisma.runResult.groupBy({
          by: ['status'],
          where: { executedAt: { gte, lte }, status: { in: ['pass', 'fail'] } },
          _count: { id: true },
        }),
        prisma.testRun.groupBy({ by: ['projectId'], where: { startedAt: { gte, lte } } }),
      ]);

      const execRate = totalCases > 0 ? Math.round((executedGroups.length / totalCases) * 100) : null;
      const defectDetectionRate = totalDefectsFiled > 0
        ? Math.round((defectsFromRuns / totalDefectsFiled) * 100) : null;
      const avgResolutionHours = resolvedDefects.length > 0
        ? Math.round(resolvedDefects.reduce((s, d) =>
            s + (d.updatedAt.getTime() - d.createdAt.getTime()), 0
          ) / resolvedDefects.length / 3_600_000 * 10) / 10
        : null;
      const passCount = runResultGroups.find(g => g.status === 'pass')?._count.id ?? 0;
      const failCount = runResultGroups.find(g => g.status === 'fail')?._count.id ?? 0;
      const regressionPassRate = (passCount + failCount) > 0
        ? Math.round(passCount / (passCount + failCount) * 100) : null;

      return { execRate, defectDetectionRate, criticalEscaping, avgResolutionHours, regressionPassRate, activeProjects: activeProjectGroups.length };
    }

    const [w3, w2, w1, current] = await Promise.all(periods.map(p => computePeriod(p.gte, p.lte)));

    return {
      totalProjects,
      staleCases,
      since: sinceDate,
      until: untilDate,
      w3, w2, w1, current,
    };
  });

  // GET /sysadmin/activity — paginated activity log (sysadmin only)
  app.get('/sysadmin/activity', async (req, reply) => {
    const caller = req as unknown as { isSystemAdmin?: boolean };
    if (!caller.isSystemAdmin) return reply.code(403).send({ error: 'System admin access required' });

    const { projectId, userId, action, since, until, page = '1', limit = '50' } =
      req.query as Record<string, string>;

    const where: Record<string, unknown> = {
      ...(projectId && { projectId }),
      ...(userId    && { userId }),
      ...(action    && { action }),
      ...((since || until) && {
        createdAt: {
          ...(since && { gte: new Date(since) }),
          ...(until && { lte: new Date(until) }),
        },
      }),
    };

    const pageNum  = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.activityLog.count({ where }),
    ]);

    return { logs, pagination: { page: pageNum, limit: limitNum, total } };
  });
};
