import { exec } from 'child_process';
import { promisify } from 'util';
import { ExecutableTool, ToolResult } from './types.js';

const execAsync = promisify(exec);

const BLOCKED_COMMANDS = [
  'rm -rf',
  'dd',
  'mkfs',
  'fdisk',
  'shutdown',
  'reboot',
  'format',
  'del /f',
  'rd /s',
];

export class ExecuteCommandTool implements ExecutableTool {
  name = 'execute_command';
  description = 'Execute a shell command';
  parameters = {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
    },
    required: ['command'],
  };

  async execute(input: any): Promise<ToolResult> {
    try {
      const command = input.command || input;
      if (!command || typeof command !== 'string') {
        return {
          success: false,
          error: 'Command must be a non-empty string',
        };
      }

      // Check if command is blocked
      if (this.isBlocked(command)) {
        return {
          success: false,
          error: `Command is blocked for security reasons: ${command}`,
        };
      }

      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        success: true,
        data: {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private isBlocked(command: string): boolean {
    // Strip quoted strings so filenames containing blocked words don't trigger false positives
    // e.g. mv "Formato Informe.docx" should NOT match 'format'
    const commandWithoutQuotes = command
      .replace(/"[^"]*"/g, '""')
      .replace(/'[^']*'/g, "''");
    const lowerCommand = commandWithoutQuotes.toLowerCase();
    return BLOCKED_COMMANDS.some(blocked => lowerCommand.includes(blocked));
  }
}
