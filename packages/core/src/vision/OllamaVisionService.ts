import type { ConfigService } from '../config/ConfigService.js';
import type { VisionResult, VisionService } from './VisionService.js';

const DEFAULT_VISION_PROMPT = `Describe what you see in this image in detail.
If there is code, text, or error messages, transcribe them exactly.
If there is a diagram or chart, describe its structure and content.
Be specific and thorough.`;

const VISION_UNSUPPORTED_MARKERS = [
  'does not support vision',
  'does not support images',
  'image input is not supported',
  'model does not support',
  'unsupported: image',
  'vision is not supported',
];

const DEFAULT_TIMEOUT_MS = 120_000;

function isVisionUnsupportedMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return VISION_UNSUPPORTED_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export class OllamaVisionService implements VisionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly options?: { fetchImpl?: typeof fetch; timeoutMs?: number }
  ) {}

  async analyze(imageBuffer: Buffer, _mimeType: string, prompt?: string): Promise<VisionResult> {
    const fetchFn = this.options?.fetchImpl ?? fetch;
    const timeoutMs = this.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const baseUrl = normalizeBaseUrl(this.configService.getSystemConfig().ollamaBaseUrl || 'http://localhost:11434');
    const model = this.configService.getPrimaryModel();
    const effectivePrompt = (prompt?.trim()?.length ? prompt.trim() : DEFAULT_VISION_PROMPT) ?? DEFAULT_VISION_PROMPT;
    const b64 = imageBuffer.toString('base64');
    const url = `${baseUrl}/api/generate`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          prompt: effectivePrompt,
          images: [b64],
          stream: false,
        }),
      });

      const rawText = await response.text();
      let body: { response?: string; error?: string } = {};
      try {
        body = JSON.parse(rawText) as { response?: string; error?: string };
      } catch {
        if (!response.ok) {
          return {
            success: false,
            canRetry: false,
            error: `Ollama vision request failed: ${response.status} ${response.statusText}`,
          };
        }
      }

      const errMsg = (body.error ?? (!response.ok ? `${response.status} ${response.statusText}` : '')).trim();
      if (errMsg) {
        if (isVisionUnsupportedMessage(errMsg)) {
          return { success: false, canRetry: true, error: 'Model does not support vision' };
        }
        return { success: false, canRetry: false, error: errMsg };
      }

      const description = typeof body.response === 'string' ? body.response.trim() : '';
      if (!description) {
        return { success: false, canRetry: false, error: 'Empty response from Ollama' };
      }

      return { success: true, description };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, canRetry: false, error: 'Request timed out' };
      }
      if (isVisionUnsupportedMessage(msg)) {
        return { success: false, canRetry: true, error: 'Model does not support vision' };
      }
      return { success: false, canRetry: false, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}
