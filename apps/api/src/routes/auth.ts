import type { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const RegisterSchema = LoginSchema.extend({ name: z.string().min(1) });

function hashPassword(password: string): string {
  // NOTE: In production replace with bcrypt:
  // return bcrypt.hashSync(password, 12)
  return crypto.createHash('sha256').update(password).digest('hex');
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  // POST /auth/register
  app.post('/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.code(409).send({ error: 'Email already registered' });

    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash: hashPassword(body.password),
      },
    });

    const token = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: '24h' });
    return reply.code(201).send({ token, user: { id: user.id, email: user.email, name: user.name } });
  });

  // POST /auth/login
  app.post('/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    if (!user || user.passwordHash !== hashPassword(body.password)) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    const token = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: '24h' });
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  });

  // POST /auth/api-keys
  app.post('/api-keys', async (req, reply) => {
    const { name, projectId, scope = 'write:results' } = req.body as {
      name: string; projectId: string; scope?: string;
    };

    const plaintext = `tms_k_${crypto.randomBytes(24).toString('hex')}`;
    const hash = crypto.createHash('sha256').update(plaintext).digest('hex');

    await prisma.apiKey.create({ data: { name, projectId, keyHash: hash, scope } });

    // Return plaintext ONCE — never stored, never retrievable again
    return reply.code(201).send({ key: plaintext, name, scope });
  });

  // DELETE /auth/api-keys/:keyId
  app.delete('/api-keys/:keyId', async (req, reply) => {
    const { keyId } = req.params as { keyId: string };
    await prisma.apiKey.delete({ where: { id: keyId } });
    return reply.code(204).send();
  });
};
