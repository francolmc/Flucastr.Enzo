import { writeFile, mkdir } from 'fs/promises';
import { dirname, isAbsolute, resolve } from 'path';
import { ExecutableTool, ToolResult } from './types.js';
import { isPathWithinWorkspace, resolveWorkspaceRoot } from './workspacePathPolicy.js';

const ALLOWED_EXTENSIONS = ['.txt', '.md', '.json', '.csv', '.log', '.ts', '.js', '.py'];

export class WriteFileTool implements ExecutableTool {
  name = 'write_file';
  readonly actionAliases = ['escribir_archivo', 'crear_archivo'] as const;
  description =
    'Create or overwrite a file with the given content. Paths must resolve under the configured workspace root (absolute paths outside the workspace are rejected).';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path under the workspace (absolute must stay inside workspace root)' },
      content: { type: 'string', description: 'File content' },
    },
    required: ['path', 'content'],
  };

  private readonly workspaceRoot: string;

  /**
   * @param workspacePath - Root directory; all writes must resolve inside this directory.
   */
  constructor(workspacePath?: string) {
    this.workspaceRoot = resolveWorkspaceRoot(workspacePath);
  }

  async execute(input: { path: string; content: string }): Promise<ToolResult> {
    try {
      if (!input.path || typeof input.path !== 'string') {
        return { success: false, error: 'path must be a non-empty string' };
      }
      if (typeof input.content !== 'string') {
        return { success: false, error: 'content must be a string' };
      }

      const rawPath = input.path.trim();
      const fullPath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(this.workspaceRoot, rawPath);

      if (!isPathWithinWorkspace(fullPath, this.workspaceRoot)) {
        return {
          success: false,
          error: `Access denied: write path must be inside workspace ${this.workspaceRoot}`,
        };
      }

      const extMatch = fullPath.match(/\.[^.]+$/);
      const ext = extMatch ? extMatch[0].toLowerCase() : '';
      if (ext && !ALLOWED_EXTENSIONS.includes(ext)) {
        return {
          success: false,
          error: `File extension not allowed for write_file. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
        };
      }

      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, input.content, 'utf-8');

      console.log(`[WriteFileTool] Written: ${fullPath} (${input.content.length} chars)`);
      return {
        success: true,
        data: `File created successfully at ${fullPath}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[WriteFileTool] Error:`, msg);
      return { success: false, error: msg };
    }
  }
}
