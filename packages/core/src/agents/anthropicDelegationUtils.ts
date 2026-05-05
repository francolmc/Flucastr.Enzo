import type { ConfigService } from '../config/ConfigService.js';
import { fetchWithRetry } from '../providers/retry.js';
import type { DelegationResult } from './AgentRouter.js';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_DELEGATION_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8000;

/** Deduped keys: env first (deployment), then persisted config (often stale in dev). */
export function collectAnthropicApiKeys(configService: ConfigService): string[] {
  const keys: string[] = [];
  const push = (k?: string | null) => {
    const t = (k ?? '').trim();
    if (t.length > 0 && !keys.includes(t)) keys.push(t);
  };
  push(process.env.ANTHROPIC_API_KEY);
  push(configService.getProviderApiKey('anthropic'));
  return keys;
}

function isAnthropicAuthRelatedFailure(httpStatus: number, detail: string): boolean {
  if (httpStatus === 401 || httpStatus === 403) return true;
  const d = detail.toLowerCase();
  return (
    d.includes('invalid x-api-key') ||
    d.includes('invalid api key') ||
    (d.includes('invalid') && d.includes('key') && d.includes('api')) ||
    d.includes('unauthorized') ||
    d.includes('authentication') ||
    (d.includes('not') && d.includes('authorized'))
  );
}

/** True when an Anthropic delegation error indicates bad/missing credentials (retry another key source or preset). */
export function isAnthropicDelegationAuthErrorMessage(message: string): boolean {
  return isAnthropicAuthRelatedFailure(0, message);
}

async function readAnthropicErrorDetail(response: Response): Promise<string> {
  let detail = `${response.status} ${response.statusText}`;
  try {
    const errBody = (await response.json()) as { error?: { message?: string; type?: string } };
    detail = errBody?.error?.message || errBody?.error?.type || detail;
  } catch {
    // keep HTTP detail
  }
  return detail;
}

const FILE_TAG_RE = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;

function extractTextBlocks(data: { content?: unknown }): string {
  let content = '';
  const raw = data.content;
  if (raw && Array.isArray(raw)) {
    for (const block of raw as { type?: string; text?: string }[]) {
      if (block.type === 'text' && typeof block.text === 'string') {
        content += block.text;
      }
    }
  }
  return content;
}

function stripFileTags(text: string): string {
  return text.replace(new RegExp(FILE_TAG_RE.source, 'g'), '').trim();
}

/**
 * Call Anthropic Messages API with a single user message and optional system string.
 * Returns concatenated text blocks or an error (no throw).
 */
