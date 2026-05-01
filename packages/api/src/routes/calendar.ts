import { Router, Request, Response } from 'express';
import { CalendarService, type CalendarInsertInput } from '@enzo/core';

function parseIsoOr400(res: Response, isoRaw: unknown, label: string): number | undefined {
  if (typeof isoRaw !== 'string' || isoRaw.trim() === '') {
    res.status(400).json({ error: 'ValidationError', message: `${label} must be a non-empty ISO string` });
    return undefined;
  }
  const ms = Date.parse(isoRaw.trim());
  if (Number.isNaN(ms)) {
    res.status(400).json({ error: 'ValidationError', message: `${label} is invalid ISO 8601` });
    return undefined;
  }
  return ms;
}

/** REST mirror of the persisted calendar so the dashboard can browse events without chatting. */
export function createCalendarRouter(calendarService: CalendarService): Router {
  const router = Router();

  router.get('/api/calendar/:userId/events', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const fromMs = parseIsoOr400(res, req.query.from, 'query.from');
      if (fromMs === undefined) return;
      const toMs = parseIsoOr400(res, req.query.to, 'query.to');
      if (toMs === undefined) return;

      let from = fromMs;
      let to = toMs;
      if (to < from) {
        [from, to] = [to, from];
      }

      const events = await calendarService.listInRange(userId, from, to);
      res.json({ events });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post('/api/calendar/:userId/events', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const body = req.body as Record<string, unknown>;
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) {
        res.status(400).json({ error: 'ValidationError', message: 'title is required' });
        return;
      }
      const startRaw = body.startIso ?? body.start_iso;
      const startParsed = parseIsoOr400(res, startRaw, 'startIso');
      if (startParsed === undefined) return;

      let endMs: number | null = null;
      if (body.endIso !== undefined || body.end_iso !== undefined) {
        const endRaw = body.endIso ?? body.end_iso;
        const endParsed = parseIsoOr400(res, endRaw, 'endIso');
        if (endParsed === undefined) return;
        endMs = endParsed;
      }
      if (endMs !== null && endMs < startParsed) {
        res.status(400).json({ error: 'ValidationError', message: 'end must be >= start' });
        return;
      }
      let notes: string | null = null;
      if (typeof body.notes === 'string') {
        notes = body.notes.trim() || null;
      } else if (body.notes == null) {
        notes = null;
      }

      const input: CalendarInsertInput = {
        title,
        startAt: startParsed,
        endAt: endMs,
        notes,
      };
      const created = await calendarService.insert(userId, input);
      res.status(201).json({ event: created });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.patch('/api/calendar/:userId/events/:eventId', async (req: Request, res: Response) => {
    try {
      const { userId, eventId } = req.params;
      const body = req.body as Record<string, unknown>;
      const patch: {
        title?: string;
        startAt?: number;
        endAt?: number | null;
        notes?: string | null;
      } = {};

      if (typeof body.title === 'string') {
        const t = body.title.trim();
        if (!t) {
          res.status(400).json({ error: 'ValidationError', message: 'title must be non-empty' });
          return;
        }
        patch.title = t;
      }
      if (body.startIso !== undefined || body.start_iso !== undefined) {
        const s = parseIsoOr400(res, body.startIso ?? body.start_iso, 'startIso');
        if (s === undefined) return;
        patch.startAt = s;
      }
      if (body.endIso !== undefined || body.end_iso !== undefined) {
        const raw = body.endIso ?? body.end_iso;
        if (raw === null || raw === '') {
          patch.endAt = null;
        } else {
          const e = parseIsoOr400(res, raw, 'endIso');
          if (e === undefined) return;
          patch.endAt = e;
        }
      }
      if ('notes' in body) {
        patch.notes = body.notes == null ? null : String(body.notes).trim() || null;
      }

      if (Object.keys(patch).length === 0) {
        res.status(400).json({ error: 'ValidationError', message: 'nothing to patch' });
        return;
      }

      const updated = await calendarService.update(userId, decodeURIComponent(eventId), patch);
      if (!updated) {
        res.status(404).json({ error: 'NotFound', message: 'event not found' });
        return;
      }
      res.json({ event: updated });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.delete('/api/calendar/:userId/events/:eventId', async (req: Request, res: Response) => {
    try {
      const { userId, eventId } = req.params;
      const ok = await calendarService.delete(userId, decodeURIComponent(eventId));
      if (!ok) {
        res.status(404).json({ error: 'NotFound', message: 'event not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
