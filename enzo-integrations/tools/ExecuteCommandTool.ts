import { exec } from 'child_process';
import { ExecutableTool, ToolResult } from './types.js';

export class ExecuteCommandTool implements ExecutableTool {
  name = 'execute_command';
  description =
    'Execute a shell command on THIS host only and return its output. This is the only registered tool ID for invoking any CLI/shell binary (anything you would run in a terminal); put the full executable line inside input.command. Never substitute another tool name — skills or prose mentioning products/CLIs describe what to TYPE in the shell, not a separate JSON tool id. Commands must match the runtime OS described in prompts (POSIX vs Windows paths and utilities); do not reuse command lines copied from another OS.';
  parameters = {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'The exact shell command to execute' },
    },
    required: ['command'],
  };

  constructor(private readonly cwd: string) {}

  execute(input: Record<string, unknown>): Promise<ToolResult> {
    const command = String(input.command ?? '');
    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd: this.cwd,
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          const output = stdout || stderr || error?.message || '';
          const trimmed = output.trim();
          if (error) {
            resolve({
              success: false,
              output: trimmed,
              error: trimmed || error.message,
            });
            return;
          }
          resolve({
            success: true,
            output: trimmed,
          });
        }
      );
    });
  }
}
