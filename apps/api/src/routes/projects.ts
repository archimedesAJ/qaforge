import type { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { sendInviteEmail } from '../services/email.js';

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

  // GET /projects — list projects the current user is a member of
  app.get('/', async (req) => {
    const { userId } = req.user as { userId: string };
    const memberships = await prisma.projectMember.findMany({
      where: { userId },
      include: { project: true },
    });
    return { projects: memberships.map((m: { project: unknown }) => m.project) };
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

    // If user already exists and is activated, add them directly
    const existingUser = await prisma.user.findUnique({ where: { email: body.email } });
    if (existingUser?.activated) {
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: existingUser.id } },
        update: { role: body.role },
        create: { projectId, userId: existingUser.id, role: body.role },
      });
      return reply.code(201).send({ status: 'added', email: body.email });
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
};
