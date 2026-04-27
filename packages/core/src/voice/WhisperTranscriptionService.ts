import type { ConfigService } from '../config/ConfigService.js';
import type { TranscriptionResult, TranscriptionService } from './TranscriptionService.js';

type FetchFn = typeof fetch;

interface WhisperTranscriptionServiceOptions {
  fetchFn?: FetchFn;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function parseDurationSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function parseOllamaResponse(payload: unknown): TranscriptionResult | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const textCandidate = data.text ?? data.transcript ?? data.response;
  if (typeof textCandidate !== 'string' || textCandidate.trim().length === 0) {
    return null;
  }

  const language = typeof data.language === 'string' ? data.language : undefined;
  const durationSeconds = parseDurationSeconds(data.duration ?? data.durationSeconds);

  return {
    success: true,
    text: textCandidate.trim(),
    language,
    durationSeconds,
  };
}

function parseOpenAiResponse(payload: unknown): TranscriptionResult | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const textCandidate = data.text;
  if (typeof textCandidate !== 'string' || textCandidate.trim().length === 0) {
    return null;
  }

  const language = typeof data.language === 'string' ? data.language : undefined;
  const durationSeconds = parseDurationSeconds(data.duration ?? data.durationSeconds);

  return {
    success: true,
    text: textCandidate.trim(),
    language,
    durationSeconds,
  };
}

function getOpenAiFilename(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('wav')) return 'audio.wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'audio.mp3';
  if (normalized.includes('ogg') || normalized.includes('opus')) return 'audio.ogg';
  if (normalized.includes('webm')) return 'audio.webm';
  return 'audio.bin';
}

export class WhisperTranscriptionService implements TranscriptionService {
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly configService: ConfigService,
    options: WhisperTranscriptionServiceOptions = {}
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
    try {
      const ollamaResult = await this.tryOllama(audioBuffer, mimeType);
      if (ollamaResult.success) {
        return ollamaResult;
      }

      if (ollamaResult.error?.includes('No transcription model available')) {
        return ollamaResult;
      }

      const openAiResult = await this.tryOpenAi(audioBuffer, mimeType);
      if (openAiResult.success) {
        return openAiResult;
      }

      if (ollamaResult.error) {
        return {
          success: false,
          error: openAiResult.error || ollamaResult.error,
        };
      }

      return openAiResult;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown transcription error',
      };
    }
  }

  private async tryOllama(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
    const system = this.configService.getSystemConfig();
    const baseUrl = normalizeBaseUrl(system.ollamaBaseUrl || 'http://localhost:11434');
    const endpoint = `${baseUrl}/api/transcribe`;

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'whisper',
          audio: audioBuffer.toString('base64'),
          format: mimeType,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 404 || /model.+whisper.+not found/i.test(errorText)) {
          console.warn(
            '[WhisperTranscriptionService] Ollama whisper model unavailable. Falling back to OpenAI.'
          );
          return { success: false, error: 'Ollama whisper model unavailable' };
        }

        return { success: false, error: `Ollama transcription failed: ${response.status}` };
      }

      const payload = await response.json();
      const parsed = parseOllamaResponse(payload);
      if (!parsed) {
        return { success: false, error: 'Ollama transcription returned no text' };
      }
      return parsed;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? `Ollama transcription error: ${error.message}` : 'Ollama transcription error',
      };
    }
  }

  private async tryOpenAi(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
    const apiKey = this.configService.getProviderApiKey('openai');
    if (!apiKey) {
      return { success: false, error: 'No transcription model available' };
    }

    try {
      const form = new FormData();
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType || 'application/octet-stream' });
      form.append('model', 'openai/whisper-1');
      form.append('file', blob, getOpenAiFilename(mimeType));

      const response = await this.fetchFn('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `OpenAI transcription failed: ${response.status} ${errorText}`.trim(),
        };
      }

      const payload = await response.json();
      const parsed = parseOpenAiResponse(payload);
      if (!parsed) {
        return { success: false, error: 'OpenAI transcription returned no text' };
      }

      return parsed;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? `OpenAI transcription error: ${error.message}` : 'OpenAI transcription error',
      };
    }
  }
}
