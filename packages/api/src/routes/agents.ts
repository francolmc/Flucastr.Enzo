import { Router, Request, Response } from 'express';
import { MemoryService, AgentConfig, AgentRecord } from '@enzo/core';
import { v4 as uuidv4 } from 'uuid';

export function createAgentsRouter(memoryService: MemoryService): Router {
  const router = Router();

  router.get('/api/agents/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      const agents = await (memoryService as any).getAgents(userId);

      res.json({
        agents,
      });
    } catch (error) {
      console.error('[GET /api/agents/:userId] error:', error);
      res.status(500).json({
        error: 'RetrievalError',
        message: error instanceof Error ? error.message : 'Failed to retrieve agents',
        statusCode: 500,
      });
    }
  });

  router.post('/api/agents', async (req: Request, res: Response) => {
    try {
      const {
        userId,
        name,
        description,
        provider,
        model,
        systemPrompt,
        assistantNameOverride,
        personaOverride,
        toneOverride,
      } = req.body;

      if (!userId || !name || !provider || !model) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Fields "userId", "name", "provider", and "model" are required',
          statusCode: 400,
        });
        return;
      }

      const now = Date.now();
      const agent: AgentRecord = {
        id: uuidv4(),
        userId,
        name,
        description: description || undefined,
        provider,
        model,
        systemPrompt: systemPrompt || undefined,
        assistantNameOverride: assistantNameOverride || undefined,
        personaOverride: personaOverride || undefined,
        toneOverride: toneOverride || undefined,
        createdAt: now,
        updatedAt: now,
      };

      await (memoryService as any).saveAgent(agent);

      res.status(201).json(agent);
    } catch (error) {
      console.error('[POST /api/agents] error:', error);
      res.status(500).json({
        error: 'CreationError',
        message: error instanceof Error ? error.message : 'Failed to create agent',
        statusCode: 500,
      });
    }
  });

  router.put('/api/agents/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const data = req.body;

      const updated = await (memoryService as any).updateAgent(id, data) as AgentRecord | null;

      if (!updated) {
        res.status(404).json({
          error: 'NotFoundError',
          message: `Agent with id "${id}" not found`,
          statusCode: 404,
        });
        return;
      }

      res.json(updated);
    } catch (error) {
      console.error('[PUT /api/agents/:id] error:', error);
      res.status(500).json({
        error: 'UpdateError',
        message: error instanceof Error ? error.message : 'Failed to update agent',
        statusCode: 500,
      });
    }
  });

  router.delete('/api/agents/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      await (memoryService as any).deleteAgent(id);

      res.json({
        success: true,
      });
    } catch (error) {
      console.error('[DELETE /api/agents/:id] error:', error);
      res.status(500).json({
        error: 'DeletionError',
        message: error instanceof Error ? error.message : 'Failed to delete agent',
        statusCode: 500,
      });
    }
  });

  return router;
}
