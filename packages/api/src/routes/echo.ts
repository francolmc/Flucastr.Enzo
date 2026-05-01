import { Router, Request, Response } from 'express';
import { EchoEngine, type NotificationGateway } from '@enzo/core';
import {
  createDeclarativeJobOnDisk,
  deleteDeclarativeJobOnDisk,
  getEchoDeclarativeJobsState,
  persistCronTimezone,
  persistEchoTaskEnabled,
  updateDeclarativeJobOnDisk,
} from '../echo/echoConfigPersistence.js';

export function createEchoRouter(
  echoEngine: EchoEngine,
  notificationGateway?: NotificationGateway
): Router {
  const router = Router();

  const cfgPath = () => echoEngine.getConfigPath();

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

  router.get('/api/echo/declarative-jobs', async (_req: Request, res: Response) => {
    try {
      const state = await getEchoDeclarativeJobsState(cfgPath());
      res.json(state);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  router.post('/api/echo/declarative-jobs', async (req: Request, res: Response) => {
    try {
      const created = await createDeclarativeJobOnDisk(cfgPath(), req.body);
      await echoEngine.reloadConfigNow();
      res.status(201).json({ job: created });
    } catch (error) {
      sendDeclarativeError(res, error);
    }
  });

  router.put('/api/echo/declarative-jobs/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updated = await updateDeclarativeJobOnDisk(cfgPath(), decodeURIComponent(id), req.body);
      await echoEngine.reloadConfigNow();
      res.json({ job: updated });
    } catch (error) {
      sendDeclarativeError(res, error);
    }
  });

  router.delete('/api/echo/declarative-jobs/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await deleteDeclarativeJobOnDisk(cfgPath(), decodeURIComponent(id));
      await echoEngine.reloadConfigNow();
      res.json({ success: true });
    } catch (error) {
      sendDeclarativeError(res, error);
    }
  });

  router.patch('/api/echo/settings', async (req: Request, res: Response) => {
    try {
      const tz = req.body?.cronTimezone;
      if (tz !== undefined && tz !== null && typeof tz !== 'string') {
        res.status(400).json({ error: 'cronTimezone debe ser string o vacío para borrar' });
        return;
      }
      await persistCronTimezone(cfgPath(), typeof tz === 'string' ? tz : undefined);
      await echoEngine.reloadConfigNow();
      res.json({ success: true });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
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

  router.post('/api/echo/:id/toggle', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const status = echoEngine.getStatus();
      const task = status.tasks.find((entry) => entry.id === id);
      if (!task) {
        res.status(404).json({ error: `Echo task not found: ${id}` });
        return;
      }
      const nextEnabled = !task.enabled;
      await persistEchoTaskEnabled(cfgPath(), id, nextEnabled);
      await echoEngine.reloadConfigNow();
      const updatedTask = echoEngine.getStatus().tasks.find((entry) => entry.id === id);
      res.json({ success: true, task: updatedTask });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  return router;
}

function sendDeclarativeError(res: Response, error: unknown): void {
  if (error instanceof Error && (error as Error & { code?: string }).code === 'NOT_FOUND') {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof Error && (error as Error & { code?: string }).code === 'ID_MISMATCH') {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof Error && (error as Error & { code?: string }).code === 'DUPLICATE_ID') {
    res.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof Error && (error as Error & { code?: string }).code === 'RESERVED_ID') {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof Error && error.message === 'VALIDATION_ERROR') {
    const issues = (error as Error & { zodIssues?: unknown }).zodIssues;
    res.status(400).json({ error: 'Validación fallida', details: issues });
    return;
  }
  const errorMsg = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: errorMsg });
}
