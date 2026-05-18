import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return reply.code(401).send({ error: 'Missing Authorization header' });
  }

  // API key auth (used by CI/CD pipelines)
  if (authHeader.startsWith('Bearer tms_k_')) {
    const key = authHeader.replace('Bearer ', '');
    const hash = crypto.createHash('sha256').update(key).digest('hex');

    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
    if (!apiKey) {
      return reply.code(401).send({ error: 'Invalid API key' });
    }

    // Update last used timestamp (fire-and-forget)
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    // Attach projectId to request for downstream route use
    (req as FastifyRequest & { projectId: string }).projectId = apiKey.projectId;
    return;
  }

  // JWT auth (used by web app)
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Invalid or expired token' });
  }
}
