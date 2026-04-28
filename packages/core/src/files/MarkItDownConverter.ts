import { existsSync } from 'fs';
import { extname } from 'path';
import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
} from 'child_process';
import type { ConversionResult, MarkItDownService } from './MarkItDownService.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_MARKDOWN_CHARS = 50_000;

const TRUNCATE_NOTE =
  '\n\n[Contenido truncado — documento muy largo. Se muestran los primeros 50.000 caracteres.]';

export interface MarkItDownConverterOptions {
  /** Override for tests; defaults to `child_process.spawn`. */
  spawnImpl?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => ChildProcessWithoutNullStreams;
  /** Per-subprocess timeout (default 60s). Use a low value in tests. */
  timeoutMs?: number;
}

function truncateMarkdown(text: string): string {
  if (text.length <= MAX_MARKDOWN_CHARS) {
    return text;
  }
  return text.slice(0, MAX_MARKDOWN_CHARS) + TRUNCATE_NOTE;
}

function runWithTimeout(
  command: string,
  args: readonly string[],
  spawnImpl: MarkItDownConverterOptions['spawnImpl'],
  timeoutMs: number
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}> {
  const sp = spawnImpl ?? spawn;
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = sp(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as ChildProcessWithoutNullStreams;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, spawnError: msg });
      return;
    }

    const chunksOut: Buffer[] = [];
    const chunksErr: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => chunksOut.push(d));
    child.stderr.on('data', (d: Buffer) => chunksErr.push(d));

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve({
        code: null,
        stdout: Buffer.concat(chunksOut).toString('utf8'),
        stderr: Buffer.concat(chunksErr).toString('utf8'),
        timedOut: true,
      });
    }, timeoutMs);

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(chunksOut).toString('utf8'),
        stderr: Buffer.concat(chunksErr).toString('utf8'),
        timedOut: false,
      });
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: null,
        stdout: Buffer.concat(chunksOut).toString('utf8'),
        stderr: Buffer.concat(chunksErr).toString('utf8'),
        timedOut: false,
        spawnError: err instanceof Error ? err.message : String(err),
      });
    });

    child.on('close', (code) => finish(code));
  });
}

export class MarkItDownConverter implements MarkItDownService {
  private readonly spawnImpl: MarkItDownConverterOptions['spawnImpl'];
  private readonly subprocessTimeoutMs: number;

  private readonly SUPPORTED_EXTENSIONS = [
    '.pdf',
    '.docx',
    '.doc',
    '.xlsx',
    '.xls',
    '.pptx',
    '.ppt',
    '.csv',
    '.html',
    '.htm',
    '.xml',
    '.json',
    '.zip',
    '.epub',
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.mp3',
    '.wav',
    '.txt',
    '.md',
    '.rst',
  ];

  constructor(options?: MarkItDownConverterOptions) {
    this.spawnImpl = options?.spawnImpl;
    this.subprocessTimeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  isSupported(extension: string): boolean {
    const raw = extension.trim().toLowerCase();
    const e = raw.startsWith('.') ? raw : raw ? `.${raw}` : '';
    if (!e) return false;
    return this.SUPPORTED_EXTENSIONS.includes(e);
  }

  async convert(filePath: string): Promise<ConversionResult> {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'Invalid file path' };
      }

      if (!existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }

      const ext = extname(filePath).toLowerCase();
      if (!this.isSupported(ext)) {
        return { success: false, error: `Unsupported extension: ${ext || '(none)'}` };
      }

      let result = await runWithTimeout(
        'python3',
        ['-m', 'markitdown', filePath],
        this.spawnImpl,
        this.subprocessTimeoutMs
      );

      if (result.timedOut) {
        return { success: false, error: 'timeout: MarkItDown exceeded 60 seconds' };
      }

      if (result.spawnError || result.code !== 0) {
        result = await runWithTimeout('markitdown', [filePath], this.spawnImpl, this.subprocessTimeoutMs);
        if (result.timedOut) {
          return { success: false, error: 'timeout: MarkItDown exceeded 60 seconds' };
        }
      }

      if (result.spawnError) {
        return {
          success: false,
          error: `MarkItDown failed: ${result.spawnError}${result.stderr ? ` — ${result.stderr.trim()}` : ''}`,
        };
      }

      if (result.code !== 0) {
        const errHint = [result.stderr, result.stdout].filter(Boolean).join(' ').trim() || `exit ${result.code}`;
        return {
          success: false,
          error: `MarkItDown failed: ${errHint}`,
        };
      }

      const raw = result.stdout;
      const markdown = truncateMarkdown(raw);

      return {
        success: true,
        markdown,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }
  }
}
