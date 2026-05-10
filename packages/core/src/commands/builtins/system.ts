/**
 * System commands - Admin-only commands for system management
 */

import { Command, CommandContext, CommandResult } from '../types.js';

export const systemUpdateCommand: Command = {
  name: 'system.update',
  description: 'Actualizar Enzo (solo admin)',
  category: 'system',
  requiresAdmin: true,
  handler: async (ctx: CommandContext): Promise<CommandResult> => {
    return {
      success: true,
      message: 'Iniciando actualización de Enzo...',
      data: {
        action: 'system_update',
        userId: ctx.userId,
      },
    };
  },
};

export const systemCommands = [systemUpdateCommand];
