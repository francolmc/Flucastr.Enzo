/**
 * Complexity routing (`SIMPLE` | `MODERATE` | `COMPLEX`):
 *
 * Classification is LLM-first: `requestClassification` returns structured JSON with
 * `suggestedTool`, `prefersHostTools`, `suppressSimpleModerateFastPath`.
 * `ENZO_CLASSIFIER_LLM_ALWAYS === 'true'` logs `classifierBranch: llm_always`.
 *
 * The only pre-LLM fast path is structural path detection
 * (`messageIndicatesPersistedWriteToAbsolutePath`) — no keyword or language-specific heuristics.
 */
import { LLMProvider, Message } from '../providers/types.js';
import {
  type AgentConfig,
  type ClassificationResult,
  type DelegationHint,
  ComplexityLevel,
} from './types.js';
import { extractJsonObjects, parseFirstJsonObject } from '../utils/StructuredJson.js';
import { decisionLogger, type DecisionPhase } from '../logging/DecisionLogger.js';

function logClassifierRouting(branch: string, level: ComplexityLevel): void {
  console.log(JSON.stringify({ event: 'EnzoRouting', classifierBranch: branch, level }));
}

/** Exported for tests. Normalizes optional classifier JSON fields. */
export function normalizeClassifierLlmHints(
  parsed: Record<string, unknown>,
  level: ComplexityLevel
): Partial<ClassificationResult> {
  const out: Partial<ClassificationResult> = {};
  const prefersHostTools = parsed['prefersHostTools'] === true;
  if (prefersHostTools) {
    out.prefersHostTools = true;
  }
  if (parsed['suppressSimpleModerateFastPath'] === true && level === ComplexityLevel.COMPLEX) {
    out.suppressSimpleModerateFastPath = true;
  }
  return out;
}

/** Optional third argument to {@link Classifier.classify} — user agent catalog + image attachment signal. */
export type ClassifyOptions = {
  availableAgents?: AgentConfig[];
  /** When true, classifier prompt requires non-SIMPLE and a delegationHint (validated downstream too). */
  hasImageContext?: boolean;
};

