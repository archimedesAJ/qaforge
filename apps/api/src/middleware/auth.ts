import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';

// Role hierarchy — higher rank = more access
const ROLE_RANK: Record<string, number> = {
  viewer:  0,
  editor:  1,
  manager: 2,
  admin:   3,
};

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return reply.code(401).send({ error: 'Missing Authorization header' });
  }

  // API key auth (CI/CD pipelines)
  if (authHeader.startsWith('Bearer tms_k_')) {
    const key = authHeader.replace('Bearer ', '');
    const hash = crypto.createHash('sha256').update(key).digest('hex');

    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
    if (!apiKey) return reply.code(401).send({ error: 'Invalid API key' });

    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    (req as FastifyRequest & { projectId: string; isApiKey: boolean }).projectId = apiKey.projectId;
    (req as FastifyRequest & { isApiKey: boolean }).isApiKey = true;
    return;
  }

  // JWT auth (web app)
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Invalid or expired token' });
  }

  // Block unactivated accounts; attach systemAdmin to req for downstream use
  const { userId } = req.user as { userId: string };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { activated: true, systemAdmin: true } });
  if (!user?.activated) {
    return reply.code(403).send({ error: 'Account not yet activated. Check your invite email.' });
  }
  (req as FastifyRequest & { isSystemAdmin: boolean }).isSystemAdmin = user.systemAdmin ?? false;
}

/**
 * requireRole(min) — preHandler that checks the caller has at least `min` role in the project.
 * API-key requests are treated as editor-level (result submission only).
 */
export function requireRole(min: keyof typeof ROLE_RANK) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const extended = req as FastifyRequest & { isApiKey?: boolean; projectId?: string; isSystemAdmin?: boolean };

    // API key: grant editor-level access only
    if (extended.isApiKey) {
      if (ROLE_RANK['editor'] < ROLE_RANK[min]) {
        return reply.code(403).send({ error: 'API keys cannot perform this action' });
      }
      return;
    }

    // System admins bypass all project-level role checks
    if (extended.isSystemAdmin) return;

    const { userId } = req.user as { userId: string };
    const { projectId } = req.params as { projectId?: string };
    if (!projectId) return;

    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });

    if (!member) {
      return reply.code(403).send({ error: 'Not a member of this project' });
    }
    if ((ROLE_RANK[member.role] ?? -1) < ROLE_RANK[min]) {
      return reply.code(403).send({ error: `Requires ${min} role or above` });
    }
  };
}

/** Require a project-scoped capability granted directly to a member. */
export function requireProjectCapability(capability: 'canBulkUploadDefects') {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const extended = req as FastifyRequest & { isApiKey?: boolean; isSystemAdmin?: boolean };
    if (extended.isSystemAdmin) return;
    if (extended.isApiKey) {
      return reply.code(403).send({ error: 'API keys cannot perform this action' });
    }

    const { userId } = req.user as { userId: string };
    const { projectId } = req.params as { projectId?: string };
    if (!projectId) return reply.code(400).send({ error: 'Project is required' });

    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true, [capability]: true },
    });
    if (!member || ROLE_RANK[member.role] < ROLE_RANK.editor || !member[capability]) {
      return reply.code(403).send({ error: 'Bulk defect upload permission is required' });
    }
  };
}
