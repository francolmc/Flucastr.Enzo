import os from 'os';
import type { Message, LLMProvider } from '../../providers/types.js';
import {
  ComplexityLevel,
  type AmplifierInput,
  type AmplifierResult,
  type Step,
  type StageMetrics,
  type InjectedSkillUsage,
} from '../types.js';
import { extractToolOutput } from '../../utils/ToolOutputExtractor.js';
import { parseFirstJsonObject, repairJsonString } from '../../utils/StructuredJson.js';
import { normalizeError } from '../NormalizedError.js';
import type { AmplifierLoopLog } from './AmplifierLoopLog.js';
import { recordStageMetric } from './AmplifierLoopMetrics.js';
import {
  buildAssistantIdentityPrompt,
  buildRuntimeThreeLayersContractPrompt,
  buildToolsPrompt,
  buildRelevantSkillsSection,
  capRelevantSkillsForPrompt,
  extractOutputTemplates,
} from './AmplifierLoopPromptHelpers.js';
import {
  computeInclusiveUtcIsoRangeForPersistedCalendarListLexicalPrompt,
  describeHostForExecuteCommandPrompt,
  describeLocalWallClockPromptLine,
  humanOsLabel,
} from '../runtimeHostContext.js';
import {
  applyExecutableToolContext,
  attachCalendarDisplayClock,
  attachToolScopedUserId,
  extractFirstJsonObject,
  mergeAvailableToolDefinitions,
  normalizeFastPathToolCall,
  resolveFastPathToolForExecution,
  shouldReturnRawToolOutput,
  validateToolInput,
} from './AmplifierLoopFastPathTools.js';
import { runVerifyBeforeSynthesizeIfEnabled } from './AmplifierVerifyPhase.js';
import { resolveAmplifierDialogueMessages } from './ContinuityMessages.js';
import type { ExecutableTool } from '../../tools/types.js';
import type { SkillRegistry } from '../../skills/SkillRegistry.js';
import type { MCPRegistry } from '../../mcp/index.js';
import type { RelevantSkill } from '../SkillResolver.js';
import type { CapabilityResolver } from '../CapabilityResolver.js';
import {
  messageIndicatesPersistedWriteToAbsolutePath,
  resolveCalendarListFastPathIntent,
  resolveCalendarScheduleFastPathIntent,
} from '../Classifier.js';
import {
  mailboxUnreadSummaryLockCorpus,
  messageLooksLikeMailboxUnreadStatsQuery,
  messageLooksLikeMailboxUnreadSummaryQuery,
} from '../mailboxUnreadIntent.js';
import { resolveTopSkillDeclarativeExecutable } from '../skillFastPathLock.js';
import { extractFilePath } from '../../utils/PathExtractor.js';

const FAST_PATH_MAX_TOKENS_DEFAULT = 384;
const FAST_PATH_MAX_TOKENS_PERSIST = 2048;
const MODERATE_STRICT_RETRY_MAX_TOKENS_DEFAULT = 220;
const MODERATE_STRICT_RETRY_MAX_TOKENS_PERSIST = 2048;
export type SimpleModeratePathContext = {
  input: AmplifierInput;
  classifiedLevel: ComplexityLevel;
  stageMetrics: StageMetrics;
  modelsUsed: Set<string>;
  toolsUsed: Set<string>;
  injectedSkills: Map<string, InjectedSkillUsage>;
  preResolvedSkills: RelevantSkill[];
  startTime: number;
  requestId: string | undefined;
  steps: Step[];
  baseProvider: LLMProvider;
  withTimeout: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
  executableTools: ExecutableTool[];
  mcpRegistry?: MCPRegistry;
  skillRegistry?: SkillRegistry | undefined;
  log: AmplifierLoopLog;
  requestToolInputCorrection: (
    userMessage: string,
    toolName: string,
    toolInput: any,
    errorDetail: string
  ) => Promise<{ toolName: string; toolInput: any } | null>;
  verifyBeforeSynthesize?: boolean;
  capabilityResolver?: CapabilityResolver;
};

function resolveHomeDir(input: AmplifierInput): string {
  return input.runtimeHints?.homeDir ?? process.env.HOME ?? os.homedir();
}

function resolveOsLabel(input: AmplifierInput): string {
  return input.runtimeHints?.osLabel ?? humanOsLabel();
}

function applyCompletionToolCallsToText(
  messageContent: string,
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> | string }> | undefined
): string {
  if (!toolCalls?.length) return messageContent.trim();
  const tc = toolCalls[0]!;
  let args: Record<string, unknown> =
    typeof tc.arguments === 'object' && tc.arguments !== null && !Array.isArray(tc.arguments)
      ? (tc.arguments as Record<string, unknown>)
      : {};
  if (typeof tc.arguments === 'string') {
    try {
      const parsed = JSON.parse(tc.arguments) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      args = {};
    }
  }
  const jsonLine = JSON.stringify({ action: 'tool', tool: tc.name, input: args });
  const trimmed = messageContent.trim();
  return trimmed ? `${jsonLine}\n${trimmed}` : jsonLine;
}

function buildUnknownToolUserMessage(allowlist: string, userLanguage?: string): string {
  const lang = (userLanguage ?? 'es').toLowerCase();
  if (lang.startsWith('en')) {
    return `That capability is not available here. For casual chat you do not need a tool. When you do need the host, I can use only these exact tools: ${allowlist}.`;
  }
  return `Esa capacidad no está disponible en este entorno. Para charlar o conversar no hace falta ninguna herramienta especial. Cuando sí corresponda usar el equipo, solo puedo usar estas herramientas (nombres exactos): ${allowlist}.`;
}

