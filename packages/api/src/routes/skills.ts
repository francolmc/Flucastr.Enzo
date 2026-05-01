import { Router, Request, Response } from 'express';
import {
  SkillRegistry,
  MemoryService,
  SkillLoader,
  validateSkillId,
  readSkillMarkdownRaw,
  writeSkillMarkdownCreate,
  writeSkillMarkdownUpdate,
  deleteSkillDirectory,
} from '@enzo/core';

export interface SkillsRouterDeps {
  skillRegistry: SkillRegistry;
  memoryService: MemoryService;
  skillsDir: string;
}

/** Local-first API: mutation routes assume a trusted operator (same host / LAN); no HTTP auth layer. */
export function createSkillsRouter(deps: SkillsRouterDeps): Router {
  const { skillRegistry, memoryService, skillsDir } = deps;
  const router = Router();

  router.get('/api/skills', (req: Request, res: Response) => {
    try {
      const skills = skillRegistry.getAll();
      res.json({ skills });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  // Register before parameterized routes so `/reload` is not captured as `:id`.
  router.post('/api/skills/reload', async (_req: Request, res: Response) => {
    try {
      await skillRegistry.reload();
      const skills = skillRegistry.getAll();
      res.json({ count: skills.length, skills });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  router.get('/api/skills/:id/source', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const markdown = readSkillMarkdownRaw(skillsDir, id);
      res.json({ markdown });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg === 'Skill not found') {
        res.status(404).json({ error: errorMsg });
        return;
      }
      if (errorMsg.includes('Skill id') || errorMsg.includes('Invalid skill')) {
        res.status(400).json({ error: errorMsg });
        return;
      }
      res.status(500).json({ error: errorMsg });
    }
  });

  router.put('/api/skills/:id/source', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const markdown = typeof req.body?.markdown === 'string' ? req.body.markdown : '';
      if (!markdown.trim()) {
        res.status(400).json({ error: 'markdown is required' });
        return;
      }
      const loader = new SkillLoader(skillsDir);
      loader.validateRawMarkdown(markdown);
      writeSkillMarkdownUpdate(skillsDir, id, markdown);
      await skillRegistry.reload();
      const skill = skillRegistry.get(id);
      if (!skill) {
        res.status(500).json({ error: 'Skill failed to load after update' });
        return;
      }
      res.json({ success: true, skill });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg === 'Skill not found') {
        res.status(404).json({ error: errorMsg });
        return;
      }
      if (
        errorMsg.includes('Skill id') ||
        errorMsg.includes('Invalid skill') ||
        errorMsg.includes('Invalid SKILL') ||
        errorMsg.includes('missing required fields') ||
        errorMsg.includes('frontmatter')
      ) {
        res.status(400).json({ error: errorMsg });
        return;
      }
      res.status(500).json({ error: errorMsg });
    }
  });

  router.post('/api/skills', async (req: Request, res: Response) => {
    try {
      const rawId = req.body?.id;
      const markdown = typeof req.body?.markdown === 'string' ? req.body.markdown : '';
      if (!markdown.trim()) {
        res.status(400).json({ error: 'markdown is required' });
        return;
      }
      const id = validateSkillId(typeof rawId === 'string' ? rawId : '');
      const loader = new SkillLoader(skillsDir);
      loader.validateRawMarkdown(markdown);
      try {
        writeSkillMarkdownCreate(skillsDir, id, markdown);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'Skill already exists') {
          res.status(409).json({ error: msg });
          return;
        }
        throw e;
      }
      await skillRegistry.reload();
      const skill = skillRegistry.get(id);
      if (!skill) {
        res.status(500).json({ error: 'Skill failed to load after create' });
        return;
      }
      res.status(201).json({ success: true, skill });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (
        errorMsg.includes('Skill id') ||
        errorMsg.includes('Invalid skill') ||
        errorMsg.includes('Invalid SKILL') ||
        errorMsg.includes('missing required fields') ||
        errorMsg.includes('frontmatter')
      ) {
        res.status(400).json({ error: errorMsg });
        return;
      }
      res.status(500).json({ error: errorMsg });
    }
  });

  router.delete('/api/skills/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      deleteSkillDirectory(skillsDir, id);
      memoryService.deleteSkillConfig(id);
      await skillRegistry.reload();
      res.json({ success: true });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg === 'Skill not found') {
        res.status(404).json({ error: errorMsg });
        return;
      }
      if (errorMsg.includes('Skill id') || errorMsg.includes('Invalid skill')) {
        res.status(400).json({ error: errorMsg });
        return;
      }
      res.status(500).json({ error: errorMsg });
    }
  });

  router.put('/api/skills/:id/enable', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existingSkill = skillRegistry.get(id);
      if (!existingSkill) {
        res.status(404).json({ error: `Skill not found: ${id}` });
        return;
      }
      skillRegistry.enable(id);
      const skill = skillRegistry.get(id);
      res.json({ success: true, skill });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  router.put('/api/skills/:id/disable', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existingSkill = skillRegistry.get(id);
      if (!existingSkill) {
        res.status(404).json({ error: `Skill not found: ${id}` });
        return;
      }
      skillRegistry.disable(id);
      const skill = skillRegistry.get(id);
      res.json({ success: true, skill });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  return router;
}
