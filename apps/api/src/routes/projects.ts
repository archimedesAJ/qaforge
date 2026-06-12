import type { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { sendInviteEmail, sendProjectAddedEmail } from '../services/email.js';
import { processDigest } from '../jobs/weeklyDigest.js';

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
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
      return { projects, isSystemAdmin: true };
    }

    const memberships = await prisma.projectMember.findMany({
      where: { userId },
      include: { project: true },
    });
    return { projects: memberships.map((m: { project: unknown }) => m.project), isSystemAdmin: false };
  });

  // POST /projects — create a new project (any authenticated user)
  app.post('/', async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const body = CreateProjectSchema.parse(req.body);

    const existing = await prisma.project.findUnique({ where: { slug: body.slug } });
    if (existing) return reply.code(409).send({ error: 'Slug already taken' });

    const project = await prisma.project.create({
      data: {
        ...body,
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

    return reply.code(201).send({ status: 'invited', email: body.email });
  });

  // PATCH /projects/:projectId/members/:memberId — change role — admin only
  app.patch('/:projectId/members/:memberId', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { projectId, memberId } = req.params as { projectId: string; memberId: string };
    const { role } = req.body as { role: string };

    const validRoles = ['admin', 'manager', 'editor', 'viewer'];
    if (!validRoles.includes(role)) return reply.code(400).send({ error: 'Invalid role' });

    await prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId: memberId } },
      data: { role },
    });
    return { updated: true };
  });

  // DELETE /projects/:projectId/members/:memberId — admin only
  app.delete('/:projectId/members/:memberId', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { projectId, memberId } = req.params as { projectId: string; memberId: string };
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: memberId } },
    });
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
  app.get('/sysadmin/overview', async (req, reply) => {
    const caller = (req as unknown as { isSystemAdmin?: boolean });
    if (!caller.isSystemAdmin) return reply.code(403).send({ error: 'System admin access required' });

    const [totalUsers, activatedUsers, projects, recentRuns, openDefectsGroups, openRunsCount] = await Promise.all([
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
    ]);

    const openDefectsMap: Record<string, number> = {};
    for (const g of openDefectsGroups) openDefectsMap[g.projectId] = g._count.id;

    const totalCases      = projects.reduce((s, p) => s + p._count.cases, 0);
    const totalOpenDefects = openDefectsGroups.reduce((s, g) => s + g._count.id, 0);

    return {
      stats: {
        totalProjects: projects.length,
        totalUsers,
        activatedUsers,
        totalCases,
        openRuns: openRunsCount,
        openDefects: totalOpenDefects,
      },
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        counts: { cases: p._count.cases, runs: p._count.runs, members: p._count.members },
        openDefects: openDefectsMap[p.id] ?? 0,
        latestRun: p.runs[0] ?? null,
      })),
      recentRuns,
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
};