async function synthesizeFastPathToolOutput(params: {
  baseProvider: LLMProvider;
  withTimeout: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
  input: AmplifierInput;
  relevantSkillsSection: string;
  requiredTemplateSection: string;
  execName: string;
  toolOutput: string;
  steps: Step[];
  modelsUsed: Set<string>;
  verifyBeforeSynthesize: boolean;
  stageMetrics: StageMetrics;
  log: AmplifierLoopLog;
}): Promise<string> {
  const verifyStart = Date.now();
  const verified = await runVerifyBeforeSynthesizeIfEnabled(
    { baseProvider: params.baseProvider, withTimeout: params.withTimeout },
    params.input,
    params.toolOutput,
    params.steps.length + 1,
    params.modelsUsed,
    params.verifyBeforeSynthesize
  );
  if (verified.step) {
    params.steps.push(verified.step);
    recordStageMetric(params.stageMetrics, 'verify', Date.now() - verifyStart, true);
  }
  const evidenceForSynth = verified.context;
  const synthLang = (params.input.userLanguage ?? 'es').toLowerCase();
  const calendarSynthRules =
    params.execName === 'calendar'
      ? synthLang.startsWith('es')
        ? `
AGENDA / CALENDARIO (obligatorio):
- Cualquier instante terminado en "Z" o rotulado "UTC persistido" es solo tiempo UTC de almacenamiento — NO es tu hora en la pared ni "hora local" del usuario.
- La hora que debés mencionar al usuario es únicamente la que aparece en "civil (…): fecha, HH:MM" (antes del "—").
- Prohibido decir que 18:50 u otra hora tomada del tramo UTC es "tu hora local" si ya diste otra hora civil. Una sola hora civil por evento, sin contradicciones.
`
        : `
CALENDAR OUTPUT (mandatory):
- Any timestamp ending in "Z" or labeled UTC is stored UTC only — never describe it as the user's wall/local time or "your timezone".
- The user's civil wall time is ONLY the part after "civil ("…"):" before the em dash — use that HH:MM in your wording.
- Do not give contradictory local times (e.g. 15:50 and 18:50 both as local). Mention a single civil time per event.
`
      : '';

  const mailSynthRules =
    params.execName === 'read_email'
      ? synthLang.startsWith('es')
        ? `
CORREO / BUZÓN (obligatorio):
- Solo pueden aparecer hilos/listado con remitente, asunto y fecha/texto que ESTÉN textualmente en RESULTADO — cada ítem debe corresponderse con una entrada numerada/saliente de la herramienta.
- Prohibido inventar empresas, proyectos (p. ej. clientes ficticios), eventos («Conferencia 2023»), cursos («INACAP…» titulados) o totales («5 correos sobre X») si no están soportados por líneas separadas del listado fuente.
- Si el usuario pide los «más importantes», priorizá dentro de ese listado usando señales del propio contenido (asunto urgente, remitente institucional, palabras fuertes); no agregues mensajes nuevos fuera del resultado.
`
        : `
MAILBOX OUTPUT (mandatory):
- Mention only threads whose From/Subject/Date/snippet literals appear in RESULTADO — aligned with enumerated lines from the tool.
- Forbidden: fabricated employers, recurring topics, invented counts (e.g. "5 mails about Project X") unless RESULTADO explicitly lists distinct rows you can cite.
- If asked for "most important," rank **within** RESULTADO cues only — do not invent senders/topics.
`
      : '';

  const cliSynthRules =
    params.execName === 'execute_command'
      ? synthLang.startsWith('es')
        ? `
SALIDA DE CLI / SHELL (obligatorio):
- Solo podés usar nombres, rutas, conteos y mensajes que aparezcan literalmente en RESULTADO.
- No inventes repositorios, cuentas, servicios o totales que no correspondan línea a línea con la salida del comando.
`
        : `
CLI / SHELL OUTPUT (mandatory):
- Only cite names, paths, counts, and errors verbatim from RESULTADO — no fabricated repos, accounts, or totals.
`
      : '';

  const synthesisPrompt = `${buildAssistantIdentityPrompt(params.input)}
${params.relevantSkillsSection}
${params.requiredTemplateSection}
You executed a tool and got this result:

TOOL: ${params.execName}
RESULTADO REAL DE EJECUCIÓN (no inventar, no agregar información):
${evidenceForSynth}

${calendarSynthRules}${mailSynthRules}${cliSynthRules}
Write a response to the user based on this real result.
Do NOT invent or add information not present in the result.
If the result looks like command output with multiple lines (listings, tables, logs), put the COMPLETE tool output in a single markdown fenced code block first, then at most one short sentence if needed. Never invent paths, merge lines into categories, or label something as a file or directory unless that distinction appears in the output.
Do NOT explain the internal process or mention tools.
If REQUIRED OUTPUT TEMPLATES are present, you MUST follow one template exactly.
Template rules have higher priority than "natural phrasing".
Do not change labels/order/emoji/sections from the chosen template.
When a required field is missing in the tool result, keep the format and use "N/D" for that field.

${
  params.input.userLanguage && params.input.userLanguage !== 'es'
    ? `CRITICAL: Write your response in ${params.input.userLanguage.toUpperCase()}. NOT in Spanish.`
    : 'Write your response in Spanish (es).'
}`;

  const synthStart = Date.now();
  try {
    const synthesisResponse = await params.withTimeout(
      params.baseProvider.complete({
        messages: [
          { role: 'system', content: synthesisPrompt },
          { role: 'user', content: params.input.message },
        ],
        temperature: params.execName === 'calendar' || params.execName === 'read_email' ? 0.35 : 0.7,
        maxTokens: 512,
      }),
      180_000,
      'SIMPLE synthesis'
    );
    if (synthesisResponse) {
      recordStageMetric(params.stageMetrics, 'synthesize', Date.now() - synthStart, true);
    }
    return synthesisResponse?.content?.trim() ? synthesisResponse.content.trim() : params.toolOutput;
  } catch (synthErr) {
    params.log.error('[AmplifierLoop] SIMPLE path - síntesis falló:', synthErr);
    recordStageMetric(params.stageMetrics, 'synthesize', Date.now() - synthStart, false);
    return params.toolOutput;
  }
}

/**
 * Two-phase fallback: generate file body then write_file.execute when JSON fast path failed but the user requested persistence.
 */
