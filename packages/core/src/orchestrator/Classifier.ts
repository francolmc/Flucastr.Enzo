/**
 * Complexity routing (`SIMPLE` | `MODERATE` | `COMPLEX`):
 *
 * Env (LLM-first by default — semantic routing without growing keyword lists):
 * - `ENZO_CLASSIFIER_USE_LEXICAL_FASTPATH`:
 *     `true` — run ES/EN lexical shortcuts before the classifier LLM (legacy / rollback / multilingual gaps).
 *     **Default / unset / any other value** — skip those shortcuts and classify only via `requestClassification`,
 *     using extended JSON hints (`suggestedTool`, `calendarIntent`, `suppressSimpleModerateFastPath`).
 * - `ENZO_CLASSIFIER_LLM_ALWAYS === 'true'` — identical to lexical off for routing; logs `classifierBranch: llm_always`.
 * - Amplifier rollback: `ENZO_AMPLIFIER_IMPLIES_MULTI_TOOL_LEXICAL === 'true'` re-enables lexical
 *     `impliesMultiToolWorkflow()` as a safety net alongside classifier output.
 *
 * **Structural cues (stay in code)** — distinct from multilingual intent keyword lists:
 * - Absolute path detection (`messageContainsLikelyAbsolutePath`, `messageIndicatesPersistedWriteToAbsolutePath`).
 * - Optional calendar ambiguity fallback via `resolveCalendarListFastPathIntent` /
 *     `resolveCalendarScheduleFastPathIntent` when the LLM omits `calendarIntent` (narrow ES/EN).
 *
 * Legacy lexical block (when `USE_LEXICAL_FASTPATH`): trivialPattern; calendar list/schedule; recall; scheduling;
 * abstract life planning; chained / multi-tool lexical; persist path hints; factual word lists;
 * single-tool cues; fallback `hasActionVerb`.
 */
import { LLMProvider, Message } from '../providers/types.js';
import {
  type AgentConfig,
  type CalendarIntentHint,
  type ClassificationResult,
  type DelegationHint,
  ComplexityLevel,
} from './types.js';
import { extractJsonObjects, parseFirstJsonObject } from '../utils/StructuredJson.js';
import { impliesMultiToolWorkflow } from './taskRoutingHints.js';
import {
  messageLooksLikeMailboxUnreadStatsQuery,
  messageLooksLikeMailboxUnreadSummaryQuery,
} from './mailboxUnreadIntent.js';

function logClassifierRouting(branch: string, level: ComplexityLevel): void {
  console.log(JSON.stringify({ event: 'EnzoRouting', classifierBranch: branch, level }));
}

/** `'true'` = run lexical ES/EN fast-paths before the classifier LLM. Default LLM-first. */
export function classifierLexicalFastPathEnabled(): boolean {
  return process.env.ENZO_CLASSIFIER_USE_LEXICAL_FASTPATH === 'true';
}

function persistedCalendarCorpus(input: { message: string; originalMessage?: string }): string {
  return [input.originalMessage, input.message].filter(Boolean).join('\n');
}

/**
 * Whether SIMPLE/MODERATE fast path should attach SCHEDULE_PERSIST_LOCKED (calendar `add`).
 * If `calendarIntent` is omitted, falls back to `messageLooksLikePersistedAgendaScheduleRequest`.
 */
export function resolveCalendarScheduleFastPathIntent(input: {
  message: string;
  originalMessage?: string;
  suggestedTool?: 'web_search' | 'calendar';
  calendarIntent?: CalendarIntentHint;
}): boolean {
  if (input.suggestedTool && input.suggestedTool !== 'calendar') return false;
  if (input.calendarIntent === 'schedule') return true;
  if (input.calendarIntent === 'list') return false;
  return messageLooksLikePersistedAgendaScheduleRequest(persistedCalendarCorpus(input));
}

/**
 * Whether SIMPLE/MODERATE fast path should attach CALENDAR_LIST_LOCKED (calendar `list`).
 * If `calendarIntent` is omitted, falls back to list/query lexical helper (narrow ES/EN).
 */
export function resolveCalendarListFastPathIntent(input: {
  message: string;
  originalMessage?: string;
  suggestedTool?: 'web_search' | 'calendar';
  calendarIntent?: CalendarIntentHint;
}): boolean {
  if (input.suggestedTool && input.suggestedTool !== 'calendar') return false;
  if (input.calendarIntent === 'list') return true;
  if (input.calendarIntent === 'schedule') return false;
  const c = persistedCalendarCorpus(input);
  return messageLooksLikeCalendarListQuery(c) && !messageLooksLikePersistedAgendaScheduleRequest(c);
}

