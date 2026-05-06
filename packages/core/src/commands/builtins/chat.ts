/**
 * Chat commands - Built-in commands for conversation management
 */

import { Command, CommandContext, CommandResult } from '../types.js';

export const chatNewCommand: Command = {
  name: 'chat.new',
  description: 'Iniciar nueva conversación',
  category: 'chat',
  requiresAdmin: false,
  handler: async (ctx: CommandContext): Promise<CommandResult> => {
    // The actual implementation will create a new conversation
    // For now, return success - the client (Telegram/Web) will handle the actual creation
    return {
      success: true,
      message: 'Nueva conversación iniciada',
      data: {
        action: 'new_conversation',
        userId: ctx.userId,
      },
    };
  },
};

export const chatClearCommand: Command = {
  name: 'chat.clear',
  description: 'Limpiar historial de conversación',
  category: 'chat',
  requiresAdmin: false,
  handler: async (ctx: CommandContext): Promise<CommandResult> => {
    if (!ctx.conversationId) {
      return {
        success: false,
        message: 'No active conversation to clear',
      };
    }
    
    return {
      success: true,
      message: 'Historial de conversación limpiado',
      data: {
        action: 'clear_conversation',
        conversationId: ctx.conversationId,
      },
    };
  },
};

export const chatCommands = [chatNewCommand, chatClearCommand];
