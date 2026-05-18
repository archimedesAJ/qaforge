import type { FastifyPluginAsync } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

const client = new Anthropic();

export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  // POST /projects/:projectId/ai/generate — streams SSE
  app.post('/:projectId/ai/generate', async (req, reply) => {
    const { requirement, type = 'manual', depth = 'happy_path_and_edge_cases' } =
      req.body as { requirement: string; type?: string; depth?: string };

    if (!requirement?.trim()) return reply.code(400).send({ error: 'requirement is required' });

    const depthDesc: Record<string, string> = {
      happy_path_and_edge_cases: 'happy path AND edge cases and error scenarios',
      happy_path_only:           'happy path only',
      edge_cases_only:           'edge cases and boundary conditions only',
      negative_cases_only:       'negative cases — invalid inputs and failure modes',
    };

    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    try {
      const stream = client.messages.stream({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system: `You are a senior QA engineer. Generate test cases as a JSON array.
Each item must have: title (string), priority ("p0"|"p1"|"p2"|"p3"), tags (string[]),
steps (array of {action: string, expected: string}).
Return ONLY a valid JSON array. No markdown, no explanation.`,
        messages: [{ role: 'user', content: `Generate ${type} test cases. Coverage: ${depthDesc[depth] ?? depth}.\n\nRequirement:\n${requirement}` }],
      });

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          reply.raw.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
        }
      }
      reply.raw.write('data: [DONE]\n\n');
    } catch {
      reply.raw.write(`data: ${JSON.stringify({ error: 'AI generation failed' })}\n\n`);
    }
    reply.raw.end();
  });

  // GET /projects/:projectId/ai/gaps
  app.get('/:projectId/ai/gaps', async (req) => {
    const { projectId } = req.params as { projectId: string };

    const cases = await prisma.testCase.findMany({
      where: { projectId, archived: false },
      select: { title: true, type: true },
    });

    const snapshots = await prisma.coverageSnapshot.findMany({ where: { projectId } });
    const stale   = snapshots.filter((s: { state: string }) => s.state === 'stale').length;
    const failing = snapshots.filter((s: { state: string }) => s.state === 'failing').length;
    const healthy = snapshots.filter((s: { state: string }) => s.state === 'healthy').length;

    if (cases.length === 0) return { gaps: [] };

    const summary = cases.slice(0, 40)
      .map((c: { title: string; type: string }) => `- ${c.title} (${c.type})`)
      .join('\n');

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `You are a QA coverage analyst. Identify coverage gaps in these test cases.

Test cases (${cases.length} total):
${summary}

Stats: ${healthy} healthy, ${stale} stale, ${failing} failing of ${snapshots.length} tracked.

Return 4-6 gaps as a JSON array. Each item: area (string), risk ("high"|"medium"|"low"),
reason (string), suggestion (string).
ONLY return valid JSON array, no markdown.`,
        }],
      });

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('');
      return { gaps: JSON.parse(text.replace(/```json|```/g, '').trim()) };
    } catch {
      return { gaps: [] };
    }
  });

  // GET /projects/:projectId/runs/:runId/ai/triage
  app.get('/:projectId/runs/:runId/ai/triage', async (req) => {
    const { runId } = req.params as { projectId: string; runId: string };

    const failures = await prisma.runResult.findMany({
      where: { runId, status: { in: ['fail', 'blocked'] } },
      include: { testCase: { select: { title: true, type: true } } },
    });

    if (failures.length === 0) return { clusters: [] };

    const summary = failures.map((f: {
      testCase?: { title: string; type: string } | null;
      errorMessage?: string | null;
      status: string;
    }) => ({ title: f.testCase?.title ?? 'Unknown', type: f.testCase?.type ?? 'unknown', status: f.status, error: f.errorMessage ?? '' }));

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Group these test failures by likely root cause.

Failures:
${JSON.stringify(summary, null, 2)}

Return 2-5 clusters as JSON array. Each: cause (string), confidence ("high"|"medium"|"low"),
hint (string), tests (string[]).
ONLY return valid JSON array, no markdown.`,
        }],
      });

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('');
      return { clusters: JSON.parse(text.replace(/```json|```/g, '').trim()) };
    } catch {
      return { clusters: [] };
    }
  });
};
