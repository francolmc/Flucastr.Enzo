import { Router, Request, Response } from 'express';
import { MemoryService, parseMemoryKeyFromRequest } from '@enzo/core';

export function createMemoryRouter(memoryService: MemoryService): Router {
  const router = Router();

  router.get('/api/memory/:userId/:key/history', async (req: Request, res: Response) => {
    try {
      const { userId, key } = req.params;
      const canonicalKey = parseMemoryKeyFromRequest(key);
      if (!canonicalKey) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid or unknown memory key',
          statusCode: 400,
        });
        return;
      }

      const history = await memoryService.recallMemoryHistory(userId, canonicalKey);
      res.json({ history });
    } catch (error) {
      console.error('[GET /api/memory/:userId/:key/history] error:', error);
      res.status(500).json({
        error: 'RetrievalError',
        message: error instanceof Error ? error.message : 'Failed to retrieve memory history',
        statusCode: 500,
      });
    }
  });

  router.get('/api/memory/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      const memories = await memoryService.recall(userId);

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

  router.post('/api/memory/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const body = req.body as { key?: unknown; value?: unknown };

      const rawKey = typeof body.key === 'string' ? body.key : '';
      const canonicalKey = parseMemoryKeyFromRequest(rawKey);
      if (!canonicalKey) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid or unknown memory key',
          statusCode: 400,
        });
        return;
      }

      const valueStr = typeof body.value === 'string' ? body.value.trim() : '';
      if (valueStr.length === 0) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'value must be a non-empty string',
          statusCode: 400,
        });
        return;
      }

      const existing = await memoryService.recall(userId, canonicalKey);
      if (existing.length > 0) {
        res.status(409).json({
          error: 'Conflict',
          message: 'Memory already exists for this key; use PUT to update',
          statusCode: 409,
        });
        return;
      }

      await memoryService.remember(userId, canonicalKey, valueStr, { source: 'api', confidence: 1 });
      res.status(201).json({ success: true, key: canonicalKey });
    } catch (error) {
      console.error('[POST /api/memory/:userId] error:', error);
      res.status(500).json({
        error: 'CreateError',
        message: error instanceof Error ? error.message : 'Failed to create memory',
        statusCode: 500,
      });
    }
  });

  router.put('/api/memory/:userId/:key', async (req: Request, res: Response) => {
    try {
      const { userId, key: keyParam } = req.params;
      const body = req.body as { value?: unknown };

      const canonicalKey = parseMemoryKeyFromRequest(keyParam);
      if (!canonicalKey) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid or unknown memory key',
          statusCode: 400,
        });
        return;
      }

      const valueStr = typeof body.value === 'string' ? body.value.trim() : '';
      if (valueStr.length === 0) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'value must be a non-empty string',
          statusCode: 400,
        });
        return;
      }

      const existing = await memoryService.recall(userId, canonicalKey);
      if (existing.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: 'No memory exists for this key',
          statusCode: 404,
        });
        return;
      }

      await memoryService.remember(userId, canonicalKey, valueStr, { source: 'api', confidence: 1 });
      res.json({ success: true, key: canonicalKey });
    } catch (error) {
      console.error('[PUT /api/memory/:userId/:key] error:', error);
      res.status(500).json({
        error: 'UpdateError',
        message: error instanceof Error ? error.message : 'Failed to update memory',
        statusCode: 500,
      });
    }
  });

  router.delete('/api/memory/:userId/:key', async (req: Request, res: Response) => {
    try {
      const { userId, key } = req.params;

      await memoryService.deleteMemory(userId, key);

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
