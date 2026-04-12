import { Router, Request, Response } from 'express';
import { MemoryService } from '@enzo/core';

export function createMemoryRouter(memoryService: MemoryService): Router {
  const router = Router();

  router.get('/api/memory/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      const memories = await (memoryService as any).recall(userId);

      res.json({
        memories,
      });
    } catch (error) {
      console.error('[GET /api/memory/:userId] error:', error);
      res.status(500).json({
        error: 'RetrievalError',
        message: error instanceof Error ? error.message : 'Failed to retrieve memories',
        statusCode: 500,
      });
    }
  });

  router.delete('/api/memory/:userId/:key', async (req: Request, res: Response) => {
    try {
      const { userId, key } = req.params;

      await (memoryService as any).deleteMemory(userId, key);

      res.json({
        success: true,
      });
    } catch (error) {
      console.error('[DELETE /api/memory/:userId/:key] error:', error);
      res.status(500).json({
        error: 'DeletionError',
        message: error instanceof Error ? error.message : 'Failed to delete memory',
        statusCode: 500,
      });
    }
  });

  return router;
}
