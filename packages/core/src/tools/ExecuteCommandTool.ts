import { spawn } from 'child_process';
import { ExecutableTool, ToolResult } from './types.js';
import { shellExecutableCandidates } from './resolveExecutableShell.js';
import { resolveWorkspaceRoot } from './workspacePathPolicy.js';

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const EXEC_TIMEOUT_MS = 30000;

type ShellRunResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
};

function spawnArgsFor(command: string): string[] {
  return process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
}

/** Node sets `code: 'ENOENT'` on spawn failures; tolerate message-only diagnostics. */
function isSpawnENOENTFailure(err: unknown): boolean {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return true;
    }
  }
  if (err instanceof Error && /ENOENT/.test(err.message) && /spawn/i.test(err.message)) {
    return true;
  }
  return false;
}

/**
 * Spawn the user command via an explicit shell binary (`sh -c` / cmd /c).
 * Tries shells in {@link shellExecutableCandidates} order; retries on ENOENT only.
 */
async function runSpawnedShellCommand(command: string, cwd: string): Promise<ShellRunResult> {
  const candidates = shellExecutableCandidates();
  if (candidates.length === 0) {
    throw new Error(
      'Cannot resolve a shell executable. Set ENZO_SHELL to the full path of sh or bash on this machine.'
    );
  }

  let lastError: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const shell = candidates[i]!;
    try {
      return await runOneShellSpawn(shell, command, cwd);
    } catch (err) {
      if (!isSpawnENOENTFailure(err)) {
        throw err;
      }
      lastError = err;
    }
  }
  throw (
    lastError ??
    new Error(
      'Cannot spawn any shell. Set ENZO_SHELL to the absolute path of a POSIX shell available in this runtime.'
    )
  );
}

function runOneShellSpawn(shell: string, command: string, cwd: string): Promise<ShellRunResult> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(shell, spawnArgsFor(command), {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (syncErr) {
      reject(syncErr);
      return;
    }

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
    'Execute a shell command on THIS Enzo host. Choose utilities and paths for the OS shown in orchestrator/host context—not another machine.';
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
