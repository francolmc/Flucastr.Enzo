import { Router, Request, Response } from 'express';
import { MemoryService, MEMORY_KEYS } from '@enzo/core';
import { extractProjectsFromMemoryText } from '../lib/extractProjectsFromMemoryText.js';

export function createProjectsRouter(memoryService: MemoryService): Router {
  const router = Router();

  router.get('/api/projects/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const all = await memoryService.recall(userId);
      const rows = all
        .filter((m) => m.key === MEMORY_KEYS.PROJECTS || m.key === MEMORY_KEYS.OTHER)
        .map((m) => ({
          key: m.key,
          value: m.value,
          updatedAt: m.updatedAt,
        }));

      const projects = extractProjectsFromMemoryText(rows);
      res.json({ projects });
    } catch {
      res.json({ projects: [] });
    }
  });

  return router;
}
