/**
 * Memory commands - Built-in commands for memory management
 */

import { Command, CommandContext, CommandResult } from '../types.js';

export const memoryListCommand: Command = {
  name: 'memory.list',
  description: 'Ver memorias guardadas',
  category: 'memory',
  requiresAdmin: false,
  handler: async (ctx: CommandContext): Promise<CommandResult> => {
    return {
      success: true,
      message: 'Fetching memories',
      data: {
        action: 'list_memories',
        userId: ctx.userId,
      },
    };
  },
};

export const memoryCommands = [memoryListCommand];
