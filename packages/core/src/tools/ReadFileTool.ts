import { readFileSync, statSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { ExecutableTool, ToolResult } from './types.js';
import { isPathWithinWorkspace, resolveWorkspaceRoot } from './workspacePathPolicy.js';

const ALLOWED_EXTENSIONS = ['.txt', '.md', '.json', '.csv', '.log', '.ts', '.js', '.py'];
const MAX_FILE_SIZE = 1024 * 1024; // 1MB

export class ReadFileTool implements ExecutableTool {
  name = 'read_file';
  readonly actionAliases = ['leer_archivo', 'leer'] as const;
  description = 'Read a file from the filesystem';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read' },
    },
    required: ['path'],
  };

  private workspacePath: string;
  /** When true, absolute paths must also lie under the workspace (stricter sandbox). */
  private readonly strictAbsolutePaths: boolean;

  /**
   * @param workspacePath - Absolute root for resolving relative `path` inputs. If omitted, uses
   *   `process.env.ENZO_WORKSPACE_PATH` or `./workspace`.
   * @param options.strictAbsolutePaths - If true, absolute paths outside the workspace are rejected.
   *   Default: `true` when `ENZO_STRICT_WORKSPACE === 'true'`, else false (preserves reading user folders).
   */
  constructor(
    workspacePath?: string,
    options?: { strictAbsolutePaths?: boolean }
  ) {
    this.workspacePath = workspacePath || process.env.ENZO_WORKSPACE_PATH || './workspace';
    this.strictAbsolutePaths =
      options?.strictAbsolutePaths ?? process.env.ENZO_STRICT_WORKSPACE === 'true';
  }

  async execute(input: any): Promise<ToolResult> {
    try {
      const filePath = input.path || input;
      console.log(`[ReadFileTool] execute() called with:`, { filePath, inputKeys: Object.keys(input) });
      
      if (!filePath || typeof filePath !== 'string') {
        console.error(`[ReadFileTool] Invalid filePath:`, filePath);
        return {
          success: false,
          error: 'Path must be a non-empty string',
        };
      }

      // Resolve the full path
      let fullPath: string;
      if (isAbsolute(filePath)) {
        console.log(`[ReadFileTool] Using absolute path:`, filePath);
        fullPath = resolve(filePath);
        const resolvedWorkspace = resolveWorkspaceRoot(this.workspacePath);
        if (this.strictAbsolutePaths && !isPathWithinWorkspace(fullPath, resolvedWorkspace)) {
          console.error(`[ReadFileTool] Access denied: absolute path outside workspace`, {
            fullPath,
            resolvedWorkspace,
          });
          return {
            success: false,
            error: `Access denied: absolute path must be inside workspace ${resolvedWorkspace} (set ENZO_STRICT_WORKSPACE=false to allow any absolute read)`,
          };
        }
      } else {
        // If path is relative, resolve within workspace
        console.log(`[ReadFileTool] Resolving relative path within workspace:`, filePath);
        fullPath = resolve(this.workspacePath, filePath);
        const resolvedWorkspace = resolve(this.workspacePath);

        // Security check: ensure the resolved path is within workspace
        if (!fullPath.startsWith(resolvedWorkspace)) {
          console.error(`[ReadFileTool] Access denied: path is outside workspace`, { fullPath, resolvedWorkspace });
          return {
            success: false,
            error: 'Access denied: path is outside workspace',
          };
        }
      }

      // Check file extension
      const ext = this.getExtension(fullPath);
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return {
          success: false,
          error: `File extension not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
        };
      }

      // Check file size
      const stats = statSync(fullPath);
      if (stats.size > MAX_FILE_SIZE) {
        return {
          success: false,
          error: `File size exceeds maximum of 1MB`,
        };
      }

      // Read the file
      const content = readFileSync(fullPath, 'utf-8');

      console.log(`[ReadFileTool] File read successfully, content length:`, content.length);
      return {
        success: true,
        data: content,
      };
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      if (/ENOENT|no such file|no se encuentra/i.test(message)) {
        message +=
          ' — Use the exact path and filename from ls output or the user message; do not translate or rename file segments.';
      }
      return {
        success: false,
        error: message,
      };
    }
  }

  private getExtension(filePath: string): string {
    const match = filePath.match(/\.[^.]+$/);
    return match ? match[0] : '';
  }
}
