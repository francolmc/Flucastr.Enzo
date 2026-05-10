/**
 * Agent commands - Built-in commands for agent management
 */

import { Command, CommandContext, CommandResult } from '../types.js';
import { MemoryService } from '../../memory/MemoryService.js';

export const agentListCommand: Command = {
  name: 'agent.list',
  description: 'Listar agentes disponibles',
  category: 'agent',
  requiresAdmin: false,
  handler: async (ctx: CommandContext, services?: { memoryService: MemoryService }): Promise<CommandResult> => {
    if (!services?.memoryService) {
      return {
        success: false,
        message: 'Servicio de memoria no disponible',
      };
    }

    try {
      // Get agents for user
      const ownAgents = await services.memoryService.getAgents(ctx.userId);
      let agents = ownAgents;

      // If no own agents, check owner user
      if (agents.length === 0) {
        const ownerUserId = process.env.TELEGRAM_AGENT_OWNER_USER_ID?.trim();
        if (ownerUserId && ownerUserId !== ctx.userId) {
          const ownerAgents = await services.memoryService.getAgents(ownerUserId);
          if (ownerAgents.length > 0) {
            agents = ownerAgents;
          }
        }
      }

      // If still no agents, get all
      if (agents.length === 0) {
        agents = await services.memoryService.getAllAgents();
      }

      return {
        success: true,
        message: `Se encontraron ${agents.length} agentes`,
        data: {
          agents: agents.map((agent: any) => ({
            id: agent.id,
            name: agent.name,
            provider: agent.provider,
            model: agent.model,
          })),
        },
      };
    } catch (error) {
      console.error('[agent.list] Error listing agents:', error);
      return {
        success: false,
        message: 'Error al listar agentes',
      };
    }
  },
};

export const agentSetCommand: Command = {
  name: 'agent.set',
  description: 'Configurar agente conversacional',
  category: 'agent',
  requiresAdmin: false,
  handler: async (ctx: CommandContext, services?: { memoryService: MemoryService }): Promise<CommandResult> => {
    const agentName = ctx.args?.[0];
    
    if (!agentName) {
      return {
        success: false,
        message: 'Por favor especifica el nombre del agente. Uso: /agent <nombre> o /agent off',
      };
    }

    if (!services?.memoryService) {
      return {
        success: false,
        message: 'Servicio de memoria no disponible',
      };
    }

    try {
      const conversationId = ctx.conversationId || `telegram_${ctx.userId}`;

      // Handle "off" to disable agent
      if (agentName.toLowerCase() === 'off' || agentName.toLowerCase() === 'none') {
        await services.memoryService.setConversationActiveAgent(conversationId, ctx.userId, undefined);
        return {
          success: true,
          message: 'Preset conversacional desactivado. Esta conversación vuelve a usar el modelo principal.',
        };
      }

      // Find agent by name
      const agents = await services.memoryService.getAgents(ctx.userId);
      const selectedAgent = agents.find((agent: any) => {
        const candidateName = agent.name.toLowerCase();
        return candidateName === agentName.toLowerCase() || candidateName.includes(agentName.toLowerCase());
      });

      if (!selectedAgent) {
        return {
          success: false,
          message: `No encontré un preset llamado "${agentName}". Usa /agent para ver la lista.`,
        };
      }

      // Set active agent
      await services.memoryService.setConversationActiveAgent(conversationId, ctx.userId, selectedAgent.id);

      return {
        success: true,
        message: `Preset conversacional *${selectedAgent.name}* activo.\nModelo: \`${selectedAgent.provider}/${selectedAgent.model}\``,
        data: {
          agentId: selectedAgent.id,
          agentName: selectedAgent.name,
          provider: selectedAgent.provider,
          model: selectedAgent.model,
        },
      };
    } catch (error) {
      console.error('[agent.set] Error setting agent:', error);
      return {
        success: false,
        message: 'Error al configurar el agente',
      };
    }
  },
};

export const agentCommands = [agentListCommand, agentSetCommand];
