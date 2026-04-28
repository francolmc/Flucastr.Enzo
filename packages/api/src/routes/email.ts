import { Router, Request, Response } from 'express';
import { ConfigService, EmailService } from '@enzo/core';

export function createEmailRouter(configService: ConfigService): Router {
  const router = Router();

  router.get('/api/email/accounts', (_req: Request, res: Response) => {
    try {
      const svc = new EmailService(configService);
      const accounts = svc.listAccounts();
      res.json({
        accounts: accounts.map(({ hasPassword, ...rest }) => ({
          ...rest,
          hasPassword,
        })),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  router.put('/api/email/accounts/:id/password', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const pwd = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!pwd.trim()) {
        res.status(400).json({ error: 'Missing password' });
        return;
      }
      configService.setEmailPassword(id, pwd);
      res.status(204).send();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/api/email/accounts/:id/test', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const svc = new EmailService(configService);
      const result = await svc.testAccountWithError(id);
      if (!result.ok) {
        res.json({ success: false, error: result.error ?? 'Unknown error' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: msg });
    }
  });

  router.put('/api/email/accounts/:id/toggle', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const enabled =
        typeof req.body?.enabled === 'boolean'
          ? req.body.enabled
          : req.body?.enabled === 'true';
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'Body must include enabled: boolean' });
        return;
      }
      configService.setEmailAccountEnabled(id, enabled);
      res.status(204).send();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = /Unknown email account/.test(msg) ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.get('/api/email/recent', async (req: Request, res: Response) => {
    try {
      const raw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 10;
      const limit = Number.isFinite(raw) ? Math.min(50, Math.max(1, raw)) : 10;
      const svc = new EmailService(configService);
      const result = await svc.getRecent({ limit });
      if (!result.success) {
        res.status(400).json({ messages: [], error: result.error });
        return;
      }
      res.json({
        messages: result.messages ?? [],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ messages: [], error: msg });
    }
  });

  return router;
}
