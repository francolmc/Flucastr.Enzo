import { spawn } from 'child_process';

type SpawnFn = typeof spawn;

interface AudioConverterOptions {
  spawnFn?: SpawnFn;
  timeoutMs?: number;
}

export class AudioConverter {
  private readonly spawnFn: SpawnFn;
  private readonly timeoutMs: number;

  constructor(options: AudioConverterOptions = {}) {
    this.spawnFn = options.spawnFn ?? spawn;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  static async isAvailable(spawnFn: SpawnFn = spawn): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        const child = spawnFn('ffmpeg', ['-version']);
        let resolved = false;
        const finish = (value: boolean) => {
          if (resolved) return;
          resolved = true;
          resolve(value);
        };

        child.once('error', () => finish(false));
        child.once('close', (code) => finish(code === 0));
      } catch {
        resolve(false);
      }
    });
  }

  async oggToWav(input: Buffer): Promise<Buffer> {
    const available = await AudioConverter.isAvailable(this.spawnFn);
    if (!available) {
      console.warn('[AudioConverter] ffmpeg is not available. Sending original audio buffer.');
      return input;
    }

    return new Promise<Buffer>((resolve) => {
      try {
        const child = this.spawnFn('ffmpeg', [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-f',
          'wav',
          'pipe:1',
        ]);

        const outputChunks: Buffer[] = [];
        const errorChunks: Buffer[] = [];
        let finished = false;

        const done = (result: Buffer): void => {
          if (finished) return;
          finished = true;
          resolve(result);
        };

        const timeout = setTimeout(() => {
          console.warn('[AudioConverter] ffmpeg conversion timed out. Sending original audio buffer.');
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore kill errors
          }
          done(input);
        }, this.timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => outputChunks.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk));
        child.once('error', (error) => {
          clearTimeout(timeout);
          console.warn('[AudioConverter] ffmpeg spawn failed, using original audio buffer:', error);
          done(input);
        });
        child.once('close', (code) => {
          clearTimeout(timeout);
          if (code === 0 && outputChunks.length > 0) {
            done(Buffer.concat(outputChunks));
            return;
          }

          const stderr = Buffer.concat(errorChunks).toString('utf-8').trim();
          console.warn(
            `[AudioConverter] ffmpeg conversion failed (code=${code ?? 'unknown'}). ${stderr || 'No stderr output'}. Using original buffer.`
          );
          done(input);
        });

        child.stdin.on('error', () => {
          // ignore EPIPE when ffmpeg exits early
        });
        child.stdin.end(input);
      } catch (error) {
        console.warn('[AudioConverter] Unexpected conversion failure, using original audio buffer:', error);
        resolve(input);
      }
    });
  }
}