async function attemptPersistWriteRecovery(params: {
  input: AmplifierInput;
  baseProvider: LLMProvider;
  withTimeout: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
  executableTools: ExecutableTool[];
  mcpRegistry?: MCPRegistry;
  toolsUsed: Set<string>;
  stageMetrics: StageMetrics;
  steps: Step[];
  modelsUsed: Set<string>;
  log: AmplifierLoopLog;
  verifyBeforeSynthesize: boolean;
  relevantSkillsSection: string;
  requiredTemplateSection: string;
}): Promise<string> {
  const writeTool = params.executableTools.find((t) => t.name === 'write_file');
  if (!writeTool) {
    const lang = (params.input.userLanguage ?? 'es').toLowerCase();
    return lang.startsWith('en')
      ? 'A file save was requested, but write_file is not available in this environment — nothing was written to disk.'
      : 'Pediste guardar un archivo, pero write_file no está disponible en este entorno — no se escribió nada en disco.';
  }

  const filePath = extractFilePath(params.input.message);
  if (!filePath) {
    const lang = (params.input.userLanguage ?? 'es').toLowerCase();
    return lang.startsWith('en')
      ? 'I could not detect the file path in your message. Send the full absolute path (for example /home/you/file.md).'
      : 'No pude detectar la ruta del archivo en tu mensaje. Indica la ruta absoluta completa (por ejemplo /home/usuario/archivo.md).';
  }

  const genSystem = `${buildAssistantIdentityPrompt(params.input)}
The user wants a new file created or overwritten at a path they specified. Output ONLY the full body of that file (Markdown or plain text as appropriate). No preamble, no closing commentary, no claim that the file was saved on disk. Start directly with the file content.`;

  let body = '';
  try {
    const gen = await params.withTimeout(
      params.baseProvider.complete({
        messages: [
          { role: 'system', content: genSystem },
          { role: 'user', content: params.input.message },
        ],
        temperature: 0.5,
        maxTokens: 2048,
      }),
      180_000,
      'persist recovery content gen'
    );
    body = (gen.content ?? '').trim();
  } catch (e) {
    params.log.error('[AmplifierLoop] persist recovery content gen failed:', e);
    const lang = (params.input.userLanguage ?? 'es').toLowerCase();
    return lang.startsWith('en')
      ? 'I could not generate the file content. Please try again.'
      : 'No pude generar el contenido del archivo. ¿Podés intentar de nuevo?';
  }

  if (!body) {
    const lang = (params.input.userLanguage ?? 'es').toLowerCase();
    return lang.startsWith('en')
      ? 'Generated content was empty; the file was not written. Please rephrase your request.'
      : 'El contenido generado quedó vacío; no escribí el archivo. ¿Podés reformular el pedido?';
  }

  const preparedInput = { path: filePath, content: body };
  const validationError = validateToolInput(
    'write_file',
    preparedInput,
    params.executableTools,
    params.mcpRegistry
  );
  if (validationError) {
    const lang = (params.input.userLanguage ?? 'es').toLowerCase();
    return lang.startsWith('en')
      ? `Could not prepare the write operation: ${validationError}`
      : `No pude preparar la escritura: ${validationError}`;
  }

  const actStart = Date.now();
  let rawToolOutput = '';
  try {
    const result = await writeTool.execute(preparedInput);
    rawToolOutput = extractToolOutput(result, { maxChars: 3000 });
    const actOk = result.success && !rawToolOutput.toLowerCase().startsWith('error');
    recordStageMetric(params.stageMetrics, 'act', Date.now() - actStart, actOk);
    if (!result.success) {
      const lang = (params.input.userLanguage ?? 'es').toLowerCase();
      const fallbackErr = lang.startsWith('en') ? 'Error writing the file.' : 'Error al escribir el archivo.';
      return rawToolOutput || result.error || fallbackErr;
    }
  } catch (execErr) {
    recordStageMetric(params.stageMetrics, 'act', Date.now() - actStart, false);
    params.log.error('[AmplifierLoop] persist recovery write failed:', execErr);
    const lang = (params.input.userLanguage ?? 'es').toLowerCase();
    return lang.startsWith('en')
      ? 'There was an error writing the file to disk.'
      : 'Tuve un error al escribir el archivo en disco.';
  }

  params.toolsUsed.add('write_file');
  params.log.info(`[AmplifierLoop] persist recovery: write_file ok at ${filePath}`);

  if (shouldReturnRawToolOutput('write_file', params.input.message, rawToolOutput)) {
    return rawToolOutput;
  }

  return synthesizeFastPathToolOutput({
    baseProvider: params.baseProvider,
    withTimeout: params.withTimeout,
    input: params.input,
    relevantSkillsSection: params.relevantSkillsSection,
    requiredTemplateSection: params.requiredTemplateSection,
    execName: 'write_file',
    toolOutput: rawToolOutput,
    steps: params.steps,
    modelsUsed: params.modelsUsed,
    verifyBeforeSynthesize: params.verifyBeforeSynthesize,
    stageMetrics: params.stageMetrics,
    log: params.log,
  });
}

/**
 * SIMPLE / MODERATE fast path: one model call, optional single tool + synthesis.
 */
