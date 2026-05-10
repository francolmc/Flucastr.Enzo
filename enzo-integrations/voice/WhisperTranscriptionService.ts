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

function parseWhisperAsrJsonResponse(payload: unknown): TranscriptionResult | null {
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
      const asrResult = await this.tryWhisperAsr(audioBuffer, mimeType);
      if (asrResult.success) {
        return asrResult;
      }

      if (asrResult.error?.includes('No transcription model available')) {
        return asrResult;
      }

      const openAiResult = await this.tryOpenAi(audioBuffer, mimeType);
      if (openAiResult.success) {
        return openAiResult;
      }

      if (asrResult.error) {
        return {
          success: false,
          error: openAiResult.error || asrResult.error,
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

  private async tryWhisperAsr(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
    const baseUrl = normalizeBaseUrl(this.configService.getWhisperUrl());
    const language = this.configService.getWhisperLanguage().trim() || 'es';
    const params = new URLSearchParams({
      encode: 'true',
      task: 'transcribe',
      output: 'json',
      language,
    });
    const endpoint = `${baseUrl}/asr?${params.toString()}`;

    try {
      const form = new FormData();
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType || 'application/octet-stream' });
      form.append('audio_file', blob, getOpenAiFilename(mimeType));

      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 404) {
          console.warn(
            '[WhisperTranscriptionService] Whisper ASR endpoint unavailable (404). Falling back to OpenAI if configured.'
          );
        } else {
          console.warn(
            `[WhisperTranscriptionService] Whisper ASR request failed: ${response.status} ${errorText?.slice(0, 200)}`
          );
        }
        return { success: false, error: `Whisper ASR transcription failed: ${response.status}` };
      }

      const payload = await response.json();
      const parsed = parseWhisperAsrJsonResponse(payload);
      if (!parsed) {
        return { success: false, error: 'Whisper ASR returned no text' };
      }
      return parsed;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? `Whisper ASR error: ${error.message}` : 'Whisper ASR error',
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
