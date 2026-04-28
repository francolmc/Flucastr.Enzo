import { spawn } from 'child_process';
import { ExecutableTool, ToolResult } from './types.js';
import { resolveShell } from './resolveShell.js';
import { resolveWorkspaceRoot } from './workspacePathPolicy.js';

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const EXEC_TIMEOUT_MS = 30000;

function runSpawnedShellCommand(
  command: string,
  cwd: string
): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
  const { shell, args } = resolveShell();

  return new Promise((resolve, reject) => {
    const child = spawn(shell, [...args, command], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    let outLen = 0;
    let errLen = 0;
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      killChild();
      reject(new Error('Command timed out'));
    }, EXEC_TIMEOUT_MS);

    function killChild(): void {
      try {
        if (process.platform === 'win32') {
          child.kill();
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* ignore */
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      const s = chunk.toString('utf8');
      outLen += Buffer.byteLength(s, 'utf8');
      if (outLen > MAX_BUFFER_BYTES) {
        clearTimeout(timer);
        settled = true;
        killChild();
        reject(new Error(`stdout maxBuffer ${MAX_BUFFER_BYTES} exceeded`));
        return;
      }
      stdout += s;
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return;
      const s = chunk.toString('utf8');
      errLen += Buffer.byteLength(s, 'utf8');
      if (errLen > MAX_BUFFER_BYTES) {
        clearTimeout(timer);
        settled = true;
        killChild();
        reject(new Error(`stderr maxBuffer ${MAX_BUFFER_BYTES} exceeded`));
        return;
      }
      stderr += s;
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, signal: signal ?? null });
    });
  });
}

export type ExecuteCommandToolOptions = {
  /** Working directory for the shell (defaults to workspace root). */
  cwd?: string;
};

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
  readonly actionAliases = ['ejecutar_comando', 'ejecutar'] as const;
  description =
    'Execute a shell command. Runs with cwd set to the workspace root unless overridden in the constructor.';
  parameters = {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
    },
    required: ['command'],
  };

  private readonly cwd: string;

  constructor(options?: ExecuteCommandToolOptions) {
    this.cwd = resolveWorkspaceRoot(options?.cwd);
  }

  async execute(input: any): Promise<ToolResult> {
    try {
      const command = input.command || input;
      if (!command || typeof command !== 'string') {
        return {
          success: false,
          error: 'Command must be a non-empty string',
        };
      }

      if (this.isBlocked(command)) {
        return {
          success: false,
          error: `Command is blocked for security reasons: ${command}`,
        };
      }

      if (this.containsPlaceholderPath(command)) {
        return {
          success: false,
          error:
            'Command refused: it contains template paths like /path/to/... Use a real absolute path from the user.',
        };
      }

      const { stdout, stderr, code, signal } = await runSpawnedShellCommand(command, this.cwd);

      if (signal) {
        return {
          success: false,
          error: `Command terminated by signal: ${signal}`,
        };
      }

      if (code !== 0 && code !== null) {
        return {
          success: false,
          error: stderr.trim() || stdout.trim() || `Command failed with exit code ${code}`,
        };
      }

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

  private containsPlaceholderPath(command: string): boolean {
    const t = command.toLowerCase();
    return (
      /\/path\/to\b/.test(t) ||
      /\bpath\/to\//.test(t) ||
      /<path/i.test(t) ||
      /\byour_path_here\b/i.test(t) ||
      /\bexample\/folder\b/i.test(t)
    );
  }

  private isBlocked(command: string): boolean {
    const commandWithoutQuotes = command
      .replace(/"[^"]*"/g, '""')
      .replace(/'[^']*'/g, "''");
    const lowerCommand = commandWithoutQuotes.toLowerCase();
    return BLOCKED_COMMANDS.some(blocked => lowerCommand.includes(blocked));
  }
}