export async function runSimpleModerateFastPath(ctx: SimpleModeratePathContext): Promise<AmplifierResult> {
  const {
    input,
    classifiedLevel,
    stageMetrics,
    modelsUsed,
    toolsUsed,
    injectedSkills,
    preResolvedSkills,
    startTime,
    requestId,
    steps,
    baseProvider,
    withTimeout,
    executableTools,
    mcpRegistry,
    skillRegistry,
    log,
    requestToolInputCorrection,
    verifyBeforeSynthesize = false,
    capabilityResolver,
  } = ctx;

  const isModerate = classifiedLevel === ComplexityLevel.MODERATE;
  log.info(`[AmplifierLoop] Fast-path ${isModerate ? 'MODERATE' : 'SIMPLE'}`);

  const mergedToolDefs = mergeAvailableToolDefinitions(input, mcpRegistry);
  const toolsPrompt = buildToolsPrompt(mergedToolDefs);

  const isCapabilityQuery =
    /\b(qu[eé] puedes|what can you|capabilities|habilidades|skills|funciones|qu[eé] sabes|what do you|qu[eé] eres capaz|qu[eé] haces|what are you)\b/i.test(
      input.message
    );
  let skillListSection = '';
  if (isCapabilityQuery && skillRegistry) {
    const enabledSkills = skillRegistry.getEnabled();
    if (enabledSkills.length > 0) {
      const skillLines = enabledSkills.map((s) => `- ${s.metadata.name}: ${s.metadata.description}`).join('\n');
      skillListSection = `\nAVAILABLE SKILLS (list these when asked about capabilities):\n${skillLines}\n`;
    }
  }
  const skillsForPrompt = capRelevantSkillsForPrompt(preResolvedSkills);
  const relevantSkillsSection = buildRelevantSkillsSection(skillsForPrompt);
  const requiredTemplateSection = extractOutputTemplates(skillsForPrompt);

  const exactAllowlist = mergedToolDefs.map((t) => t.name).join(', ');

  const persistToPathRequested = messageIndicatesPersistedWriteToAbsolutePath(input.message);

  const toolUsageRule = isModerate
    ? `MODERATE ROUTING: If the user needs disk/shell, web search, memory, email, MCP, persisted calendar/agenda (**calendar**, with ISO timestamps), or any side effect on this host, respond with exactly ONE JSON tool call; "tool" MUST be one of: ${exactAllowlist}. If the message is only casual chat, a greeting, math, your identity, or conceptual talk with no need for tools, respond in plain text only (no JSON). Never invent tool names. Never claim an event/reminder was "scheduled" or "confirmed" unless this turn includes executed **calendar** JSON — prose alone does not write the web agenda.${persistToPathRequested ? ` The user named an absolute FILE path AND asked to CREATE/SAVE/WRITE content there → you MUST use write_file in this response (verbatim path + full content); do not claim success in prose alone.` : ''}`
    : persistToPathRequested
      ? `The user expects a REAL file written on disk at the path they gave. Respond with exactly ONE {"action":"tool","tool":"write_file","input":{"path":"…","content":"…"}} JSON (verbatim path + full body). Plain text claiming the file "was created/saved/already exists" without that JSON would be dishonest — if unsure, omit false claims or ask briefly; never pretend disk I/O ran.`
      : `If you can answer directly without tools, respond with plain text.`;

  const moderateToolJsonOnly = isModerate
    ? `

CRITICAL: When you need a tool, respond with ONLY the JSON object.
No text before, no text after, no explanation.
When the user needs no tool-backed action, reply in plain text and skip JSON entirely.
WRONG: "Ejecutando el comando... {"action":"tool"...}"
RIGHT: {"action":"tool","tool":"execute_command","input":{"command":"ls -la /home/franco"}}

If you include any text outside the JSON, the tool will not execute.
`
    : '';

  const homeDir = resolveHomeDir(input);
  const osLabel = resolveOsLabel(input);
  const calendarCorpus = [input.originalMessage, input.message].filter(Boolean).join('\n');
  const mailboxUnreadSummarizeCorpus = mailboxUnreadSummaryLockCorpus({
    message: input.message,
    originalMessage: input.originalMessage,
    conversation: input.conversation,
  });
  const calendarRoutingInput = {
    message: input.message,
    originalMessage: input.originalMessage,
    suggestedTool: input.suggestedTool,
    calendarIntent: input.calendarIntent,
    prefersHostTools: input.prefersHostTools,
  };
  const classifierSchedulePersist =
    isModerate &&
    executableTools.some((t) => t.name === 'calendar') &&
    resolveCalendarScheduleFastPathIntent(calendarRoutingInput);

  const classifierCalendarList =
    isModerate &&
    executableTools.some((t) => t.name === 'calendar') &&
    !classifierSchedulePersist &&
    resolveCalendarListFastPathIntent(calendarRoutingInput);

  const listWindowIso = classifierCalendarList
    ? computeInclusiveUtcIsoRangeForPersistedCalendarListLexicalPrompt(calendarCorpus, input.runtimeHints)
    : null;

  const mandatoryCalendarBlock =
    classifierSchedulePersist
      ? `

━━━ SCHEDULE_PERSIST_LOCKED ━━━
The user explicitly asked to save a timed entry to Enzo persisted agenda (SQLite; visible in web UI Agenda). For this turn ONLY: respond with a single canonical JSON tool call and nothing else (no greetings, no "listo").
{"action":"tool","tool":"calendar","input":{"action":"add","title":"<short>","start_iso":"<ISO8601>","notes":"<detail>","end_iso":""}}
CLOCK LOCK — **no invented offset:** combine the civil **date** from the **User local time** line with the user's wall-clock **HH:MM** (24h unless they wrote am/pm). Build **start_iso** as that exact local instant encoded in ISO8601 with a real **Z / numeric offset**, not a guessed +3h "correction". If they said **hoy/today** with 15:50, **start_iso** MUST land on **the same calendar day** as that line — never silently roll to **tomorrow** unless they asked for tomorrow/mañana. Omit end_iso entirely if absent (or use ""). Title should reflect what to do (e.g. "Tomar medicamento"). Prose confirmations without this JSON leave the agenda empty — forbidden here.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      : '';

  const mandatoryCalendarListBlock =
    classifierCalendarList && listWindowIso
      ? `

━━━ CALENDAR_LIST_LOCKED ━━━
The user asked to **list** entries from their **Enzo persisted agenda** (same SQLite DB as the web UI Agenda — not Google Calendar). For this turn ONLY: respond with a single canonical JSON tool call and nothing else (no "no tengo acceso a tu calendario", no web_search).
{"action":"tool","tool":"calendar","input":{"action":"list","from_iso":"${listWindowIso.from_iso}","to_iso":"${listWindowIso.to_iso}"}}
Ranges are UTC instants inclusive; the window matches the user's asked day scope (today / mañana / esta semana) in their **User local time** zone. Plain text answers without this JSON are blocked here.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      : '';

  const classifierMailboxUnread =
    isModerate &&
    executableTools.some((t) => t.name === 'email_unread_count') &&
    (input.mailboxIntent === 'unread_stats' || messageLooksLikeMailboxUnreadStatsQuery(calendarCorpus));

  const mandatoryMailboxUnreadBlock = classifierMailboxUnread
    ? `

━━━ MAILBOX_UNREAD_LOCKED ━━━
The user asked for **counts of unread emails** in mailboxes configured on THIS Enzo host (Gmail, Outlook/Microsoft, IMAP connected in Correo — not hypothetical). For this turn ONLY: respond with a single canonical JSON tool call and nothing else (no "open your browser yourself", no simulation).
{"action":"tool","tool":"email_unread_count","input":{}}
Optional: narrow to one mailbox with {"action":"tool","tool":"email_unread_count","input":{"accountId":"<configured id>"}} if they named a single account id. Plain text totals without executing this JSON are blocked here — the counts come from Gmail label INBOX unread, Outlook Graph inbox \`unreadItemCount\`, or IMAP UNSEEN SEARCH.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  const classifierMailboxUnreadSummary =
    isModerate &&
    executableTools.some((t) => t.name === 'read_email') &&
    (input.mailboxIntent === 'unread_summarize' ||
      messageLooksLikeMailboxUnreadSummaryQuery(mailboxUnreadSummarizeCorpus));

  const mandatoryMailboxUnreadSummarizeBlock = classifierMailboxUnreadSummary
    ? `

━━━ MAILBOX_UNREAD_SUMMARY_LOCKED ━━━
The user asked to **inspect or summarise UNREAD emails** among connected Gmail / Outlook / IMAP accounts on THIS host. For this turn ONLY: respond with a single canonical JSON tool call and nothing else (no simulations, no "I need permission").
{"action":"tool","tool":"read_email","input":{"unread_only":true,"limit":32}}
Higher limit is allowed if explicitly needed (still ≤50). Omit accountId unless they named exactly one mailbox id — unread_only MUST stay true unless they pivoted entirely away from unread. Afterwards you summarize ONLY lines returned by read_email — never fabricated subjects/companies/courses.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  const declarativeExecutable = resolveTopSkillDeclarativeExecutable(preResolvedSkills, executableTools);
  const hasCalendarListClassifierWindow = Boolean(classifierCalendarList && listWindowIso);
  const skillFastPathLockActive =
    isModerate &&
    declarativeExecutable != null &&
    !classifierSchedulePersist &&
    !hasCalendarListClassifierWindow &&
    !classifierMailboxUnread &&
    !classifierMailboxUnreadSummary;

  const hostToolsClassifierLockActive =
    isModerate &&
    input.prefersHostTools === true &&
    declarativeExecutable == null &&
    !classifierSchedulePersist &&
    !hasCalendarListClassifierWindow &&
    !classifierMailboxUnread &&
    !classifierMailboxUnreadSummary &&
    executableTools.some((t) => t.name === 'execute_command');

  const mandatoryHostToolsClassifierBlock = hostToolsClassifierLockActive
    ? `

━━━ HOST_TOOLS_CLASSIFIER_LOCKED ━━━
The classifier flagged **prefersHostTools**: the answer MUST come from **THIS host's** integrations / authenticated CLIs (see RELEVANT SKILLS and execute_command), NOT web_search and NOT unsolicited **calendar**.
For this turn ONLY: respond with exactly **ONE** canonical JSON tool call.
Prefer **execute_command** when GitHub/GitLab/Docker/kubectl/shell tooling matches what the user asked (build the command line from HOST context + SKILLS — no fabricated calendar ranges).
The registered **tool** id is always **execute_command** — never use raw shell binaries (\`gh\`, \`git\`, \`docker\`, …) as the JSON \`tool\` field (they belong inside \`input.command\`).
Canonical shape includes: {"action":"tool","tool":"execute_command","input":{"command":"..."}}
Do **NOT** emit **calendar** unless the user wording explicitly asks for appointments/agenda/meetings — "lista … repositorios" is NOT agenda.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  const mandatorySkillFastPathBlock =
    skillFastPathLockActive && declarativeExecutable
      ? `

━━━ SKILL_FASTPATH_LOCKED ━━━
Top RELEVANT SKILL **${declarativeExecutable.skillName}** declares exactly **one** registered tool step: **${declarativeExecutable.tool}**. Follow RELEVANT SKILLS fully for schemas and rationale.
For this turn ONLY: respond with a **single** canonical JSON tool invocation and nothing else — no greetings, no "grant me access/upload a profile URL", no simulation, no fenced markdown around the JSON.${
          declarativeExecutable.commandHint
            ? `

Strong shell hint when emitting **execute_command** (adapt to HOST OS/user paths if necessary):
${declarativeExecutable.commandHint}`
            : ''
        }
Do **not** use web_search for this locked workflow. Omit any prose outside the JSON line.${
          declarativeExecutable.tool === 'execute_command'
            ? ' Canonical shape uses **execute_command** as tool id — never `"tool":"gh"`; put **gh …** inside **input.command** only: {"action":"tool","tool":"execute_command","input":{"command":"..."}}.'
            : ''
        }
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      : '';

  const moderateRetryRequiresToolJsonOnly =
    isModerate &&
    (persistToPathRequested ||
      classifierSchedulePersist ||
      hasCalendarListClassifierWindow ||
      classifierMailboxUnread ||
      classifierMailboxUnreadSummary ||
      skillFastPathLockActive ||
      hostToolsClassifierLockActive);

  const systemPrompt = `${buildAssistantIdentityPrompt(input)}

${buildRuntimeThreeLayersContractPrompt()}

${describeHostForExecuteCommandPrompt(input.runtimeHints)}
${describeLocalWallClockPromptLine(input.runtimeHints)}
${mandatoryCalendarBlock}${mandatoryCalendarListBlock}${mandatoryMailboxUnreadBlock}${mandatoryMailboxUnreadSummarizeBlock}${mandatoryHostToolsClassifierBlock}${mandatorySkillFastPathBlock}
OS: ${osLabel}. Home directory: ${homeDir}. ALWAYS use absolute paths (e.g. ${homeDir}/Downloads, NOT /home/user/...).
${input.prefersHostTools ? 'CLASSIFIER: prefersHostTools — treat this ask as answers from THIS host (tools/sessions/data already connected here), not generalized public web lookups.\n' : ''}

${toolsPrompt}
${skillListSection}
${relevantSkillsSection}
When a tool is required, respond ONLY with canonical JSON (no prose, no markdown fences):
{"action":"tool","tool":"<exact_name_from_below>","input":{...}}

Exact tool names registered in this runtime (includes MCP as listed above): ${exactAllowlist}

CRITICAL: "action", "tool", "input" are CODE IDENTIFIERS — NEVER translate them to Spanish or any other language.
Never invent tool names. If you cannot complete the task with these tools, respond in plain text.
MCP tools appear as mcp_<serverId>_<toolName> — copy the EXACT string from the list. Never use a skill id, skill title, product name, or CLI/binary name mentioned in prose as your JSON **tool** — those belong inside **execute_command**.input.**command**, not as **tool**.
WRONG: {"accion":"ejecutar","herramienta":"df","entrada":{}}
WRONG: {"action":"tool","tool":"<anything_not_in_exact_allowlist>","input":{}}
RIGHT: {"action":"tool","tool":"execute_command","input":{"command":"df -h"}}${moderateToolJsonOnly}

Valid examples (adapt utilities to HOST OS above — linux vs macOS vs Windows):
{"action":"tool","tool":"execute_command","input":{"command":"ls /path/to/folder"}}
{"action":"tool","tool":"execute_command","input":{"command":"df -h"}}
{"action":"tool","tool":"execute_command","input":{"command":"uname -a"}}
{"action":"tool","tool":"web_search","input":{"query":"search terms"}}
{"action":"tool","tool":"read_file","input":{"path":"/path/to/file.txt"}}
{"action":"tool","tool":"write_file","input":{"path":"/absolute/path/to/file.md","content":"# Title\\n\\nFull file body the user asked for — never empty unless they asked for an empty file."}}
{"action":"tool","tool":"remember","input":{"key":"key_name","value":"value"}}
{"action":"tool","tool":"calendar","input":{"action":"list","from_iso":"2026-05-01T12:00:00Z","to_iso":"2026-05-08T12:00:00Z"}}
{"action":"tool","tool":"email_unread_count","input":{}}
{"action":"tool","tool":"read_email","input":{"unread_only":true,"limit":24}}

${toolUsageRule}

TOOL SELECTION — CRITICAL:
- Create or overwrite a FILE with new content at a path the user gave → write_file with {"path":"verbatim absolute path","content":"full text"} — NOT execute_command for the file body (same policy as task decomposition)
- List / show folder contents → execute_command; use a form that shows file vs directory unambiguously, e.g. \`ls -la /path\` or \`ls -Fa /path\` (not plain \`ls\` alone when the user needs trustworthy names and types)
- Read a FILE → read_file (ONLY for files, NEVER for folders/directories)
- User/account-visible data surfaced by **THIS host's** registered tools or authenticated CLIs (see RELEVANT SKILLS and any SKILL_FASTPATH_LOCKED block — e.g. local repo lists, kubectl context, tooling output tied to whoever is logged into this machine) → the mandated concrete tool (**not** web_search unless they clearly asked for public web news/articles)
- Search the internet for information → web_search (public facts only — never as a shortcut for CLI/host-visible account data covered above)
- Schedule or inspect personal agenda / deadlines / appointments for this user → calendar with action add|list|update|delete (ISO8601 timestamps; never put user identifiers in calendar input — the runtime scopes by user automatically)
- How many unread emails **this user has in connected Gmail/Outlook/IMAP inboxes on this machine** → email_unread_count (never prose-only simulation)
- Summaries or "most important among unread / list unread" Gmail+Outlook/IMAP connected here → **read_email** with \`{"unread_only":true,"limit":32}\` **before** prose — never hypothetical projects or recurring themes not in RESULTADO (no NTT/Data/INACAP fluff unless literal in snippets)
- Call an HTTP/API endpoint when user provides a URL → execute_command with curl
  Example: {"action":"tool","tool":"execute_command","input":{"command":"curl -s 'https://api.example.com/data'"}}
- Query current system state (RAM, disk, processes, OS version, CPU) → execute_command — pick binaries/flags appropriate for HOST (e.g. Linux: free, /proc; macOS: vm_stat, sysctl; Windows: WMI/PowerShell where needed)
- External APIs / third-party services (when an mcp_… tool is listed) → use that exact tool name and input schema from the list
- Run any other shell command → execute_command
- NEVER use web_search when the user provides an explicit URL — use execute_command + curl instead
RULES:
- NEVER use read_file on a folder/directory — it will fail. Use execute_command + ls instead.
- FILE AND FOLDER NAMES ARE LITERAL BYTES: every path segment in read_file / execute_command must match EXACTLY what appeared in prior ls (stdout) or in the user's message. NEVER translate, localize, or paraphrase names (e.g. if ls showed organized tasks.txt, do NOT use tareas organizadas.txt or tasks.txt unless that exact name exists).
- If the user uses a vague or partial filename and the exact name is unclear, run execute_command with ls on that directory again — do NOT invent or guess a path.
- Never invent file contents — use read_file
SEARCH BEFORE ANSWERING:
- If you are not 100% certain your knowledge is current and accurate, use web_search first
- For any fact about the real world (prices, people, companies, events, status),
  always verify with web_search before responding
- Never answer factual questions from memory alone — memory can be outdated
- The rule is: when in doubt → web_search — **unless** RELEVANT SKILLS / SKILL_FASTPATH_LOCKED / MAILBOX_* / CALENDAR_* blocks already mandate a registry tool whose data lives on THIS host (then obey that lock — no web_search surrogate)
- Skip web_search entirely for math, greetings, questions strictly about capabilities/identity,
  **local agenda / unread mail tooling already described above**, and **the user's own Enzo persisted agenda / meetings / reminders for a named day or week**
  ("hoy", "mañana", "mis eventos", "esta semana") → use the **calendar** tool \`list\` (data is stored here in SQLite), never web_search, never claim you lack access to "their personal Google Calendar"
- Never invent search results — use web_search
- Never invent system metrics (RAM, disk, processes) — always run the command with execute_command
- One tool call per response, no extra fields in the JSON input
- web_search input must be ONLY: {"query": "search terms"} — nothing else
${
  persistToPathRequested
    ? `
PERSISTENCE / HONESTY (user asked to write to a concrete absolute path):
- Do NOT say the file "ya está creado", "already exists on disk", "guardado", "listo en el disco", or equivalent unless this same turn includes a write_file tool JSON that will be executed.
- If you output only prose with the story or text and no write_file, state clearly that nothing was written to disk yet, or emit write_file with path + content.
`
    : ''
}
${
  input.userLanguage && input.userLanguage !== 'es'
    ? `CRITICAL: Respond in ${input.userLanguage.toUpperCase()}. NOT in Spanish. NOT in any other language.`
    : 'Respond in Spanish (es).'
}
If responding with plain text (no tool), write in this language.`;

  const messages: Message[] = [...resolveAmplifierDialogueMessages(input), { role: 'user', content: input.message }];

  let rawContent: string;
  let firstResponse;
  const fastThinkStart = Date.now();
  const useNativeFastPathTools =
    process.env.ENZO_NATIVE_TOOL_CALLING === 'true' && mergedToolDefs.length > 0;
  try {
    firstResponse = await withTimeout(
      baseProvider.complete({
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.3,
        maxTokens: persistToPathRequested ? FAST_PATH_MAX_TOKENS_PERSIST : FAST_PATH_MAX_TOKENS_DEFAULT,
        ...(useNativeFastPathTools ? { tools: mergedToolDefs } : {}),
      }),
      180_000,
      'SIMPLE first call'
    );
  } catch (err) {
    log.error('[AmplifierLoop] SIMPLE path - primera llamada falló:', err);
    recordStageMetric(stageMetrics, 'think', Date.now() - fastThinkStart, false);
    throw err;
  }
  recordStageMetric(stageMetrics, 'think', Date.now() - fastThinkStart, true);

  rawContent = applyCompletionToolCallsToText(
    firstResponse.content ?? '',
    firstResponse.toolCalls as Array<{ name: string; arguments: Record<string, unknown> | string }> | undefined
  );
  log.info('[AmplifierLoop] SIMPLE path - primera respuesta:', rawContent.substring(0, 150));

  let finalContent = rawContent;

  let normalizedContent = rawContent;
  let plainTextFromModerateRetry: string | null = null;
  if (isModerate && !normalizedContent.startsWith('{')) {
    const strictPrompt = persistToPathRequested
      ? `${buildAssistantIdentityPrompt(input)}
The prior reply was not valid tool JSON. The user asked to CREATE or SAVE a file at an absolute path on this machine — you MUST use write_file.

Output ONLY one JSON object (no prose, no markdown fences):
{"action":"tool","tool":"write_file","input":{"path":"<verbatim absolute path from the user's message>","content":"<complete file body>"}}

Use the exact path from the user's message. Do not invent tool names.`
      : moderateRetryRequiresToolJsonOnly
        ? `${buildAssistantIdentityPrompt(input)}
The prior reply was not valid tool JSON. This turn mandated a LOCKED canonical tool invocation (calendar, mailbox, prefersHostTools/host CLI, SKILL_FASTPATH, or persisted file body).

Emit ONLY **one** JSON object (no prose, no markdown fences):
{"action":"tool","tool":"<name>","input":{...}}
where **<name>** MUST be copied exactly from: ${exactAllowlist}.${declarativeExecutable && skillFastPathLockActive ? ` Prefer "${declarativeExecutable.tool}".${declarativeExecutable.commandHint ? ` Align execute_command payloads with intent such as ${JSON.stringify(declarativeExecutable.commandHint)}.` : ''}` : ''}

Do not substitute web_search for host-visible data blocks. Never invent tool names or describe actions you cannot execute via JSON here.`
        : `${buildAssistantIdentityPrompt(input)}
The prior reply was not valid tool JSON for a request that may need tools.

Return EXACTLY ONE of:
A) One JSON object only (no prose): {"action":"tool","tool":"<name>","input":{...}}
   where <name> is copied exactly from: ${exactAllowlist}
B) If the user's message needs no tool-backed action: one short plain-text reply — no JSON, no markdown.

Never invent tool names.`;
    try {
      const retry = await withTimeout(
        baseProvider.complete({
          messages: [
            { role: 'system', content: strictPrompt },
            ...resolveAmplifierDialogueMessages(input),
            { role: 'user', content: input.message },
          ],
          temperature: 0,
          maxTokens: persistToPathRequested
            ? MODERATE_STRICT_RETRY_MAX_TOKENS_PERSIST
            : MODERATE_STRICT_RETRY_MAX_TOKENS_DEFAULT,
          ...(useNativeFastPathTools ? { tools: mergedToolDefs } : {}),
        }),
        60_000,
        'SIMPLE moderate strict-tool retry'
      );
      const retried = applyCompletionToolCallsToText(
        retry.content ?? '',
        retry.toolCalls as Array<{ name: string; arguments: Record<string, unknown> | string }> | undefined
      ).trim();
      const extractedObj = retried.startsWith('{') ? retried : extractFirstJsonObject(retried);
      if (extractedObj) {
        normalizedContent = extractedObj;
        log.info('[AmplifierLoop] SIMPLE path - strict moderation retry produced tool JSON');
      } else if (retried.length > 0 && !persistToPathRequested && !moderateRetryRequiresToolJsonOnly) {
        plainTextFromModerateRetry = retried;
        normalizedContent = '';
        log.info('[AmplifierLoop] SIMPLE path - strict moderation retry produced plain text');
      } else if (retried.length > 0 && persistToPathRequested) {
        log.info('[AmplifierLoop] SIMPLE path - persist retry got prose; will attempt two-phase recovery if needed');
      }
    } catch (retryErr) {
      log.warn('[AmplifierLoop] SIMPLE path - strict moderation retry failed:', retryErr);
    }
  }

  if (plainTextFromModerateRetry !== null) {
    finalContent = plainTextFromModerateRetry;
  }

  if (plainTextFromModerateRetry === null && !normalizedContent.startsWith('{')) {
    const knownToolNames = new Set(mergedToolDefs.map((t) => t.name.toLowerCase()));
    const toolnamePattern = rawContent.match(/^(\w+)\s*(\{[\s\S]+)/);
    if (toolnamePattern) {
      const possibleTool = toolnamePattern[1].toLowerCase();
      const jsonPart = toolnamePattern[2];
      let depth = 0,
        end = -1,
        inStr = false,
        esc = false;
      for (let i = 0; i < jsonPart.length; i++) {
        const ch = jsonPart[i];
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === '\\' && inStr) {
          esc = true;
          continue;
        }
        if (ch === '"') {
          inStr = !inStr;
          continue;
        }
        if (inStr) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end !== -1 && knownToolNames.has(possibleTool)) {
        const argsJson = jsonPart.slice(0, end + 1);
        normalizedContent = `{"action":"tool","tool":"${possibleTool}","input":${argsJson}}`;
        log.info(`[AmplifierLoop] SIMPLE path - formato normalizado: ${normalizedContent.substring(0, 100)}`);
      } else if (end !== -1) {
        log.info(
          `[AmplifierLoop] SIMPLE path - prefijo "${possibleTool}{...}" descartado (no es tool conocido)`
        );
      }
    }

    if (!normalizedContent.startsWith('{')) {
      const embeddedJson = extractFirstJsonObject(rawContent);
      if (embeddedJson) {
        const parsedEmbedded = parseFirstJsonObject<any>(embeddedJson, { tryRepair: true });
        const looksLikeToolCall =
          !!parsedEmbedded?.value &&
          typeof parsedEmbedded.value === 'object' &&
          !Array.isArray(parsedEmbedded.value) &&
          (parsedEmbedded.value.action === 'tool' || typeof parsedEmbedded.value.tool === 'string');
        if (looksLikeToolCall) {
          normalizedContent = embeddedJson;
          log.info('[AmplifierLoop] SIMPLE path - JSON embebido detectado y extraído');
        } else {
          log.info('[AmplifierLoop] SIMPLE path - JSON embebido descartado (no es tool call canónico)');
        }
      }
    }
  }

  let ncParse = normalizedContent;
  let consumedAllowlistParseRetry = false;

  attemptParseLoop: while (plainTextFromModerateRetry === null && ncParse.startsWith('{')) {
    try {
      const parsedResult = parseFirstJsonObject<any>(ncParse, { tryRepair: true });
      if (!parsedResult) {
        const repairedCandidate = repairJsonString(ncParse);
        const repairedResult = parseFirstJsonObject<any>(repairedCandidate, { tryRepair: true });
        if (!repairedResult) {
          throw new Error('JSON inválido incluso después de reparación');
        }
        log.info('[AmplifierLoop] SIMPLE path - JSON reparado exitosamente');
      }
      const parsed = (
        parsedResult ?? parseFirstJsonObject<any>(repairJsonString(ncParse), { tryRepair: true })
      )!.value;
      let { toolName, toolInput } = normalizeFastPathToolCall(parsed, executableTools);

      let resolved =
        toolName && toolName !== 'none'
          ? resolveFastPathToolForExecution(toolName, mergedToolDefs, executableTools)
          : null;

      if (resolved) {
        let execName = resolved.name;
        let preparedToolInput = applyExecutableToolContext(execName, toolInput, executableTools);

        const validationError = validateToolInput(execName, preparedToolInput, executableTools, mcpRegistry);
        if (validationError) {
          log.warn(`[AmplifierLoop] SIMPLE path - invalid tool input: ${validationError}`);
          const correctedCall = await requestToolInputCorrection(
            input.message,
            execName,
            toolInput,
            validationError
          ).catch((error) => {
            log.warn('[AmplifierLoop] SIMPLE path - tool correction failed:', error);
            return null;
          });
          if (correctedCall) {
            toolName = correctedCall.toolName;
            toolInput = correctedCall.toolInput;
            resolved = resolveFastPathToolForExecution(toolName, mergedToolDefs, executableTools);
            if (!resolved) {
              finalContent = buildUnknownToolUserMessage(exactAllowlist, input.userLanguage);
              log.warn(`[AmplifierLoop] SIMPLE path - unresolved after correction: ${toolName}`);
            } else {
              execName = resolved.name;
              log.info(`[AmplifierLoop] SIMPLE path - corrected tool input for "${execName}"`);
              preparedToolInput = applyExecutableToolContext(execName, toolInput, executableTools);
            }
          }
        }

        if (resolved) {
            const validationAfterCorrection = validateToolInput(
              execName,
              preparedToolInput,
              executableTools,
              mcpRegistry
            );
            if (validationAfterCorrection) {
              finalContent = `Tool input validation failed: ${validationAfterCorrection}`;
              log.warn(`[AmplifierLoop] SIMPLE path - ${validationAfterCorrection}`);
            } else {
            toolsUsed.add(execName);
            log.info(`[AmplifierLoop] SIMPLE path - ejecutando "${execName}" (${resolved.kind}):`, toolInput);

            let rawToolOutput = '';
            let setupError: string | undefined;

            const actStart = Date.now();
            if (resolved.kind === 'internal') {
              const tool = executableTools.find((t) => t.name === execName);
              if (!tool) {
                setupError = `Herramienta interna no encontrada: ${execName}`;
              } else {
                const scoped = attachToolScopedUserId(execName, preparedToolInput, input.userId);
                const withClock = attachCalendarDisplayClock(execName, scoped, input.runtimeHints);
                const result = await tool.execute(withClock);
                rawToolOutput = extractToolOutput(result, { maxChars: 3000 });
              }
            } else if (mcpRegistry) {
              try {
                rawToolOutput = await mcpRegistry.callTool(execName, preparedToolInput);
              } catch (mcpErr) {
                const normalizedMcpError = normalizeError(mcpErr, 'mcp');
                rawToolOutput = `Error [${normalizedMcpError.code}]: ${normalizedMcpError.technicalMessage}`;
              }
            } else {
              setupError = 'MCP no está disponible en este entorno.';
            }
            recordStageMetric(
              stageMetrics,
              'act',
              Date.now() - actStart,
              !setupError && !rawToolOutput.toLowerCase().startsWith('error')
            );

              if (setupError) {
                finalContent = setupError;
              } else {
              const toolOutput = rawToolOutput;

              log.info('[AmplifierLoop] SIMPLE path - resultado tool (preview):', toolOutput.substring(0, 200));

              if (resolved.kind === 'internal' && shouldReturnRawToolOutput(execName, input.message, toolOutput)) {
                const lang = (input.userLanguage ?? 'es').toLowerCase();
                const verbatimLead =
                  execName === 'execute_command'
                    ? lang.startsWith('es')
                      ? 'Salida del sistema (texto exacto; úsala tal cual para rutas o nombres en mensajes siguientes):\n\n'
                      : 'System output (verbatim; use exactly as shown for paths or names in follow-ups):\n\n'
                    : '';
                finalContent = verbatimLead + toolOutput;
                log.info('[AmplifierLoop] SIMPLE path - síntesis omitida (output directo)');
              } else {
                finalContent = await synthesizeFastPathToolOutput({
                  baseProvider,
                  withTimeout,
                  input,
                  relevantSkillsSection,
                  requiredTemplateSection,
                  execName,
                  toolOutput,
                  steps,
                  modelsUsed,
                  verifyBeforeSynthesize: !!verifyBeforeSynthesize,
                  stageMetrics,
                  log,
                });
              }
            }
          }
        }
      } else if (toolName && toolName !== 'none') {
        log.warn(`[AmplifierLoop] SIMPLE path - tool "${toolName}" no encontrada`);
        if (
          process.env.ENZO_FASTPATH_ALLOWLIST_RETRY === 'true' &&
          !consumedAllowlistParseRetry
        ) {
          consumedAllowlistParseRetry = true;
          try {
            const allowlistRepair = await withTimeout(
              baseProvider.complete({
                messages: [
                  {
                    role: 'system',
                    content: `${buildAssistantIdentityPrompt(input)}
The assistant tried to call a tool that does not exist. Output EXACTLY one of:
(1) {"action":"tool","tool":"<name>","input":{...}} where <name> is one of: ${exactAllowlist}
(2) Plain text if no tool fits the user message.`,
                  },
                  ...resolveAmplifierDialogueMessages(input),
                  { role: 'user', content: input.message },
                ],
                temperature: 0,
                maxTokens: 280,
                ...(useNativeFastPathTools ? { tools: mergedToolDefs } : {}),
              }),
              60_000,
              'SIMPLE allowlist-tool retry'
            );
            let mergedTxt = applyCompletionToolCallsToText(
              allowlistRepair.content ?? '',
              allowlistRepair.toolCalls as Array<{
                name: string;
                arguments: Record<string, unknown> | string;
              }>
            ).trim();
            const extractedRepair = mergedTxt.startsWith('{')
              ? mergedTxt
              : extractFirstJsonObject(mergedTxt);
            if (extractedRepair) {
              ncParse = extractedRepair;
              log.info('[AmplifierLoop] SIMPLE path - allowlist retry yielded new JSON');
              continue attemptParseLoop;
            }
          } catch (allowErr) {
            log.warn('[AmplifierLoop] SIMPLE path - allowlist retry failed:', allowErr);
          }
        }
        finalContent = buildUnknownToolUserMessage(exactAllowlist, input.userLanguage);
        break attemptParseLoop;
      }
      break attemptParseLoop;
    } catch (err) {
      log.warn('[AmplifierLoop] SIMPLE path - error procesando tool:', err);
      const rawTrimmed = rawContent.trim();
      if (rawTrimmed.startsWith('{') || rawTrimmed.startsWith('[')) {
        finalContent = 'Tuve un problema procesando tu solicitud. ¿Podés reformularla?';
      } else {
        log.info(
          '[AmplifierLoop] SIMPLE path - parse falló pero rawContent es prosa; sirviendo respuesta natural'
        );
        finalContent = rawContent;
      }
      break attemptParseLoop;
    }
  }

  if (persistToPathRequested && !toolsUsed.has('write_file')) {
    finalContent = await attemptPersistWriteRecovery({
      input,
      baseProvider,
      withTimeout,
      executableTools,
      mcpRegistry,
      toolsUsed,
      stageMetrics,
      steps,
      modelsUsed,
      log,
      verifyBeforeSynthesize: !!verifyBeforeSynthesize,
      relevantSkillsSection,
      requiredTemplateSection,
    });
  }

  if (!finalContent) {
    log.warn('[AmplifierLoop] SIMPLE path - contenido vacío, usando fallback');
    finalContent = 'No pude procesar tu solicitud. ¿Puedes intentarlo de nuevo?';
  }

  // Nunca devolver JSON crudo al usuario.
  const trimmedFinalContent = finalContent.trim();
  if (trimmedFinalContent.startsWith('{') || trimmedFinalContent.startsWith('[')) {
    finalContent = 'Entendido, procesando tu solicitud...';
  }

  log.info('[AmplifierLoop] SIMPLE path - respuesta final:', finalContent.substring(0, 100));

  return {
    content: finalContent,
    requestId,
    stepsUsed: steps,
    modelsUsed: Array.from(modelsUsed),
    toolsUsed: Array.from(toolsUsed),
    injectedSkills: Array.from(injectedSkills.values()),
    durationMs: Date.now() - startTime,
    stageMetrics,
    complexityUsed: classifiedLevel,
  };
}
