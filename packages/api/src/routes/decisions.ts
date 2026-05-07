import { Router, Request, Response } from 'express';
import { decisionLogger, type DecisionLog, type DecisionSummary } from '@enzo/core';

export function createDecisionsRouter(): Router {
  const router = Router();

  /**
   * GET /api/decisions/:requestId
   * Get all decisions for a specific request
   */
  router.get('/api/decisions/:requestId', async (req: Request, res: Response) => {
    const { requestId } = req.params;

    try {
      const logs = decisionLogger.getLogsForRequest(requestId);

      if (logs.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: `No decisions found for request ${requestId}`,
        });
        return;
      }

      res.json({
        requestId,
        count: logs.length,
        decisions: logs.map(log => ({
          phase: log.phase,
          decision: log.decision,
          reasoning: log.reasoning,
          alternatives: log.alternatives,
          timestamp: log.timestamp,
        })),
      });
    } catch (error) {
      console.error('[GET /api/decisions/:requestId] error:', error);
      res.status(500).json({
        error: 'InternalError',
        message: 'Failed to get decisions',
      });
    }
  });

  /**
   * GET /api/decisions/:requestId/summary
   * Get a summary of decisions for a specific request
   */
  router.get('/api/decisions/:requestId/summary', async (req: Request, res: Response) => {
    const { requestId } = req.params;

    try {
      const summary = decisionLogger.getSummary(requestId);

      if (!summary) {
        res.status(404).json({
          error: 'NotFound',
          message: `No decisions found for request ${requestId}`,
        });
        return;
      }

      res.json(summary);
    } catch (error) {
      console.error('[GET /api/decisions/:requestId/summary] error:', error);
      res.status(500).json({
        error: 'InternalError',
        message: 'Failed to get decision summary',
      });
    }
  });

  /**
   * GET /api/decisions/user/:userId
   * Get recent decisions for a user
   */
  router.get('/api/decisions/user/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    try {
      const logs = decisionLogger.getLogsForUser(userId, limit);

      res.json({
        userId,
        count: logs.length,
        decisions: logs.map(log => ({
          requestId: log.requestId,
          phase: log.phase,
          decision: log.decision,
          reasoning: log.reasoning,
          timestamp: log.timestamp,
        })),
      });
    } catch (error) {
      console.error('[GET /api/decisions/user/:userId] error:', error);
      res.status(500).json({
        error: 'InternalError',
        message: 'Failed to get user decisions',
      });
    }
  });

  /**
   * GET /api/decisions/recent
   * Get recent decisions across all requests
   */
  router.get('/api/decisions/recent', async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    try {
      const logs = decisionLogger.getRecentLogs(limit);

      res.json({
        count: logs.length,
        decisions: logs.map(log => ({
          requestId: log.requestId,
          userId: log.userId,
          phase: log.phase,
          decision: log.decision,
          timestamp: log.timestamp,
        })),
      });
    } catch (error) {
      console.error('[GET /api/decisions/recent] error:', error);
      res.status(500).json({
        error: 'InternalError',
        message: 'Failed to get recent decisions',
      });
    }
  });

  /**
   * GET /api/decisions/stats
   * Get decision statistics
   */
  router.get('/api/decisions/stats', async (_req: Request, res: Response) => {
    try {
      const stats = decisionLogger.getStats();
      res.json(stats);
    } catch (error) {
      console.error('[GET /api/decisions/stats] error:', error);
      res.status(500).json({
        error: 'InternalError',
        message: 'Failed to get decision stats',
      });
    }
  });

  /**
   * DELETE /api/decisions/user/:userId
   * Clear decisions for a user
   */
  router.delete('/api/decisions/user/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;

    try {
      decisionLogger.clearUserLogs(userId);
      res.json({ message: `Decisions cleared for user ${userId}` });
    } catch (error) {
      console.error('[DELETE /api/decisions/user/:userId] error:', error);
      res.status(500).json({
        error: 'InternalError',
        message: 'Failed to clear user decisions',
      });
    }
  });

  return router;
}