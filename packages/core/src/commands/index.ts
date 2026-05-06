/**
 * Commands module for Enzo
 * 
 * Centralized command management system.
 * Commands are registered in the core and exposed via API.
 */

export { CommandRegistry, getCommandRegistry, resetCommandRegistry } from './CommandRegistry.js';
export type { Command, CommandContext, CommandResult, CommandMetadata, CommandServices } from './types.js';

// Built-in commands
export { chatCommands, chatNewCommand, chatClearCommand } from './builtins/chat.js';
export { memoryCommands, memoryListCommand } from './builtins/memory.js';
export { agentCommands, agentListCommand, agentSetCommand } from './builtins/agent.js';
export { systemCommands, systemUpdateCommand } from './builtins/system.js';