/** Optional third argument to {@link Classifier.classify} — user agent catalog + image attachment signal. */
export type ClassifyOptions = {
  availableAgents?: AgentConfig[];
  /** When true, classifier prompt requires non-SIMPLE and a delegationHint (validated downstream too). */
  hasImageContext?: boolean;
};

/**
 * Heuristic: persisted calendar / timed reminder intent (ES + EN). Used by classifier and MODERATE fast-path UX.
 * Intentionally narrow: requires a time/day cue plus scheduling wording (not abstract "organize my day").
 */
export function messageLooksLikePersistedAgendaScheduleRequest(raw: string): boolean {
  const m = raw.trim();
  if (!m) {
    return false;
  }
  const n = m.toLowerCase();
  const timeCue =
    /\d{1,2}\s*[:h.]\s*\d{2}/.test(m) ||
    /\b\d{1,2}\s*(?:hrs?\b|h\b|am\b|pm\b)\b/i.test(n) ||
    /\b(?:hoy|mañana|pasado\s+mañana|today|tomorrow|tonight|esta\s+(?:tarde|mañana|noche)|this\s+(?:morning|afternoon|evening))\b/u.test(
      n
    );
  if (!timeCue) {
    return false;
  }
  return (
    /\bagendar\b/u.test(m) ||
    /\bcalendariz(?:ar|cación)\b/u.test(n) ||
    /\b(?:programar|programemos|programame)\s+(?:un\s+|una\s+)?(?:evento|recordatorio|cita|alarma)\b/u.test(n) ||
    /\b(?:(?:can|could)\s+we\s+|please\s+)?(?:schedule|book)\s+(?:an?\s+)?(?:event|reminder|appointment|meeting)\b/u.test(
      n
    ) ||
    /\b(?:add|put)\s+.+\s+(?:on|to|in)\s+(?:my\s+)?(?:calendar|agenda)\b/u.test(n) ||
    /\b(?:set|create)\s+(?:an?\s+)?(?:calendar\s+)?(?:event|reminder|alarm)\b/u.test(n) ||
    /\bremind(?:er)?\s+(?:me\s+)?(?:at|for|on)\b/u.test(n) ||
    /\b(?:crear|creá|crea)\s+(?:un\s+|una\s+)?(?:evento|cita)\b/u.test(n) ||
    /\bun\s+evento\s+para\b/u.test(n) ||
    /\b(?:añad(?:eme|ir)|pon(?:eme|é)?)\s+.+\s+(?:en\s+(?:mi|el|tu|su)\s+)?(?:calend(?:ario)?|agenda)\b/u.test(n)
  );
}

/**
 * Listing the user's persisted Enzo agenda (not web news "eventos del día").
 */
