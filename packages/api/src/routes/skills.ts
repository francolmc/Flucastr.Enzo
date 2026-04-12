import { Router, Request, Response } from 'express';
import { SkillRegistry } from '@enzo/core';

export function createSkillsRouter(skillRegistry: SkillRegistry): Router {
  const router = Router();

  // GET /api/skills - Listar todos los skills
  router.get('/api/skills', (req: Request, res: Response) => {
    try {
      const skills = skillRegistry.getAll();
      res.json({ skills });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  // PUT /api/skills/:id/enable - Habilitar un skill
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

  // PUT /api/skills/:id/disable - Deshabilitar un skill
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

  // POST /api/skills/reload - Recargar skills desde el filesystem
  router.post('/api/skills/reload', async (req: Request, res: Response) => {
    try {
      await skillRegistry.reload();
      const skills = skillRegistry.getAll();
      res.json({ count: skills.length, skills });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  return router;
}
