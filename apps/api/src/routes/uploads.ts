import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads');
await mkdir(UPLOADS_DIR, { recursive: true });

const MIME: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mov':  'video/quicktime',
  '.txt':  'text/plain',
  '.log':  'text/plain',
  '.json': 'application/json',
  '.xml':  'application/xml',
  '.pdf':  'application/pdf',
};

export const uploadsRoutes: FastifyPluginAsync = async (app) => {
  // POST /uploads — upload an evidence file (authenticated)
  app.post('/', { preHandler: authenticate }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });

    const ext = extname(file.filename).toLowerCase() || '.bin';
    const filename = `${randomUUID()}${ext}`;
    const dest = join(UPLOADS_DIR, filename);

    await pipeline(file.file, createWriteStream(dest));

    return { url: `/api/uploads/${filename}` };
  });

  // GET /uploads/:filename — serve an uploaded file
  app.get('/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    if (filename.includes('/') || filename.includes('..')) {
      return reply.code(400).send({ error: 'Invalid filename' });
    }

    const filePath = join(UPLOADS_DIR, filename);
    try {
      await stat(filePath);
    } catch {
      return reply.code(404).send({ error: 'File not found' });
    }

    const ext = extname(filename).toLowerCase();
    reply.header('Content-Type', MIME[ext] ?? 'application/octet-stream');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(filePath));
  });
};
