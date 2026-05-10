/**
 * Command system types for Enzo
 */

import type { MemoryService } from '../memory/MemoryService.js';

export interface CommandContext {
  userId: string;
  conversationId?: string;
  args?: string[];
  userRole?: 'user' | 'admin';
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: Record<string, any>;
}

export interface CommandServices {
  memoryService: MemoryService;
}

export type CommandHandler = (ctx: CommandContext, services?: CommandServices) => Promise<CommandResult>;

export interface Command {
  name: string;
  description: string;
  category: 'chat' | 'memory' | 'agent' | 'system';
  requiresAdmin: boolean;
  handler: CommandHandler;
}

export interface CommandMetadata {
  name: string;
  description: string;
  category: 'chat' | 'memory' | 'agent' | 'system';
  requiresAdmin: boolean;
}
