/**
 * Command Registry - Centralized command management for Enzo
 * 
 * Commands are registered here in the core and exposed via API.
 * This allows all clients (Web UI, Telegram, CLI) to use the same commands.
 */

import {
  Command,
  CommandContext,
  CommandResult,
  CommandMetadata,
} from './types.js';
import type { MemoryService } from '../memory/MemoryService.js';

export interface CommandServices {
  memoryService: MemoryService;
}

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private services: CommandServices | undefined;

  /**
   * Register a new command
   */
  register(command: Command): void {
    if (this.commands.has(command.name)) {
      console.warn(`[CommandRegistry] Command "${command.name}" already registered, overwriting`);
    }
    this.commands.set(command.name, command);
    console.log(`[CommandRegistry] Registered command: ${command.name}`);
  }

  /**
   * Unregister a command
   */
  unregister(name: string): boolean {
    const deleted = this.commands.delete(name);
    if (deleted) {
      console.log(`[CommandRegistry] Unregistered command: ${name}`);
    }
    return deleted;
  }

  /**
   * List all commands, optionally filtered by user role
   */
  list(userRole?: string): CommandMetadata[] {
    const allCommands = Array.from(this.commands.values());
    
    // Filter by role - admin sees all, user sees only non-admin commands
    const filtered = userRole === 'admin' 
      ? allCommands 
      : allCommands.filter(cmd => !cmd.requiresAdmin);

    return filtered.map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      category: cmd.category,
      requiresAdmin: cmd.requiresAdmin,
    }));
  }

  /**
   * Get a single command by name
   */
  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  /**
   * Set services for command handlers
   */
  setServices(services: CommandServices): void {
    this.services = services;
  }

  /**
   * Execute a command by name
   */
  async execute(name: string, ctx: CommandContext): Promise<CommandResult> {
    const command = this.commands.get(name);
    
    if (!command) {
      return {
        success: false,
        message: `Command "${name}" not found`,
      };
    }

    // Check permissions
    if (command.requiresAdmin && ctx.userRole !== 'admin') {
      return {
        success: false,
        message: `Command "${name}" requires admin privileges`,
      };
    }

    try {
      return await command.handler(ctx, this.services);
    } catch (error) {
      console.error(`[CommandRegistry] Error executing command "${name}":`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error executing command',
      };
    }
  }

  /**
   * Check if a command exists
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Get count of registered commands
   */
  get size(): number {
    return this.commands.size;
  }
}

// Global singleton instance
let globalRegistry: CommandRegistry | null = null;

/**
 * Get or create the global command registry
 */
export function getCommandRegistry(): CommandRegistry {
  if (!globalRegistry) {
    globalRegistry = new CommandRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry (mainly for testing)
 */
export function resetCommandRegistry(): void {
  globalRegistry = null;
}

export type { Command, CommandContext, CommandResult, CommandMetadata };
