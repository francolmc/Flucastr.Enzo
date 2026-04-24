import { Router, Request, Response } from 'express';
import type { ReminderService } from '@enzo/core';

export function createRemindersRouter(reminderService: ReminderService): Router {
  const router = Router();

  router.get('/api/reminders/debug', async (req: Request, res: Response) => {
    try {
      const channelQuery = String(req.query.channel ?? '').trim();
      const channels =
        channelQuery === 'telegram' || channelQuery === 'web'
          ? [channelQuery as 'telegram' | 'web']
          : undefined;
      const due = reminderService.listDue(50, channels);
      const counts = reminderService.getStatusCounts();
      res.json({
        nowMs: Date.now(),
        channels: channels ?? ['telegram', 'web'],
        counts,
        due,
      });
    } catch (error) {
      console.error('[GET /api/reminders/debug] error:', error);
      res.status(500).json({
        error: 'ReminderDebugError',
        message: error instanceof Error ? error.message : 'Failed to inspect reminders',
      });
    }
  });

  return router;
}

