import { Router, Request, Response } from 'express';
import type { Orchestrator } from '@enzo/core';

export function createLessonsRouter(orchestrator?: Orchestrator): Router {
  const router = Router();

  if (!orchestrator) {
    console.warn('[LessonsRouter] Orchestrator not provided, endpoints will return 503');
  }

  /**
   * GET /api/lessons/:userId
   * Get lessons summary for a user
   */
  router.get('/api/lessons/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;

    if (!orchestrator) {
      res.status(503).json({ error: 'ServiceUnavailable', message: 'Orchestrator not available' });
      return;
    }

    try {
      const summary = orchestrator.getUserLessonsSummary(userId);
      res.json({ userId, count: summary.length, lessons: summary });
    } catch (error) {
      console.error('[GET /api/lessons/:userId] error:', error);
      res.status(500).json({ error: 'InternalError', message: 'Failed to get lessons' });
    }
  });

  /**
   * GET /api/lessons/:userId/task/:taskPattern
   * Get lessons for a specific task pattern
   */
  router.get('/api/lessons/:userId/task/:taskPattern', async (req: Request, res: Response) => {
    const { userId, taskPattern } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);

    if (!orchestrator) {
      res.status(503).json({ error: 'ServiceUnavailable', message: 'Orchestrator not available' });
      return;
    }

    try {
      const lessons = await orchestrator.getLessonsForTask(userId, taskPattern);
      res.json({ userId, taskPattern, count: lessons.length, lessons: lessons.slice(0, limit) });
    } catch (error) {
      console.error('[GET /api/lessons/:userId/task/:taskPattern] error:', error);
      res.status(500).json({ error: 'InternalError', message: 'Failed to get lessons for task' });
    }
  });

  /**
   * GET /api/lessons/detail/:lessonId
   * Get detailed information about a specific lesson
   */
  router.get('/api/lessons/detail/:lessonId', async (req: Request, res: Response) => {
    const { lessonId } = req.params;

    if (!orchestrator) {
      res.status(503).json({ error: 'ServiceUnavailable', message: 'Orchestrator not available' });
      return;
    }

    try {
      const lesson = orchestrator.getLessonDetails(lessonId);
      if (!lesson) {
        res.status(404).json({ error: 'NotFound', message: `Lesson ${lessonId} not found` });
        return;
      }
      res.json(lesson);
    } catch (error) {
      console.error('[GET /api/lessons/detail/:lessonId] error:', error);
      res.status(500).json({ error: 'InternalError', message: 'Failed to get lesson details' });
    }
  });

  /**
   * POST /api/lessons/:userId
   * Record a new lesson (success)
   */
  router.post('/api/lessons/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { taskPattern, complexity, strategy } = req.body;

    if (!orchestrator) {
      res.status(503).json({ error: 'ServiceUnavailable', message: 'Orchestrator not available' });
      return;
    }

    if (!taskPattern || !strategy) {
      res.status(400).json({ error: 'ValidationError', message: 'taskPattern and strategy are required' });
      return;
    }

    try {
      const lesson = await orchestrator.recordLessonSuccess(
        userId,
        taskPattern,
        complexity || 'unknown',
        strategy
      );
      res.json({ success: true, lesson });
    } catch (error) {
      console.error('[POST /api/lessons/:userId] error:', error);
      res.status(500).json({ error: 'InternalError', message: 'Failed to record lesson' });
    }
  });

  /**
   * POST /api/lessons/:userId/failure
   * Record a failure lesson
   */
  router.post('/api/lessons/:userId/failure', async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { taskPattern, reason, whatWentWrong } = req.body;

    if (!orchestrator) {
      res.status(503).json({ error: 'ServiceUnavailable', message: 'Orchestrator not available' });
      return;
    }

    if (!taskPattern || !reason) {
      res.status(400).json({ error: 'ValidationError', message: 'taskPattern and reason are required' });
      return;
    }

    try {
      const lesson = await orchestrator.recordLessonFailure(userId, taskPattern, {
        reason,
        whatWentWrong: whatWentWrong || '',
      });
      res.json({ success: true, lesson });
    } catch (error) {
      console.error('[POST /api/lessons/:userId/failure] error:', error);
      res.status(500).json({ error: 'InternalError', message: 'Failed to record failure lesson' });
    }
  });

  /**
   * DELETE /api/lessons/:lessonId
   * Delete a specific lesson
   */
  router.delete('/api/lessons/:lessonId', async (req: Request, res: Response) => {
    const { lessonId } = req.params;

    if (!orchestrator) {
      res.status(503).json({ error: 'ServiceUnavailable', message: 'Orchestrator not available' });
      return;
    }

    try {
      const deleted = await orchestrator.deleteLesson(lessonId);
      if (!deleted) {
        res.status(404).json({ error: 'NotFound', message: `Lesson ${lessonId} not found` });
        return;
      }
      res.json({ success: true, message: `Lesson ${lessonId} deleted` });
    } catch (error) {
      console.error('[DELETE /api/lessons/:lessonId] error:', error);
      res.status(500).json({ error: 'InternalError', message: 'Failed to delete lesson' });
    }
  });

  /**
   * DELETE /api/lessons/user/:userId
   * Clear all lessons for a user
   */
  router.delete('/api/lessons/user/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;

    if (!orchestrator) {
      res.status(503).json({ error: 'ServiceUnavailable', message: 'Orchestrator not available' });
      return;
    }

    try {
      orchestrator.clearUserLessons(userId);
      res.json({ success: true, message: `All lessons cleared for user ${userId}` });
    } catch (error) {
      console.error('[DELETE /api/lessons/user/:userId] error:', error);
      res.status(500).json({ error: 'InternalError', message: 'Failed to clear user lessons' });
    }
  });

  /**
   * GET /api/lessons/stats
   * Get lesson statistics
   */
  router.get('/api/lessons/stats', async (_req: Request, res: Response) => {
    if (!orchestrator) {
      res.status(503).json({ error: 'ServiceUnavailable', message: 'Orchestrator not available' });
      return;
    }

    try {
      const stats = orchestrator.getLessonStats();
      res.json(stats);
    } catch (error) {
      console.error('[GET /api/lessons/stats] error:', error);
      res.status(500).json({ error: 'InternalError', message: 'Failed to get lesson stats' });
    }
  });

  return router;
}