export async function runAnthropicDelegatedTask(options: {
  configService: ConfigService;
  workspacePath?: string;
  agentId: 'claude_code' | 'doc_agent';
  systemPrompt: string;
  userPrompt: string;
  fetchImpl?: typeof fetch;
}): Promise<DelegationResult> {
  const { configService, agentId, systemPrompt, userPrompt } = options;
  const agent = agentId;
  const keys = collectAnthropicApiKeys(configService);
  if (keys.length === 0) {
    return {
      success: false,
      agent,
      output: '',
      error:
        'Anthropic API key is not configured. Set the anthropic key in config or provide ANTHROPIC_API_KEY.',
    };
  }

  const workspaceRoot = options.workspacePath ?? process.cwd();
  const fetchFn = options.fetchImpl ?? fetch;
  const body = JSON.stringify({
    model: ANTHROPIC_DELEGATION_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  let lastDetail = '';
  for (let ki = 0; ki < keys.length; ki++) {
    const apiKey = keys[ki]!;
    try {
      const response = await fetchWithRetry(
        ANTHROPIC_MESSAGES_URL,
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body,
        },
        { providerName: 'anthropic', fetchFn, maxAttempts: 2 }
      );

      if (!response.ok) {
        const detail = await readAnthropicErrorDetail(response);
        lastDetail = detail;
        const tryNext =
          ki + 1 < keys.length && isAnthropicAuthRelatedFailure(response.status, detail);
        if (!tryNext) {
          return { success: false, agent, output: '', error: `Anthropic API error: ${detail}` };
        }
        continue;
      }

      const data = (await response.json()) as { content?: unknown };
      const rawText = extractTextBlocks(data);
      return await processFileTagsAndBuildResult(rawText, agent, workspaceRoot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastDetail = msg;
      if (ki + 1 < keys.length && isAnthropicAuthRelatedFailure(0, msg)) continue;
      return { success: false, agent, output: '', error: `Request failed: ${msg}` };
    }
  }

  return {
    success: false,
    agent,
    output: '',
    error: `Anthropic API error: ${lastDetail} (tried ${keys.length} key source(s))`,
  };
}

async function processFileTagsAndBuildResult(
  rawText: string,
  agent: 'claude_code' | 'doc_agent',
  workspaceRoot: string
): Promise<DelegationResult> {
  const re = new RegExp(FILE_TAG_RE.source, 'g');
  const matches = [...rawText.matchAll(re)];
  if (matches.length === 0) {
    return { success: true, agent, output: rawText.trim() };
  }

  const filesCreated: string[] = [];

  for (const m of matches) {
    const filePath = m[1]?.trim() ?? '';
    const fileContent = m[2] ?? '';
    const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceRoot, filePath);
    try {
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, fileContent, 'utf8');
    } catch (error) {
      return {
        success: false,
        agent,
        output: stripFileTags(rawText),
        filesCreated,
        error: `Cannot write file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    filesCreated.push(fullPath);
  }

  return { success: true, agent, output: stripFileTags(rawText), filesCreated };
}

const VISION_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function normalizeVisionMediaType(mime: string): string {
  const lower = mime.trim().toLowerCase();
  return VISION_MEDIA_TYPES.has(lower) ? lower : 'image/jpeg';
}

/**
 * Single-turn Anthropic Messages call with one image (base64) + task text. No file-tag processing.
 */
export async function runAnthropicVisionTask(options: {
  configService: ConfigService;
  systemPrompt: string;
  task: string;
  imageBase64: string;
  imageMimeType: string;
  /** Override default delegation model (e.g. user preset model). */
  model?: string;
  /** Agent id reported in {@link DelegationResult.agent} (default vision_agent). */
  resultAgentId?: string;
  fetchImpl?: typeof fetch;
}): Promise<DelegationResult> {
  const agent = options.resultAgentId?.trim() || 'vision_agent';
  const keys = collectAnthropicApiKeys(options.configService);
  if (keys.length === 0) {
    return {
      success: false,
      agent,
      output: '',
      error:
        'Anthropic API key is not configured. Set the anthropic key in config or provide ANTHROPIC_API_KEY.',
    };
  }

  const mediaType = normalizeVisionMediaType(options.imageMimeType);
  const fetchFn = options.fetchImpl ?? fetch;

  const userContent: unknown[] = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: options.imageBase64,
      },
    },
    { type: 'text', text: options.task },
  ];

  const bodyJson = JSON.stringify({
    model: (options.model?.trim() || ANTHROPIC_DELEGATION_MODEL).trim(),
    max_tokens: MAX_TOKENS,
    system: options.systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  let lastDetail = '';
  for (let ki = 0; ki < keys.length; ki++) {
    const apiKey = keys[ki]!;
    try {
      const response = await fetchWithRetry(
        ANTHROPIC_MESSAGES_URL,
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: bodyJson,
        },
        { providerName: 'anthropic', fetchFn, maxAttempts: 2 }
      );

      if (!response.ok) {
        const detail = await readAnthropicErrorDetail(response);
        lastDetail = detail;
        const tryNext =
          ki + 1 < keys.length && isAnthropicAuthRelatedFailure(response.status, detail);
        if (!tryNext) {
          return { success: false, agent, output: '', error: `Anthropic API error: ${detail}` };
        }
        continue;
      }

      const data = (await response.json()) as { content?: unknown };
      const rawText = extractTextBlocks(data).trim();
      return { success: true, agent, output: rawText };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastDetail = msg;
      if (ki + 1 < keys.length && isAnthropicAuthRelatedFailure(0, msg)) continue;
      return { success: false, agent, output: '', error: `Request failed: ${msg}` };
    }
  }

  return {
    success: false,
    agent,
    output: '',
    error: `Anthropic API error: ${lastDetail} (tried ${keys.length} key source(s))`,
  };
}
