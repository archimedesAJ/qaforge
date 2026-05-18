import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
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

  // POST /projects — create a new project
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

  // GET /projects/:projectId
  app.get('/:projectId', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { members: { include: { user: { select: { id: true, email: true, name: true } } } } },
    });
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return project;
  });

  // GET /projects/:projectId/api-keys
  app.get('/:projectId/api-keys', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const keys = await prisma.apiKey.findMany({
      where: { projectId },
      select: { id: true, name: true, scope: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { keys };
  });

  // POST /projects/:projectId/members — invite a member
  app.post('/:projectId/members', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { email, role = 'editor' } = req.body as { email: string; role?: string };

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.code(404).send({ error: 'No user found with that email' });

    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: user.id } },
      update: { role },
      create: { projectId, userId: user.id, role },
    });

    return reply.code(201).send(member);
  });

  // DELETE /projects/:projectId/members/:userId
  app.delete('/:projectId/members/:userId', async (req, reply) => {
    const { projectId, userId } = req.params as { projectId: string; userId: string };
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId } },
    });
    return reply.code(204).send();
  });
};
