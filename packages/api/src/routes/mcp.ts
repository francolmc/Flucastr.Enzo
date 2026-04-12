import { Router, Request, Response } from 'express';
import { MCPRegistry, MCPServerConfig } from '@enzo/core';

export function createMCPRouter(mcpRegistry: MCPRegistry): Router {
  const router = Router();

  // GET /api/mcp/servers - Listar todos los servidores MCP configurados
  router.get('/api/mcp/servers', (req: Request, res: Response) => {
    try {
      const servers = mcpRegistry.getServersState();
      res.json(servers);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  // POST /api/mcp/servers - Agregar nuevo servidor MCP
  router.post('/api/mcp/servers', async (req: Request, res: Response) => {
    try {
      const config = req.body as Omit<MCPServerConfig, 'id' | 'createdAt' | 'updatedAt'>;

      // Validate required fields
      if (!config.name || !config.transport) {
        return res.status(400).json({ error: 'name and transport are required' });
      }

      if (config.transport === 'stdio' && !config.command) {
        return res.status(400).json({ error: 'command is required for stdio transport' });
      }

      if (config.transport === 'sse' && !config.url) {
        return res.status(400).json({ error: 'url is required for SSE transport' });
      }

      const newServer = await mcpRegistry.addServer(config);
      res.json(newServer);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  // DELETE /api/mcp/servers/:id - Eliminar servidor
  router.delete('/api/mcp/servers/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await mcpRegistry.removeServer(id);
      res.json({ success: true, id });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  // PUT /api/mcp/servers/:id/enable - Habilitar servidor
  router.put('/api/mcp/servers/:id/enable', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await mcpRegistry.enableServer(id);
      const server = mcpRegistry.getServer(id);
      if (server) {
        res.json({ success: true, server: { ...server.serverConfig, ...server.getState() } });
      } else {
        res.status(404).json({ error: 'Server not found' });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  // PUT /api/mcp/servers/:id/disable - Deshabilitar servidor
  router.put('/api/mcp/servers/:id/disable', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await mcpRegistry.disableServer(id);
      const server = mcpRegistry.getServer(id);
      if (server) {
        res.json({ success: true, server: { ...server.serverConfig, ...server.getState() } });
      } else {
        res.status(404).json({ error: 'Server not found' });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  // POST /api/mcp/servers/:id/reconnect - Reconectar servidor
  router.post('/api/mcp/servers/:id/reconnect', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await mcpRegistry.reconnect(id);
      const server = mcpRegistry.getServer(id);
      if (server) {
        const tools = await server.listTools();
        res.json({ success: true, status: server.connectionStatus, tools, server: { ...server.serverConfig, ...server.getState() } });
      } else {
        res.status(404).json({ error: 'Server not found' });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: 'Failed to reconnect: ' + errorMsg });
    }
  });

  // GET /api/mcp/tools - Listar tools disponibles de todos los servidores
  router.get('/api/mcp/tools', (req: Request, res: Response) => {
    try {
      const tools = mcpRegistry.getAllTools();
      res.json(tools);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: errorMsg });
    }
  });

  return router;
}
