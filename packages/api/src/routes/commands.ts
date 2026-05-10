import { Router, Request, Response } from 'express';
import { CommandRegistry, Command, CommandMetadata, CommandContext, CommandResult } from '@enzo/core';

export function createCommandsRouter(commandRegistry?: CommandRegistry): Router {
  const router = Router();

  // GET /api/commands - List available commands
  router.get('/api/commands', async (req: Request, res: Response) => {
    try {
      const registry = commandRegistry || CommandRegistry.prototype.constructor.name === 'CommandRegistry' 
        ? (commandRegistry as CommandRegistry) 
        : undefined;
      
      let commands: CommandMetadata[];
      if (registry) {
        commands = registry.list(req.headers['x-user-role'] as string);
      } else {
        // Fallback: return static list if registry not available
        commands = [
          { name: 'chat.new', description: 'Iniciar nueva conversación', category: 'chat', requiresAdmin: false },
          { name: 'chat.clear', description: 'Limpiar historial de conversación', category: 'chat', requiresAdmin: false },
          { name: 'memory.list', description: 'Ver memorias guardadas', category: 'memory', requiresAdmin: false },
          { name: 'agent.set', description: 'Configurar agente conversacional', category: 'agent', requiresAdmin: false },
          { name: 'system.update', description: 'Actualizar Enzo (solo admin)', category: 'system', requiresAdmin: true },
        ];
      }

      res.json({ commands });
    } catch (error) {
      console.error('[GET /api/commands] error:', error);
      res.status(500).json({
        error: 'CommandError',
        message: error instanceof Error ? error.message : 'Failed to list commands',
        statusCode: 500,
      });
    }
  });

  // POST /api/commands/:name/execute
  router.post('/api/commands/:name/execute', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { args, userId, conversationId } = req.body;

      if (!commandRegistry) {
        res.status(503).json({
          success: false,
          message: 'Command registry not initialized',
        });
        return;
      }

      const result = await commandRegistry.execute(name, { 
        userId, 
        conversationId, 
        args,
        userRole: req.headers['x-user-role'] as 'user' | 'admin' | undefined,
      });

      res.json(result);
    } catch (error) {
      console.error(`[POST /api/commands/${req.params.name}/execute] error:`, error);
      res.status(500).json({
        error: 'CommandExecutionError',
        message: error instanceof Error ? error.message : 'Failed to execute command',
        statusCode: 500,
      });
    }
  });

  return router;
}
