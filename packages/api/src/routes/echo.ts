import { Router, Request, Response } from 'express';
import { EchoEngine, type NotificationGateway } from '@enzo/core';

export function createEchoRouter(
  echoEngine: EchoEngine,
  notificationGateway?: NotificationGateway
): Router {
  const router = Router();

  router.get('/api/echo/status', (req: Request, res: Response) => {
    try {
      res.json(echoEngine.getStatus());
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  router.get('/api/echo/notifications/:userId', (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      if (!notificationGateway) {
        res.json([]);
        return;
      }
      res.json(notificationGateway.getRecentNotifications(userId));
    } catch {
      res.json([]);
    }
  });

  router.post('/api/echo/:id/run', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const task = echoEngine.getStatus().tasks.find((entry) => entry.id === id);
      if (!task) {
        res.status(404).json({ error: `Echo task not found: ${id}` });
        return;
      }
      const result = await echoEngine.runNow(id);
      res.json(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  router.post('/api/echo/:id/toggle', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const status = echoEngine.getStatus();
      const task = status.tasks.find((entry) => entry.id === id);
      if (!task) {
        res.status(404).json({ error: `Echo task not found: ${id}` });
        return;
      }
      if (task.enabled) {
        echoEngine.disableTask(id);
      } else {
        echoEngine.enableTask(id);
      }
      const updatedTask = echoEngine.getStatus().tasks.find((entry) => entry.id === id);
      res.json({ success: true, task: updatedTask });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  return router;
}