/** True if the message likely contains a concrete absolute path the shell should use. */
export function messageContainsLikelyAbsolutePath(message: string): boolean {
  if (/(?:^|\s|["'])(\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|usr|root)\b\/[\S]*)/i.test(message)) {
    return true;
  }
  if (/(?:^|\s|["'])([A-Za-z]:\\[^\s]+)/.test(message)) {
    return true;
  }
  if (/(?:^|\s|["'])(\/[\w.-]+(?:\/[\w.-]+)+)(?:\s|$|[,'"`])/m.test(message)) {
    return true;
  }
  return false;
}

/** True when the message contains a concrete absolute path. The LLM determines write vs read intent. Exported for AmplifierLoop / fast path. */
export function messageIndicatesPersistedWriteToAbsolutePath(message: string): boolean {
  return messageContainsLikelyAbsolutePath(message.trim());
}

export class Classifier {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async classify(
    message: string,
    history: Message[],
    options?: ClassifyOptions & { requestId?: string; userId?: string }
  ): Promise<ClassificationResult> {
    const normalizedMessage = message.trim();
    const llmAlways = process.env.ENZO_CLASSIFIER_LLM_ALWAYS === 'true';
    const agents = options?.availableAgents ?? [];
    const requestId = options?.requestId || 'unknown';
    const userId = options?.userId || 'unknown';

    const systemPrompt = this.buildClassifierSystemPrompt(agents, options?.hasImageContext ?? false);
    const messages: Message[] = [...history, { role: 'user', content: message }];

    let result: ClassificationResult;
    if (llmAlways) {
      console.log('[Classifier] ENZO_CLASSIFIER_LLM_ALWAYS — classify via LLM');
      result = await this.runLlmClassification(systemPrompt, messages, normalizedMessage, true, agents);
    } else {
      result = await this.runLlmClassification(systemPrompt, messages, normalizedMessage, false, agents);
    }

    decisionLogger.logDecision({
      requestId,
      userId,
      phase: 'classification',
      decision: {
        level: result.level,
        reason: result.reason,
        classifierBranch: result.classifierBranch,
        prefersHostTools: result.prefersHostTools,
        suppressSimpleModerateFastPath: result.suppressSimpleModerateFastPath,
        delegationHint: result.delegationHint,
      },
      reasoning: result.reason,
      alternatives: ['SIMPLE', 'MODERATE', 'COMPLEX', 'AGENT'],
      metadata: {
        classifierBranch: result.classifierBranch,
      },
    });

    return result;
  }

  private normalizeClassifierLlmOptionalFields(
    parsed: Record<string, unknown>,
    level: ComplexityLevel
  ): Partial<ClassificationResult> {
    return normalizeClassifierLlmHints(parsed, level);
  }

  private normalizeDelegationHint(
    raw: { agentId?: string; reason?: string } | undefined,
    agents: AgentConfig[]
  ): DelegationHint | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    if (!reason) return undefined;
    const agentIdRaw = typeof raw.agentId === 'string' ? raw.agentId.trim() : '';
    if (!agentIdRaw) return { reason };
    const fixed = new Set(['claude_code', 'doc_agent', 'vision_agent']);
    if (fixed.has(agentIdRaw)) return { agentId: agentIdRaw, reason };
    if (agents.some((a) => a.id === agentIdRaw)) return { agentId: agentIdRaw, reason };
    return { reason };
  }

  private buildDelegationCatalogSection(agents: AgentConfig[]): string {
    const builtin = `Built-in delegation specialists (use these exact id strings in delegationHint.agentId when they fit):
- claude_code — large or deep code changes, architecture, debugging across many files
- doc_agent — professional long documents (reports, proposals) with structured sections
- vision_agent — analyze image pixels when the host attached image bytes for this turn`;
    if (agents.length === 0) {
      return `DELEGATION CATALOG — user presets: (none for this user)\n${builtin}`;
    }
    const lines = agents.map(
      (a) =>
        `- id: ${a.id} | name: ${a.name} | ${a.provider}/${a.model} | description: ${(a.description || 'N/A').slice(0, 220)}`
    );
    return `DELEGATION CATALOG — user-configured presets (exact id in delegationHint.agentId):
${lines.join('\n')}
${builtin}`;
  }

  private async runLlmClassification(
    systemPrompt: string,
    messages: Message[],
    normalizedMessage: string,
    fromLlmAlwaysBypass: boolean,
    agents: AgentConfig[]
  ): Promise<ClassificationResult> {
    try {
      const parsed = await this.requestClassification(systemPrompt, messages);
      if (!parsed) {
        return this.fallbackClassification(normalizedMessage, 'Classification JSON parse failed');
      }

      const level = Object.values(ComplexityLevel).includes(parsed.level)
        ? parsed.level
        : ComplexityLevel.SIMPLE;

      const llmBranch = fromLlmAlwaysBypass ? 'llm_always' : 'llm';
      logClassifierRouting(llmBranch, level);
      const delegationHint = this.normalizeDelegationHint(parsed.delegationHint, agents);
      const hints = this.normalizeClassifierLlmOptionalFields(parsed as Record<string, unknown>, level);
      return {
        level,
        reason: parsed.reason || 'No reason provided',
        classifierBranch: llmBranch,
        ...(delegationHint ? { delegationHint } : {}),
        ...hints,
      };
    } catch (error) {
      console.error('Classifier.classify() error:', error);
      return this.fallbackClassification(normalizedMessage, 'Classification failed due to error');
    }
  }

  private buildClassifierSystemPrompt(agents: AgentConfig[], hasImageContext: boolean): string {
    return `You are a task complexity classifier. Respond ONLY with JSON, no extra text.
The user's message may be in ANY natural language — infer intent regardless of language; map to level using the SAME rules below.

Core shape (always required):
{"level":"SIMPLE","reason":"..."}
Optional keys (omit when irrelevant):
- "prefersHostTools": true — answer must come from THIS machine's **registered MCP tools**: file operations, shell commands, or other tools available via MCP servers. Omit for pure public lookups or casual conversation.
- "suppressSimpleModerateFastPath": true — ONLY when LEVEL is COMPLEX, or when there are explicitly TWO OR MORE chained tool steps where step N requires output from step N-1. NEVER set this for single filesystem operations, single web searches, or single memory saves — even if prefersHostTools is true.

LEVELS — apply in order, first match wins:

SIMPLE — direct conversation, no tools needed:
- Greetings: "hello", "hi", "good morning", "how are you"
- Casual conversation, confirmations, thank you, follow-ups — when the user does not ask for filesystem work, URLs, searches, measurable facts about the outside world, system metrics, persistent memory/recall, or other tool-backed actions on this machine
- Conceptual or math without external or verifiable data: "how does Y work" (in general), "2+2", "what is 15% of 200" — not real-world facts that may be wrong if outdated (those are MODERATE, web search)
- Anything answerable without tools, file access, or up-to-date web facts
- Planning / coaching / lists: "help me manage my day", "daily routine tips", "how should I organize my tasks" when the user did NOT ask to persist a timed entry to Enzo agenda/calendar (\`calendar\` tool)
- Spanish: abstract "gestión del día a día", "necesito organizar mi tiempo" **without** agendar/programar/recording a concrete slot — still SIMPLE only if purely conversational tips

MODERATE — needs exactly ONE tool:
- Web search: "search for...", "look up...", "what does the web say about...", "busca..."
- Real-world facts that may be outdated or require verification: current prices, exchange rates, weather, news, recent events, status of a person/company/project, sports results, release dates, any question about "now", "today", "currently", "latest", "recent"
- Factual questions where being wrong would mislead the user: "who is the CEO of X", "what is the population of Y", "how much does Z cost", "what happened with W"
- File operations: "read file...", "show contents of...", "list folder...", "create file..." — handled via MCP filesystem server tools when available
- Sending or sharing an existing file to the user via Telegram: "mandame el archivo...", "compartí el reporte", "enviame lo que generaste", "send me the file..." — needs send_file
- Single command execution
- Personal statements to remember: "my name is...", "I am a...", "I live in...", "soy..."
  These are ALWAYS MODERATE (save to memory), never COMPLEX
- Save or remember a single fact: "remember that...", "my name is Franco"
  Even if it contains "and": "I am a developer and I live in Copiapó" = MODERATE
- Queries about CURRENT system state (RAM, disk, processes, OS version, CPU usage) — handled via MCP tools when available
- **Host-backed data on THIS machine:** "my repos on GitHub/GitLab…", "**my** org's …", kubectl/docker context for clusters **configured here**, listing resources visible to **their** authenticated tools → MODERATE + prefersHostTools true. The user is asking what's visible locally via tooling/session — NOT a generalized web crawl about the company's public site.
- Call an HTTP/API endpoint when the user provides a URL → handled via MCP shell tools when available
- Questions about what the user has pending, captured, or said before are MODERATE — they need RecallTool, not web search.

COMPLEX — when there are 2 or more chained actions, OR when reorganizing/moving multiple files:
- "search X and then create a file with the result"
- "read file Y and summarize it into a new file Z"
- "look up X, then save what you find to a file"
- Moving/organizing multiple files or folders into a new location (requires mkdir + mv) when the user points to REAL paths or files to move
- "move those folders to X", "put those files in a new folder", "meter esas carpetas en X", "organiza esas carpetas" (with concrete /path or clearly referenced files)
- NOT COMPLEX for abstract life/task planning without paths — that is SIMPLE (conversation only)
- Tasks where you explicitly need to do action A THEN use its output for action B
- NEVER COMPLEX for simple personal statements, even if they contain "and"
  "I am a developer and I live in X" = MODERATE (two facts to remember, not chained actions)

CRITICAL RULES:
- Creating or overwriting a file at a path the user specified = MODERATE, **never** SIMPLE — handled via MCP filesystem tools when available
- Decide from meaning: SIMPLE when no single tool-backed action fits; MODERATE when exactly one such action fits; COMPLEX when multiple chained actions fit
- When truly in doubt with nothing that requires tools → SIMPLE
- A greeting is ALWAYS SIMPLE, never MODERATE or COMPLEX
- One search OR one file operation = MODERATE, never COMPLEX
- COMPLEX requires explicit chaining: "and then", "and save", "and create", "and write",
  "y guarda", "y crea", "y escribe", "y luego", "luego", "después", "with the result",
  OR when two concrete filesystem paths appear in the same message with different roles
  (one as source, one as destination)
- COMPLEX is the exception, not the rule

Examples:
"hola" → {"level":"SIMPLE","reason":"greeting"}
"hola cómo estás?" → {"level":"SIMPLE","reason":"greeting"}
"cuánto es 15% de 200?" → {"level":"SIMPLE","reason":"math calculation"}
"what is the Atacama Desert?" → {"level":"MODERATE","reason":"factual question — uses available MCP tools when connected"}
"search for AI news" → {"level":"MODERATE","reason":"single web search"}
"list my Downloads folder" → {"level":"MODERATE","reason":"single file operation"}
"remember that my name is X" → {"level":"MODERATE","reason":"single remember action"}
"I am a developer and I live in Y" → {"level":"MODERATE","reason":"personal statement with facts to remember, not chained actions"}
"how much free RAM do I have?" → {"level":"MODERATE","reason":"system state query — uses MCP tools when available"}
"what OS version am I on?" → {"level":"MODERATE","reason":"system state query — uses MCP tools when available"}
"how much free disk space is there?" → {"level":"MODERATE","reason":"system state query — uses MCP tools when available"}
"call https://api.example.com/users/123" → {"level":"MODERATE","reason":"single curl API call"}
"send me the file report.docx from Downloads" → {"level":"MODERATE","reason":"send_file tool"}
"share what you generated" → {"level":"MODERATE","reason":"send_file tool"}
"what do I have pending for project X?" → {"level":"MODERATE","reason":"recall query — needs RecallTool"}
"do you remember what we said about the PR?" → {"level":"MODERATE","reason":"recall query — needs RecallTool"}
"search the Atacama Desert and then create a file with a summary" → {"level":"COMPLEX","reason":"chained: search then write file","suppressSimpleModerateFastPath":true}
"read file X and save a summary to file Y" → {"level":"COMPLEX","reason":"chained: read then write","suppressSimpleModerateFastPath":true}
"move those folders to a new location" → {"level":"COMPLEX","reason":"reorganize: requires mkdir + mv multiple items"}
"call https://api.x.com/data and save it to a file" → {"level":"COMPLEX","reason":"chained: curl API call then write file"}
"lista el contenido de /Users/franco y guarda el resultado en /Users/franco/listado.txt" → {"level":"COMPLEX","reason":"chained: list directory then write file","suppressSimpleModerateFastPath":true}
"help me manage my tasks" → {"level":"SIMPLE","reason":"planning conversation, no concrete paths or file ops"}
"help with my daily routine" → {"level":"SIMPLE","reason":"coaching/planning without shell or paths"}
"show my repositories" → {"level":"MODERATE","reason":"host-authenticated repos via CLI/tools on machine","prefersHostTools":true}
"list my GitHub repos" → {"level":"MODERATE","reason":"repos visible via host Git/GitHub tooling","prefersHostTools":true}
"create the file /tmp/story.md with a short story" → {"level":"MODERATE","reason":"file creation via MCP tools when available"}
"please write a README to /tmp/readme-test.md with install steps" → {"level":"MODERATE","reason":"persist new content at absolute path"}

${this.buildDelegationCatalogSection(agents)}

HOST_SIGNAL has_image_for_turn: ${hasImageContext ? 'true' : 'false'}

OUTPUT — one JSON object only (no markdown, no prose):
{"level":"SIMPLE"|"MODERATE"|"COMPLEX","reason":"short reason","delegationHint":{"agentId":"optional","reason":"why this catalog entry fits"},"prefersHostTools": optional true|false,"suppressSimpleModerateFastPath":true}

delegationHint rules (semantic — use catalog text, do not match on surface keywords alone):
- When HOST_SIGNAL has_image_for_turn is false: delegationHint is OPTIONAL. Include it only when a catalog agent is materially better than plain chat for this request.
- When HOST_SIGNAL has_image_for_turn is true: NEVER use SIMPLE — use MODERATE or COMPLEX. delegationHint is REQUIRED (reason must be non-empty). Prefer a user preset id whose description/system role plausibly covers vision/image analysis; if none fit, set agentId to "vision_agent".
- agentId must be exactly "claude_code", "doc_agent", "vision_agent", OR a user preset id from the catalog. Never invent ids.

ONLY JSON. NOTHING ELSE.`;
  }

  private fallbackClassification(message: string, reason: string): ClassificationResult {
    const level = ComplexityLevel.MODERATE;
    console.warn(`[Classifier] ${reason}. Falling back to ${level}.`);
    logClassifierRouting('fallback_action_verb_hint', level);
    return {
      level,
      reason,
      classifierBranch: 'fallback_action_verb_hint',
    };
  }

  private async requestClassification(
    systemPrompt: string,
    messages: Message[]
  ): Promise<{
    level: ComplexityLevel;
    reason: string;
    delegationHint?: { agentId?: string; reason?: string };
    suggestedTool?: string;
    suppressSimpleModerateFastPath?: boolean;
  } | null> {
    const response = await this.provider.complete({
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.3,
      maxTokens: 256,
    });
    console.log('[Classifier] Raw response:', response.content);

    const allJsonMatches = extractJsonObjects(response.content);
    if (allJsonMatches.length > 1) {
      console.warn(`[Classifier] Model emitted ${allJsonMatches.length} JSON objects. Taking the first one.`);
    }

    const parsed = parseFirstJsonObject<{
      level: ComplexityLevel;
      reason: string;
      delegationHint?: { agentId?: string; reason?: string };
      suggestedTool?: string;
      suppressSimpleModerateFastPath?: boolean;
    }>(response.content, {
      tryRepair: true,
    });
    if (parsed) {
      return parsed.value;
    }

    const retrySystemPrompt = `Return ONLY valid JSON with one object:
{"level":"SIMPLE|MODERATE|COMPLEX","reason":"short reason","delegationHint":{"agentId":"optional","reason":"optional"},"prefersHostTools":optional,"suppressSimpleModerateFastPath":optional}
Keys prefersHostTools/suppressSimpleModerateFastPath may be omitted. Tools come from MCP servers when available.
No markdown, no prose.`;
    const retryResponse = await this.provider.complete({
      messages: [{ role: 'system', content: retrySystemPrompt }, ...messages],
      temperature: 0,
      maxTokens: 128,
    });
    console.log('[Classifier] Retry raw response:', retryResponse.content);

    const retryParsed = parseFirstJsonObject<{
      level: ComplexityLevel;
      reason: string;
      delegationHint?: { agentId?: string; reason?: string };
      suggestedTool?: string;
      suppressSimpleModerateFastPath?: boolean;
    }>(retryResponse.content, { tryRepair: true });

    return retryParsed ? retryParsed.value : null;
  }
}
