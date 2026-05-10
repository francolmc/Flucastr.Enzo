import { spawn } from 'child_process';
import { getVoices, tts, type Voice } from 'edge-tts/out/index.js';
import type { ConfigService } from '../config/ConfigService.js';
import type { TTSResult, TTSService } from './TTSService.js';

type SpawnFn = typeof spawn;
type TtsFn = typeof tts;
type GetVoicesFn = typeof getVoices;

interface EdgeTTSServiceOptions {
  ttsFn?: TtsFn;
  getVoicesFn?: GetVoicesFn;
  spawnFn?: SpawnFn;
  timeoutMs?: number;
  configService?: ConfigService;
}

const TELEGRAM_MIME_TYPE = 'audio/ogg';
const FALLBACK_VOICE_BY_LANGUAGE: Record<string, string> = {
  es: 'es-CL-CatalinaNeural',
  en: 'en-US-AriaNeural',
};

function normalizeLanguage(language: string): string {
  const normalized = (language || '').trim().toLowerCase();
  if (!normalized) return 'es';
  const [primary] = normalized.split(/[-_]/);
  return primary || normalized;
}

export class EdgeTTSService implements TTSService {
  private readonly ttsFn: TtsFn;
  private readonly getVoicesFn: GetVoicesFn;
  private readonly spawnFn: SpawnFn;
  private readonly timeoutMs: number;
  private readonly configService?: ConfigService;

  constructor(options: EdgeTTSServiceOptions = {}) {
    this.ttsFn = options.ttsFn ?? tts;
    this.getVoicesFn = options.getVoicesFn ?? getVoices;
    this.spawnFn = options.spawnFn ?? spawn;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.configService = options.configService;
  }

  async synthesize(text: string, language: string): Promise<TTSResult> {
    const cleanedText = text.trim();
    if (!cleanedText) {
      return { success: false, error: 'Cannot synthesize empty text' };
    }

    try {
      const voice = await this.resolveVoice(language);
      const mp3Buffer = await this.ttsFn(cleanedText, { voice });
      const oggBuffer = await this.convertMp3ToOgg(mp3Buffer);
      if (!oggBuffer) {
        return { success: false, error: 'Failed to convert TTS audio to OGG' };
      }

      return {
        success: true,
        audioBuffer: oggBuffer,
        mimeType: TELEGRAM_MIME_TYPE,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown TTS error',
      };
    }
  }

  private async resolveVoice(language: string): Promise<string> {
    const lang = normalizeLanguage(language);
    if (this.configService) {
      const { ttsVoiceEs, ttsVoiceEn } = this.configService.getSystemConfig();
      if (lang === 'es' && ttsVoiceEs?.trim()) {
        return ttsVoiceEs.trim();
      }
      if (lang === 'en' && ttsVoiceEn?.trim()) {
        return ttsVoiceEn.trim();
      }
    }
    const preferred = FALLBACK_VOICE_BY_LANGUAGE[lang];
    if (preferred) {
      return preferred;
    }

    try {
      const voices = await this.getVoicesFn();
      const fromLanguage = voices.find((voice: Voice) => normalizeLanguage(voice.Locale) === lang);
      if (fromLanguage?.ShortName) {
        return fromLanguage.ShortName;
      }
    } catch (error) {
      console.warn('[EdgeTTSService] Failed to resolve voice list:', error);
    }

    return FALLBACK_VOICE_BY_LANGUAGE.en;
  }

  private async convertMp3ToOgg(mp3Buffer: Buffer): Promise<Buffer | null> {
    return new Promise<Buffer | null>((resolve) => {
      try {
        const child = this.spawnFn('ffmpeg', [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'mp3',
          '-i',
          'pipe:0',
          '-c:a',
          'libopus',
          '-b:a',
          '48k',
          '-f',
          'ogg',
          'pipe:1',
        ]);

        const outputChunks: Buffer[] = [];
        const errorChunks: Buffer[] = [];
        let settled = false;

        const finish = (buffer: Buffer | null): void => {
          if (settled) return;
          settled = true;
          resolve(buffer);
        };

        const timeout = setTimeout(() => {
          console.warn('[EdgeTTSService] ffmpeg conversion timed out.');
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore kill errors
          }
          finish(null);
        }, this.timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => outputChunks.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk));
        child.once('error', (error) => {
          clearTimeout(timeout);
          console.warn('[EdgeTTSService] ffmpeg spawn failed:', error);
          finish(null);
        });
        child.once('close', (code) => {
          clearTimeout(timeout);
          if (code === 0 && outputChunks.length > 0) {
            finish(Buffer.concat(outputChunks));
            return;
          }

          const stderr = Buffer.concat(errorChunks).toString('utf-8').trim();
          console.warn(
            `[EdgeTTSService] ffmpeg conversion failed (code=${code ?? 'unknown'}). ${stderr || 'No stderr output'}`
          );
          finish(null);
        });

        child.stdin.on('error', () => {
          // ignore EPIPE if ffmpeg exits early
        });
        child.stdin.end(mp3Buffer);
      } catch (error) {
        console.warn('[EdgeTTSService] Unexpected ffmpeg conversion error:', error);
        resolve(null);
      }
    });
  }
}
