import type { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const RegisterSchema = LoginSchema.extend({ name: z.string().min(1) });

const AcceptInviteSchema = z.object({
  token:    z.string().min(1),
  name:     z.string().min(1),
  password: z.string().min(8),
});

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export const authRoutes: FastifyPluginAsync = async (app) => {

  // POST /auth/register — only when REGISTRATION_ENABLED=true (dev / first-run bootstrap)
  app.post('/register', async (req, reply) => {
    if (process.env.REGISTRATION_ENABLED !== 'true') {
      return reply.code(403).send({ error: 'Self-registration is disabled. Ask your admin to invite you.' });
    }

    const body = RegisterSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.code(409).send({ error: 'Email already registered' });

    const user = await prisma.user.create({
      data: {
        email:        body.email,
        name:         body.name,
        passwordHash: hashPassword(body.password),
        activated:    true,
      },
    });

    const token = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: '24h' });
    return reply.code(201).send({ token, user: { id: user.id, email: user.email, name: user.name, systemAdmin: user.systemAdmin } });
  });

  // POST /auth/login
  app.post('/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    if (!user || user.passwordHash !== hashPassword(body.password)) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }
    if (!user.activated) {
      return reply.code(403).send({ error: 'Account not yet activated. Check your invite email.' });
    }

    const token = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: '24h' });
    return { token, user: { id: user.id, email: user.email, name: user.name, systemAdmin: user.systemAdmin } };
  });

  // POST /auth/accept-invite — set name + password from an invite token
  app.post('/accept-invite', async (req, reply) => {
    const body = AcceptInviteSchema.parse(req.body);

    const invite = await prisma.userInvite.findUnique({ where: { token: body.token } });
    if (!invite) return reply.code(404).send({ error: 'Invite not found or already used' });
    if (invite.expiresAt < new Date()) return reply.code(410).send({ error: 'Invite has expired' });

    // Find the pre-created user record for this email
    const user = await prisma.user.findUnique({ where: { email: invite.email } });
    if (!user) return reply.code(404).send({ error: 'User record not found' });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        name:         body.name,
        passwordHash: hashPassword(body.password),
        activated:    true,
      },
    });

    // Consume the invite
    await prisma.userInvite.delete({ where: { id: invite.id } });

    const jwtToken = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: '24h' });
    return reply.code(200).send({
      token: jwtToken,
      user:  { id: user.id, email: user.email, name: body.name, systemAdmin: user.systemAdmin },
    });
  });

  // GET /auth/invite/:token — validate token before showing accept form
  app.get('/invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = await prisma.userInvite.findUnique({
      where: { token },
      select: { email: true, role: true, expiresAt: true, project: { select: { name: true } } },
    });
    if (!invite) return reply.code(404).send({ error: 'Invite not found or already used' });
    if (invite.expiresAt < new Date()) return reply.code(410).send({ error: 'Invite has expired' });
    return { email: invite.email, role: invite.role, projectName: invite.project.name };
  });

  // POST /auth/api-keys (authenticated)
  app.post('/api-keys', { preHandler: authenticate }, async (req, reply) => {
    const { name, projectId, scope = 'write:results' } = req.body as {
      name: string; projectId: string; scope?: string;
    };

    const plaintext = `tms_k_${crypto.randomBytes(24).toString('hex')}`;
    const hash = crypto.createHash('sha256').update(plaintext).digest('hex');

    await prisma.apiKey.create({ data: { name, projectId, keyHash: hash, scope } });
    return reply.code(201).send({ key: plaintext, name, scope });
  });

  // DELETE /auth/api-keys/:keyId (authenticated)
  app.delete('/api-keys/:keyId', { preHandler: authenticate }, async (req, reply) => {
    const { keyId } = req.params as { keyId: string };
    await prisma.apiKey.delete({ where: { id: keyId } });
    return reply.code(204).send();
  });
};