export function messageLooksLikeCalendarListQuery(raw: string): boolean {
  const n = raw.trim().toLowerCase();
  if (!n) {
    return false;
  }
  if (
    /\b(noticias|news|deportes|f[uú]tbol|mundial|precio|clima|cotizaci[oó]n|bolsa|temblor|terremoto)\b/u.test(n) &&
    !/\b(mi|mis|tengo|personal|enzo|mi\s+agenda|en\s+mi)\b/u.test(n)
  ) {
    return false;
  }

  const temporal = /\b(hoy|today|mañana|tomorrow|pasado\s+mañana|esta\s+(?:tarde|noche|semana)|este\s+mes|(?:el|del)\s+d[ií]a\s+de\s+hoy|dia\s+de\s+hoy|\d{1,2}\s+de\s+[a-záéíóú]+(?:\s+\d{4})?|\d{4}-\d{2}-\d{2})\b/u.test(
    raw
  );

  const agendaNoun = /\b(eventos?\b|citas?\b|compromisos?\b|\bagenda\b|calend(?:ario)?\b|reuniones?\b|meetings?\b|appointments?\b)/u.test(
    n
  );

  const listShape =
    /\b(qu[eé]|cu[aá]les|list(?:a|ado|ar)?|mu[eé]str(?:ame|ar)?|ver|consult(?:ar|e)|mostrar|dime|decime|tell\s+me|show|what\s+('?s|do\s+i|are\s+my|is\s+on\s+my))\b/u.test(n) ||
    /\btengo\b/u.test(n) ||
    /\bdo\s+i\s+have\b/u.test(n) ||
    /\bhay\s+(?:algo|algún|alguna)\s+(?:en\s+)?(?:mi\s+)?(?:agenda|calend)/u.test(n);

  return temporal && agendaNoun && listShape;
}

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

/** JS \\w / \\b do not treat letters with diacritics as word chars — match creá with explicit delimiters when needed. */
function messageHasLikelyPersistWriteIntentLexical(text: string): boolean {
  const delimiterStart = '(?:^|[\\s.,;:!?¿¡(\'"«])';
  if (
    new RegExp(`${delimiterStart}c[rR]e[ÁáAa](?=\\s|[.,!?;:]|$|\\))`, 'u').test(text) ||
    new RegExp(`${delimiterStart}c[rR]ea(?=\\s|[.,!?;:]|$|\\))`, 'u').test(text)
  ) {
    return true;
  }
  return /\b(?:crear|crea\b|cré(?:e|a)me|create|creating|writes?\b|write|writing|guardar|guarda|save|saving|overwrite|touch|escrib(?:e|í|íbeme|imos|iendo)?|guárdalo|guardalo|save\s+to|write\s+to|generar\s+(?:un\s+)?archivo|nuevo\s+archivo)\b/i.test(
    text
  );
}

function messageLooksReadOnlyNoWriteIntentLexical(text: string): boolean {
  return /\b(?:leer|lee(?:r|me)?|read(?:ing)?|muestra(?:me)?|show\s+me\s+the|contenido\s+de|cat\s+)\b/i.test(text) && !messageHasLikelyPersistWriteIntentLexical(text);
}

/** True when the message likely asks to CREATE/WRITE/SAVE file content at that path (lexical ES/EN). Exported for AmplifierLoop / fast path. */
export function messageIndicatesPersistedWriteToAbsolutePath(message: string): boolean {
  const trimmed = message.trim();
  if (!messageContainsLikelyAbsolutePath(trimmed)) {
    return false;
  }
  if (messageLooksReadOnlyNoWriteIntentLexical(trimmed)) {
    return false;
  }
  return messageHasLikelyPersistWriteIntentLexical(trimmed);
}

export class Classifier {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async classify(
    message: string,
    history: Message[],
    options?: ClassifyOptions
  ): Promise<ClassificationResult> {
    const normalizedMessage = message.trim();
    const llmAlways = process.env.ENZO_CLASSIFIER_LLM_ALWAYS === 'true';
    const agents = options?.availableAgents ?? [];

    const systemPrompt = this.buildClassifierSystemPrompt(agents, options?.hasImageContext ?? false);
    const messages: Message[] = [...history, { role: 'user', content: message }];
    const unreadSummaryClassifierCorpus = messages
      .filter((m) => m.role === 'user')
      .map((m) => String(m.content ?? '').trim())
      .filter(Boolean)
      .join('\n');

    if (llmAlways) {
      console.log('[Classifier] ENZO_CLASSIFIER_LLM_ALWAYS — skipping lexical fast-paths');
      return await this.runLlmClassification(systemPrompt, messages, normalizedMessage, true, agents);
    }

    if (!classifierLexicalFastPathEnabled()) {
      console.log('[Classifier] LEXICAL_FASTPATH disabled — classify via LLM JSON only');
      return await this.runLlmClassification(systemPrompt, messages, normalizedMessage, false, agents);
    }

    const trivialPattern = /^(hola|hello|hi|hey|buenos días|buenas|good morning|gracias|thanks|ok|sí|no|chao|bye|adiós)[.!?]?$/i;
    if (trivialPattern.test(normalizedMessage)) {
      console.log('[Classifier] Fast-path trivial → SIMPLE');
      logClassifierRouting('trivial', ComplexityLevel.SIMPLE);
      return { level: ComplexityLevel.SIMPLE, reason: 'trivial message', classifierBranch: 'trivial' };
    }
    if (messageLooksLikeCalendarListQuery(normalizedMessage)) {
      console.log('[Classifier] Fast-path Enzo calendar listing → MODERATE');
      logClassifierRouting('calendar_list_lexical', ComplexityLevel.MODERATE);
      return {
        level: ComplexityLevel.MODERATE,
        reason: 'query Enzo persisted agenda / events for a day — must use calendar tool list (never web_search)',
        suggestedTool: 'calendar',
        calendarIntent: 'list',
        classifierBranch: 'calendar_list_lexical',
      };
    }
    if (messageLooksLikeMailboxUnreadStatsQuery(normalizedMessage)) {
      console.log('[Classifier] Fast-path mailbox unread counts → MODERATE');
      logClassifierRouting('mailbox_unread_lexical', ComplexityLevel.MODERATE);
      return {
        level: ComplexityLevel.MODERATE,
        reason: 'unread inbox counts for configured Gmail/Outlook/IMAP — email_unread_count (never manual instructions)',
        mailboxIntent: 'unread_stats',
        classifierBranch: 'mailbox_unread_lexical',
      };
    }
    if (messageLooksLikeMailboxUnreadSummaryQuery(unreadSummaryClassifierCorpus)) {
      console.log('[Classifier] Fast-path unread mailbox listing/summary → MODERATE');
      logClassifierRouting('mailbox_unread_summary_lexical', ComplexityLevel.MODERATE);
      return {
        level: ComplexityLevel.MODERATE,
        reason: 'summarise or list unread from connected Gmail/Outlook/IMAP — read_email unread_only (never invented subjects)',
        mailboxIntent: 'unread_summarize',
        classifierBranch: 'mailbox_unread_summary_lexical',
      };
    }
    if (this.isLikelyRecallQuery(normalizedMessage.toLowerCase())) {
      console.log('[Classifier] Fast-path recall query → MODERATE');
      logClassifierRouting('recall_lexical', ComplexityLevel.MODERATE);
      return { level: ComplexityLevel.MODERATE, reason: 'recall query — needs RecallTool', classifierBranch: 'recall_lexical' };
    }
    if (messageLooksLikePersistedAgendaScheduleRequest(normalizedMessage)) {
      console.log('[Classifier] Fast-path persisted agenda / schedule → MODERATE');
      logClassifierRouting('schedule_persist_lexical', ComplexityLevel.MODERATE);
      return {
        level: ComplexityLevel.MODERATE,
        reason: 'persisted calendar or timed reminder — must use calendar tool (never plain-chat “already scheduled”)',
        suggestedTool: 'calendar',
        calendarIntent: 'schedule',
        classifierBranch: 'schedule_persist_lexical',
      };
    }
    if (this.isLikelyAbstractLifePlanningWithoutPaths(normalizedMessage)) {
      console.log('[Classifier] Fast-path life/task planning (no paths) → SIMPLE');
      logClassifierRouting('life_planning_no_path', ComplexityLevel.SIMPLE);
      return {
        level: ComplexityLevel.SIMPLE,
        reason: 'abstract task or daily planning without concrete file paths',
        classifierBranch: 'life_planning_no_path',
      };
    }
    if (this.isLikelyChainedTask(normalizedMessage)) {
      logClassifierRouting('chained_explicit_lexical', ComplexityLevel.COMPLEX);
      return {
        level: ComplexityLevel.COMPLEX,
        reason: 'detected explicit chained workflow',
        classifierBranch: 'chained_explicit_lexical',
        suppressSimpleModerateFastPath: true,
      };
    }
    if (impliesMultiToolWorkflow(normalizedMessage)) {
      logClassifierRouting('multi_tool_implicit_classifier', ComplexityLevel.COMPLEX);
      return {
        level: ComplexityLevel.COMPLEX,
        reason: 'implicit multi-tool workflow',
        classifierBranch: 'multi_tool_implicit_classifier',
        suppressSimpleModerateFastPath: true,
      };
    }
    if (messageIndicatesPersistedWriteToAbsolutePath(normalizedMessage)) {
      logClassifierRouting('write_file_lexical_hint', ComplexityLevel.MODERATE);
      return {
        level: ComplexityLevel.MODERATE,
        reason:
          'create or persist file content at an absolute host path — requires write_file (never plain chat claiming the file exists)',
        classifierBranch: 'write_file_lexical_hint',
      };
    }
    if (this.isLikelyFactualQuery(normalizedMessage)) {
      console.log('[Classifier] Fast-path factual query → MODERATE');
      logClassifierRouting('factual_lexical', ComplexityLevel.MODERATE);
      return {
        level: ComplexityLevel.MODERATE,
        reason: 'Real-world factual query that requires web search for accurate answer',
        suggestedTool: 'web_search',
        classifierBranch: 'factual_lexical',
      };
    }
    if (this.isLikelySingleToolTask(normalizedMessage)) {
      logClassifierRouting('single_tool_lexical', ComplexityLevel.MODERATE);
      return { level: ComplexityLevel.MODERATE, reason: 'detected single-tool intent', classifierBranch: 'single_tool_lexical' };
    }

    return await this.runLlmClassification(systemPrompt, messages, normalizedMessage, false, agents);
  }

  private normalizeClassifierLlmOptionalFields(
    parsed: Record<string, unknown>,
    level: ComplexityLevel
  ): Partial<ClassificationResult> {
    const out: Partial<ClassificationResult> = {};
    const suggested = parsed['suggestedTool'];
    if (suggested === 'web_search' || suggested === 'calendar') {
      out.suggestedTool = suggested;
    }
    const cal = parsed['calendarIntent'];
    if (cal === 'list' || cal === 'schedule') {
      out.calendarIntent = cal;
    }
    const mb = parsed['mailboxIntent'];
    if (mb === 'unread_stats' || mb === 'unread_summarize') {
      out.mailboxIntent = mb as NonNullable<ClassificationResult['mailboxIntent']>;
    }
    if (parsed['suppressSimpleModerateFastPath'] === true || level === ComplexityLevel.COMPLEX) {
      out.suppressSimpleModerateFastPath = true;
    }
    return out;
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
- "suggestedTool": "web_search" — user needs grounded/current web facts.
- "suggestedTool": "calendar" AND "calendarIntent": "list" | "schedule" — Enzo persisted agenda (SQLite): list/day query vs adding a timed event/reminder (never outsource to web_search).
- "mailboxIntent": "unread_stats" — HOW MANY **unread** in connected mailboxes → tool \`email_unread_count\` (omit when not totals).
- "mailboxIntent": "unread_summarize" — LIST or SUMMARIZE **actual unread threads** they have connected (Spanish/English wording like resumir/resume + sin leer + Gmail/Outlook, or lista de no leídos). **Never** SIMPLE with simulated mail — MODERATE: \`read_email\` with \`unread_only\`: true MUST run before paraphrasing; never invent employers/projects/subjects absent from RESULTADO (omit mailboxIntent otherwise).
- "suppressSimpleModerateFastPath": true — REQUIRED when LEVEL is COMPLEX or when TWO OR MORE DISTINCT tool-backed steps are inseparable without an intermediate observation (implicit chains: web+write, read+write, analyze+report to file, reorganize folders with mkdir+mv). ALSO set **true** if you classify as MODERATE but the wording still hides a sequential multi-tool dependency (prefer raising to COMPLEX in that case).

LEVELS — apply in order, first match wins:

SIMPLE — direct conversation, no tools needed:
- Greetings: "hello", "hi", "good morning", "how are you"
- Casual conversation, confirmations, thank you, follow-ups — when the user does not ask for filesystem work, URLs, searches, measurable facts about the outside world, system metrics, persistent memory/recall, or other tool-backed actions on this machine
- Conceptual or math without external or verifiable data: "how does Y work" (in general), "2+2", "what is 15% of 200" — not real-world facts that may be wrong if outdated (those are MODERATE, web search)
- Anything answerable without tools, file access, or up-to-date web facts
- Planning / coaching / lists: "help me manage my day", "daily routine tips", "how should I organize my tasks" when the user did NOT ask to persist a timed entry to Enzo agenda/calendar (\`calendar\` tool)
- Spanish: abstract "gestión del día a día", "necesito organizar mi tiempo" **without** agendar/programar/recording a concrete slot — still SIMPLE only if purely conversational tips

MODERATE — needs exactly ONE tool:
- **Unread email counts:** "how many unread in Gmail / Outlook / my inbox", "cuántos correos sin leer", etc. → **mailboxIntent**: \`unread_stats\` (\`email_unread_count\`)
- **Unread content triage/list/summary:** "resume mis correos importantes sin leer", "list unread gmail and outlook", "muéstrame los no leídos" with connected mailbox context → **mailboxIntent**: \`unread_summarize\` (**read_email**, \`unread_only\`; never fabricated themes)
- **Listing this user's own Enzo persisted agenda** for a named day or span (e.g. "mis eventos/citas hoy", "qué tengo en mi agenda mañana") → **calendar** \`list\` against the local SQLite agenda — **never** web_search, **never** answer "I have no access to your personal/Google calendar" (the data model is Enzo's \`calendar\` tool, not an external provider)
- **Persisted agenda / reminders with a concrete time or day:** phrasing such as scheduling an appointment, adding to calendar/agenda/cita, programming a timed reminder/reminder at HH:MM, “un evento para las … hoy”. That **always requires the calendar tool** (SQLite) so it appears in the Enzo web agenda — never SIMPLE with prose pretending it was scheduled
- Spanish: **agendar/programar/añadir al calendario** + concrete time (**15:55**, **hoy**, etc.) → MODERATE
- Web search: "search for...", "look up...", "what does the web say about...", "busca..."
- Real-world facts that may be outdated or require verification: current prices, exchange rates, weather, news, recent events, status of a person/company/project, sports results, release dates, any question about "now", "today", "currently", "latest", "recent"
- Factual questions where being wrong would mislead the user: "who is the CEO of X", "what is the population of Y", "how much does Z cost", "what happened with W"
- File operations: "read file...", "show contents of...", "list folder...", "create file..."
- **CRITICAL — never SIMPLE:** If the user asks to create, overwrite, or save **new/original content** to a **concrete absolute file path** on this machine (e.g. \`/home/.../file.md\`, \`/Users/.../x.txt\`, \`C:\\\\...\\\\out.md\`), that is **always MODERATE** — it requires \`write_file\` (a side effect on disk), even when the content is creative (a story, poem, invented text). Never classify that as SIMPLE.
- Sending or sharing an existing file to the user via Telegram: "mandame el archivo...", "compartí el reporte", "enviame lo que generaste", "send me the file..." — needs send_file
- Single command execution
- Personal statements to remember: "my name is...", "I am a...", "I live in...", "soy..."
  These are ALWAYS MODERATE (save to memory), never COMPLEX
- Save or remember a single fact: "remember that...", "my name is Franco"
  Even if it contains "and": "I am a developer and I live in Copiapó" = MODERATE
- Queries about CURRENT system state (RAM, disk, processes, OS version, CPU usage)
  These REQUIRE execute_command — never classify as SIMPLE (model doesn't know real system state)
- Call an HTTP/API endpoint when the user provides a URL → execute_command with curl
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
- Creating or overwriting a file at a path the user specified = MODERATE (\`write_file\`), **never** SIMPLE — do not treat it as "just chat" because the model could output the text in prose without writing disk
- Decide from meaning: SIMPLE when no single tool-backed action fits; MODERATE when exactly one such action fits; COMPLEX when multiple chained actions fit
- When truly in doubt with nothing that requires tools → SIMPLE
- A greeting is ALWAYS SIMPLE, never MODERATE or COMPLEX
- One search OR one file operation = MODERATE, never COMPLEX
- COMPLEX requires explicit chaining ("and then", "luego", "después", "with the result")
- COMPLEX is the exception, not the rule

Examples:
"hola" → {"level":"SIMPLE","reason":"greeting"}
"hola cómo estás?" → {"level":"SIMPLE","reason":"greeting"}
"cuánto es 15% de 200?" → {"level":"SIMPLE","reason":"math calculation"}
"what is the Atacama Desert?" → {"level":"MODERATE","reason":"factual question requiring web search","suggestedTool":"web_search"}
"search for AI news" → {"level":"MODERATE","reason":"single web search"}
"list my Downloads folder" → {"level":"MODERATE","reason":"single file operation"}
"remember that my name is Franco" → {"level":"MODERATE","reason":"single remember action"}
"I am a developer and I live in Copiapó" → {"level":"MODERATE","reason":"personal statement with facts to remember, not chained actions"}
"¿cuánta RAM libre tengo?" → {"level":"MODERATE","reason":"system state query requiring execute_command"}
"¿qué versión de macOS tengo?" → {"level":"MODERATE","reason":"system state query requiring execute_command"}
"¿cuánto espacio libre hay en disco?" → {"level":"MODERATE","reason":"system state query requiring execute_command"}
"consulta https://api.github.com/users/octocat" → {"level":"MODERATE","reason":"single curl API call"}
"mandame el archivo informe.docx que está en Descargas" → {"level":"MODERATE","reason":"send_file tool"}
"compartí el reporte" → {"level":"MODERATE","reason":"send_file tool"}
"enviame lo que generaste" → {"level":"MODERATE","reason":"send_file tool"}
"¿qué tengo pendiente de Dash?" → {"level":"MODERATE","reason":"recall query — needs RecallTool"}
"¿recordás lo que dijimos del PR?" → {"level":"MODERATE","reason":"recall query — needs RecallTool"}
"search what is the Atacama Desert and then create a file with a summary" → {"level":"COMPLEX","reason":"chained: search then write file","suppressSimpleModerateFastPath":true}
"read file X and save a summary to file Y" → {"level":"COMPLEX","reason":"chained: read then write","suppressSimpleModerateFastPath":true}
"move those folders to IntroProgra" → {"level":"COMPLEX","reason":"reorganize: requires mkdir + mv multiple items"}
"meter esas carpetas en una carpeta nueva" → {"level":"COMPLEX","reason":"reorganize: requires mkdir + mv"}
"llama a https://api.x.com/data y guárdalo en un archivo" → {"level":"COMPLEX","reason":"chained: curl API call then write file"}
"necesito gestionar tareas personales y de todos mis trabajos" → {"level":"SIMPLE","reason":"planning conversation, no concrete paths or file ops"}
"ayuda con la gestión de mi día a día" → {"level":"SIMPLE","reason":"coaching/planning without shell or paths"}
"¿podemos agendar un evento para las 15:55 horas del día de hoy? Es tomar medicamento." → {"level":"MODERATE","reason":"persisted timed event — calendar tool","suggestedTool":"calendar","calendarIntent":"schedule"}
"schedule a dentist appointment tomorrow at 9:30" → {"level":"MODERATE","reason":"persisted timed event — calendar tool","suggestedTool":"calendar","calendarIntent":"schedule"}
"¿qué eventos tengo el día de hoy?" → {"level":"MODERATE","reason":"list Enzo persisted agenda for today — calendar tool list","suggestedTool":"calendar","calendarIntent":"list"}
"¿cuántos correos sin leer tengo en Gmail y Outlook?" → {"level":"MODERATE","reason":"mailbox unread totals — connected accounts on host","mailboxIntent":"unread_stats"}
"¿Podés resumir los mails más importantes sin leer de Gmail y Outlook?" → {"level":"MODERATE","reason":"unread summaries from connected inbox rows","mailboxIntent":"unread_summarize"}
"creá el archivo /home/franco/historia.md con una historia corta" → {"level":"MODERATE","reason":"create file at concrete path requires write_file"}
"please write a README to /tmp/readme-test.md with install steps" → {"level":"MODERATE","reason":"persist new content at absolute path"}

${this.buildDelegationCatalogSection(agents)}

HOST_SIGNAL has_image_for_turn: ${hasImageContext ? 'true' : 'false'}

OUTPUT — one JSON object only (no markdown, no prose):
{"level":"SIMPLE"|"MODERATE"|"COMPLEX","reason":"short reason","delegationHint":{"agentId":"optional","reason":"why this catalog entry fits"},"suggestedTool":"optional web_search|calendar","calendarIntent":"optional list|schedule","mailboxIntent":"optional unread_stats|unread_summarize","suppressSimpleModerateFastPath":true}

delegationHint rules (semantic — use catalog text, do not match on surface keywords alone):
- When HOST_SIGNAL has_image_for_turn is false: delegationHint is OPTIONAL. Include it only when a catalog agent is materially better than plain chat for this request.
- When HOST_SIGNAL has_image_for_turn is true: NEVER use SIMPLE — use MODERATE or COMPLEX. delegationHint is REQUIRED (reason must be non-empty). Prefer a user preset id whose description/system role plausibly covers vision/image analysis; if none fit, set agentId to "vision_agent".
- agentId must be exactly "claude_code", "doc_agent", "vision_agent", OR a user preset id from the catalog. Never invent ids.

ONLY JSON. NOTHING ELSE.`;
  }

  /**
   * Task/life planning in natural language without a filesystem path — should stay conversational (SIMPLE).
   */
  private isLikelyAbstractLifePlanningWithoutPaths(message: string): boolean {
    if (messageContainsLikelyAbsolutePath(message)) {
      return false;
    }
    const n = message.toLowerCase();
    const planningPhrase =
      /\b(gesti[oó]n\s+(del\s+)?d[ií]a|gesti[oó]n\s+de\s+(mi|tu|su)\s+d[ií]a|gesti[oó]n\s+.*\bd[ií]a\s+a\s+d[ií]a|d[ií]a\s+a\s+d[ií]a|gestionar\s+(mis\s+)?tareas|rutinas?\s+diarias?|recordatorios|pomodoro|planificaci[oó]n\s+personal|ay[úu]dame\s+a\s+organizar\s+mi\s+d[ií]a|ayuda\s+con\s+(la\s+)?gesti[oó]n|help\s+me\s+(manage|plan)\s+(my\s+)?(tasks|day)|daily\s+planning|task\s+management)\b/i.test(
        n
      );
    const spanishWorkLifeIntent =
      /\b(tareas?\s+personales|todos?\s+mis\s+trabajos|mis\s+trabajos)\b/i.test(n) &&
      /\b(gestionar|gesti[oó]n|organizar|necesito|ayuda)\b/i.test(n);
    return planningPhrase || spanishWorkLifeIntent;
  }

  private hasActionVerb(message: string): boolean {
    return /\b(search|look up|read|write|create|save|list|execute|run|call|fetch|remember|summary?|summari(?:ze|s(?:e|ing)?)?|analy(?:ze|sis|zing)?|busca(?:r)?|lee(?:r)?|leer|escrib(?:e|ir)|crear|guardar|listar|ejecutar|llamar|consultar|resum(?:e|en|ir|elo|ela|elos|elas)?|analiz(?:ar|a|o)|extra(?:er|e|igo)?)\b/i.test(
      message
    );
  }

  private isLikelySingleToolTask(message: string): boolean {
    const normalized = message.toLowerCase();
    const hasChainWords = /\b(and then|luego|despu[eé]s|con el resultado)\b/i.test(normalized);
    if (hasChainWords) return false;
    if (this.isLikelyRecallQuery(normalized)) {
      return true;
    }
    return /\b(read|lee|list|ls|search|busca|remember|recuerda|curl|consulta|version|ram|disk|disco)\b/i.test(normalized);
  }

  private isLikelyRecallQuery(normalized: string): boolean {
    return /(qu[eé] tengo pendiente|qu[eé] hay de|record[aá]s|qu[eé] dijimos de|qu[eé] capturaste|mis tareas|pendientes de)/i.test(
      normalized
    );
  }

  private isLikelyFactualQuery(message: string): boolean {
    const lower = message.toLowerCase();

    const temporalIndicators = [
      'ahora',
      'hoy',
      'actualmente',
      'último',
      'últimos',
      'última',
      'últimas',
      'reciente',
      'recientemente',
      'now',
      'today',
      'currently',
      'latest',
      'recent',
      'recently',
      'this year',
      'este año',
      'esta semana',
      'this week',
    ];

    const factualIndicators = [
      'precio',
      'costo',
      'cuánto cuesta',
      'cuánto vale',
      'price',
      'cost',
      'how much',
      'quién es',
      'quien es',
      'who is',
      'cuántos habitantes',
      'población',
      'population',
      'resultado',
      'resultado de',
      'score',
      'ganó',
      'perdió',
      'noticias',
      'news',
      'qué pasó',
      'what happened',
      'clima',
      'temperatura',
      'weather',
      'tipo de cambio',
      'dólar',
      'exchange rate',
      'ceo de',
      'ceo of',
      'presidente de',
      'president of',
    ];

    const hasTemporalIndicator = temporalIndicators.some((t) => lower.includes(t));
    const hasFactualIndicator = factualIndicators.some((t) => lower.includes(t));

    return hasTemporalIndicator || hasFactualIndicator;
  }

  private isLikelyChainedTask(message: string): boolean {
    const normalized = message.toLowerCase();
    return /\b(and then|luego|despu[eé]s|con el resultado|y luego|y guarda|y crea|y escribe|y resume)\b/i.test(normalized);
  }

  private fallbackClassification(message: string, reason: string): ClassificationResult {
    const level = this.hasActionVerb(message) ? ComplexityLevel.MODERATE : ComplexityLevel.SIMPLE;
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
    calendarIntent?: string;
    mailboxIntent?: string;
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
      calendarIntent?: string;
      mailboxIntent?: string;
      suppressSimpleModerateFastPath?: boolean;
    }>(response.content, {
      tryRepair: true,
    });
    if (parsed) {
      return parsed.value;
    }

    const retrySystemPrompt = `Return ONLY valid JSON with one object:
{"level":"SIMPLE|MODERATE|COMPLEX","reason":"short reason","delegationHint":{"agentId":"optional","reason":"optional"},"suggestedTool":"optional","calendarIntent":"optional","mailboxIntent":"optional","suppressSimpleModerateFastPath":optional}
Keys suggestedTool/calendarIntent/mailboxIntent/suppressSimpleModerateFastPath may be omitted. Use suggestedTool web_search or calendar only when documented in the primary classifier prompt. Use mailboxIntent unread_stats vs unread_summarize only as defined in primary classifier bullets.
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
      calendarIntent?: string;
      mailboxIntent?: string;
      suppressSimpleModerateFastPath?: boolean;
    }>(retryResponse.content, { tryRepair: true });

    return retryParsed ? retryParsed.value : null;
  }
}
