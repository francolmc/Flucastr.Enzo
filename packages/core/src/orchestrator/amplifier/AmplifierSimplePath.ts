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
  buildContextAnchorPrompt,
  buildMemoryPromptSection,
  buildRuntimeThreeLayersContractPrompt,
  buildToolsPrompt,
  buildRelevantSkillsSection,
  capRelevantSkillsForPrompt,
  extractOutputTemplates,
  buildThinkContractPrompt,
} from './AmplifierLoopPromptHelpers.js';
import {
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
} from '../Classifier.js';
import { resolveTopSkillDeclarativeExecutable } from '../skillFastPathLock.js';
import { extractFilePath } from '../../utils/PathExtractor.js';

const FAST_PATH_MAX_TOKENS_DEFAULT = 768;
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
  /** Mutable accumulator — caller passes by reference to collect real token counts. */
  usageAccumulator?: { inputTokens: number; outputTokens: number };
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
  usageAccumulator?: { inputTokens: number; outputTokens: number };
}): Promise<string> {
  const verifyStart = Date.now();
  const verified = await runVerifyBeforeSynthesizeIfEnabled(
    { baseProvider: params.baseProvider, withTimeout: params.withTimeout, usageAccumulator: params.usageAccumulator },
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
      if (params.usageAccumulator) {
        params.usageAccumulator.inputTokens += synthesisResponse.usage?.inputTokens ?? 0;
        params.usageAccumulator.outputTokens += synthesisResponse.usage?.outputTokens ?? 0;
      }
    }
    return synthesisResponse?.content?.trim() ? synthesisResponse.content.trim() : params.toolOutput;
  } catch (synthErr) {
    params.log.error('[AmplifierLoop] SIMPLE path - síntesis falló:', synthErr);
    recordStageMetric(params.stageMetrics, 'synthesize', Date.now() - synthStart, false);
    return params.toolOutput;
  }
}

/**
 * Two-phase fallback: generate file body then execute via MCP tools when available.
 * If no MCPs connected, return appropriate message.
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
  // Check if MCP filesystem tools are available
  const mcpTools = params.mcpRegistry?.getAllTools() ?? [];
  const writeTools = mcpTools.filter(t => 
    t.name.includes('write') || t.name.includes('create') || t.name.includes('file')
  );

  if (writeTools.length === 0) {
    const lang = (params.input.userLanguage ?? 'es').toLowerCase();
    return lang.startsWith('en')
      ? 'No filesystem tools available. To write files, please connect a MCP filesystem server. Without MCP tools, I can only chat or use memory (remember/recall).'
      : 'No hay herramientas de sistema de archivos disponibles. Para escribir archivos, conectá un servidor MCP de filesystem. Sin herramientas MCP, solo puedo conversar o usar memoria (remember/recall).';
  }

  // MCP tools available - model should use them directly, but we end up here if it didn't
  const lang = (params.input.userLanguage ?? 'es').toLowerCase();
  return lang.startsWith('en')
    ? 'Use the available MCP filesystem tools to complete this task.'
    : 'Usá las herramientas MCP de filesystem disponibles para completar esta tarea.';
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
    usageAccumulator,
  } = ctx;

  const isModerate = classifiedLevel === ComplexityLevel.MODERATE;
  log.info(`[AmplifierLoop] Fast-path ${isModerate ? 'MODERATE' : 'SIMPLE'}`);

  const mergedToolDefs = mergeAvailableToolDefinitions(input, mcpRegistry);
  const toolsPrompt = buildToolsPrompt(mergedToolDefs);

  const skillsForPrompt = capRelevantSkillsForPrompt(preResolvedSkills);
  const relevantSkillsSection = buildRelevantSkillsSection(skillsForPrompt);
  const requiredTemplateSection = extractOutputTemplates(skillsForPrompt);

  const exactAllowlist = mergedToolDefs.map((t) => t.name).join(', ');

  const persistToPathRequested = messageIndicatesPersistedWriteToAbsolutePath(input.message);

  const homeDir = resolveHomeDir(input);
  const osLabel = resolveOsLabel(input);

  const declarativeExecutable = resolveTopSkillDeclarativeExecutable(preResolvedSkills, executableTools);
  const skillFastPathLockActive =
    isModerate &&
    declarativeExecutable != null;

  const hostToolsClassifierLockActive =
    isModerate &&
    input.prefersHostTools === true &&
    declarativeExecutable == null &&
    executableTools.some((t) => t.name.startsWith('mcp_'));

  const moderateRetryRequiresToolJsonOnly =
    isModerate &&
    (persistToPathRequested ||
      skillFastPathLockActive ||
      hostToolsClassifierLockActive);

  const webSearchTool = mergedToolDefs.find(t => {
    const name = t.name.toLowerCase();
    const desc = (t.description ?? '').toLowerCase();
    return (
      (name.includes('web') && name.includes('search')) ||
      name.includes('web-search') ||
      (name.endsWith('_search') && (
        desc.includes('web') ||
        desc.includes('internet') ||
        desc.includes('duckduckgo') ||
        desc.includes('brave') ||
        desc.includes('search the web') ||
        desc.includes('buscar en internet')
      ))
    );
  });
  const hasWebSearch = webSearchTool != null;
  const webSearchToolName = webSearchTool?.name;

  const memorySection = buildMemoryPromptSection(input);
  const systemPrompt = [
    buildAssistantIdentityPrompt(input),
    memorySection,
    toolsPrompt,
    relevantSkillsSection,
    buildThinkContractPrompt({ context: '', hasWebSearch, webSearchToolName }),
  ]
    .filter(Boolean)
    .join('\n\n');

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
  if (usageAccumulator && firstResponse) {
    usageAccumulator.inputTokens += firstResponse.usage?.inputTokens ?? 0;
    usageAccumulator.outputTokens += firstResponse.usage?.outputTokens ?? 0;
  }

  rawContent = applyCompletionToolCallsToText(
    firstResponse.content ?? '',
    firstResponse.toolCalls as Array<{ name: string; arguments: Record<string, unknown> | string }> | undefined
  );
  log.info('[AmplifierLoop] SIMPLE path - primera respuesta:', rawContent.substring(0, 150));

  let finalContent = rawContent;

  let normalizedContent = rawContent;
  let plainTextFromModerateRetry: string | null = null;

  // Some models (e.g. Gemini) return a {"thought":"..."} object that starts with '{' but is NOT a tool call.
  // Treat that the same as "no JSON" so the strict-retry logic fires correctly.
  // Also accept alternative valid formats that normalizeFastPathToolCall handles:
  //   - {"action":"<tool_name>",...}  (action-as-tool-name, used by some local models)
  //   - {"name":"<tool_name>","arguments":{...}}  (Ollama native function call format returned as text)
  const knownToolNamesLower = new Set(mergedToolDefs.map((t) => t.name.toLowerCase()));
  const rawLooksLikeToolCall = (() => {
    if (!normalizedContent.trim().startsWith('{')) return false;
    try {
      const p = JSON.parse(normalizedContent) as Record<string, unknown>;
      if (p.action === 'tool' || typeof p.tool === 'string') return true;
      const actionStr = String(p.action ?? '').toLowerCase();
      if (actionStr && knownToolNamesLower.has(actionStr)) return true;
      const nameStr = String(p.name ?? '').toLowerCase();
      if (nameStr && typeof p.arguments !== 'undefined') return true;
      return false;
    } catch { return false; }
  })();

  if (isModerate && (!normalizedContent.startsWith('{') || !rawLooksLikeToolCall)) {
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
      if (usageAccumulator) {
        usageAccumulator.inputTokens += retry.usage?.inputTokens ?? 0;
        usageAccumulator.outputTokens += retry.usage?.outputTokens ?? 0;
      }
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
                  usageAccumulator,
                });
              }
            }
          }
        }
      } else if (toolName && toolName !== 'none') {
        log.warn(`[AmplifierLoop] SIMPLE path - tool "${toolName}" no encontrada`);

        // Step 1: Fuzzy match — catch typos/variants like "read_emails" → "read_email"
        // without an extra LLM call.
        const tnLower = toolName.toLowerCase();
        const fuzzyMatch = mergedToolDefs.find((t) => {
          const n = t.name.toLowerCase();
          return n.includes(tnLower) || tnLower.includes(n);
        });
        if (fuzzyMatch) {
          log.info(`[AmplifierLoop] SIMPLE path - fuzzy matched "${toolName}" → "${fuzzyMatch.name}"`);
          ncParse = JSON.stringify({ action: 'tool', tool: fuzzyMatch.name, input: toolInput ?? {} });
          continue attemptParseLoop;
        }

        const allowlistRetryEnv = process.env.ENZO_FASTPATH_ALLOWLIST_RETRY;
        /** Default ON for MODERATE (one repair completion). Set ENZO_FASTPATH_ALLOWLIST_RETRY=false to disable; true forces retry on SIMPLE too. */
        const shouldRetryUnknownTool =
          allowlistRetryEnv === 'true' ||
          (allowlistRetryEnv !== 'false' && isModerate);
        if (shouldRetryUnknownTool && !consumedAllowlistParseRetry) {
          consumedAllowlistParseRetry = true;
          try {
            // Build the repair prompt WITHOUT angle-bracket placeholders — small models
            // (qwen2.5:7b) fill "<name>" with the literal word "tool" from surrounding context.
            // Instead, use a concrete example with an actual valid tool name.
            // Find the appropriate MCP tool based on user request
            const mcpToolsList = mergedToolDefs.filter(t => t.name.startsWith('mcp_'));
            
            // For filesystem requests, find the specific MCP tool needed
            const messageLower = input.message.toLowerCase();
            const isListDir = messageLower.includes('lista') || messageLower.includes('mostrar') || 
                              messageLower.includes('contenido') || messageLower.includes('ls') ||
                              messageLower.includes('carpeta') || messageLower.includes('folder');
            const isReadFile = messageLower.includes('leer') || messageLower.includes('read');
            const isWriteFile = messageLower.includes('escribir') || messageLower.includes('crear') || 
                                messageLower.includes('guardar') || messageLower.includes('save');
            
            // Find the specific tool
            let exampleTool = 'remember';
            let exampleInput = '{}';
            
            if (isListDir) {
              const listDirTool = mcpToolsList.find(t => t.name.includes('list_directory'));
              if (listDirTool) {
                exampleTool = listDirTool.name;
                exampleInput = '{"path":"/Users/franco"}';
              }
            } else if (isReadFile) {
              const readTool = mcpToolsList.find(t => t.name.includes('read_file'));
              if (readTool) {
                exampleTool = readTool.name;
                exampleInput = '{"path":"/Users/franco/example.txt"}';
              }
            } else if (isWriteFile) {
              const writeTool = mcpToolsList.find(t => t.name.includes('write_file'));
              if (writeTool) {
                exampleTool = writeTool.name;
                exampleInput = '{"path":"/Users/franco/test.txt","content":"Hello World"}';
              }
            } else if (mcpToolsList.length > 0) {
              // Use first MCP tool as fallback
              exampleTool = mcpToolsList[0].name;
            }
            
            const exampleJson = `{"action":"tool","tool":"${exampleTool}","input":${exampleInput}}`;

            const repairSystemContent = mcpToolsList.length > 0
              ? `Tool "${toolName}" does not exist. You MUST use an MCP tool from the list below.

IMPORTANT: For directory listing use EXACTLY: mcp_*_list_directory with {"path":"/Users/franco"}
For file reading use: mcp_*_read_file with {"path":"..."}
For file writing use: mcp_*_write_file with {"path":"...","content":"..."}

Valid tools (USE EXACT NAMES):
${exactAllowlist}

Output ONE JSON only (no prose, no explanation):
${exampleJson}`
              : `Tool "${toolName}" does not exist.
Valid tools: ${exactAllowlist}
Pick the correct tool for the user request. Output ONE JSON only:
${exampleJson}`;

            const allowlistRepair = await withTimeout(
              baseProvider.complete({
                messages: [
                  {
                    role: 'system',
                    content: repairSystemContent,
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
            if (usageAccumulator) {
              usageAccumulator.inputTokens += allowlistRepair.usage?.inputTokens ?? 0;
              usageAccumulator.outputTokens += allowlistRepair.usage?.outputTokens ?? 0;
            }
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

  // Only attempt recovery if: 
  // 1. There was a request to persist/write AND
  // 2. No tool was successfully executed AND  
  // 3. There are MCP tools available
  // (moved outside the block where rawToolOutput is defined, checking in a different way)
  const mcpToolsAvailable = (mcpRegistry?.getAllTools() ?? []).length > 0;
  const anyToolUsed = toolsUsed.size > 0;
  
  if (persistToPathRequested && !anyToolUsed && mcpToolsAvailable) {
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
    ...(usageAccumulator && (usageAccumulator.inputTokens > 0 || usageAccumulator.outputTokens > 0)
      ? { usage: { inputTokens: usageAccumulator.inputTokens, outputTokens: usageAccumulator.outputTokens } }
      : {}),
  };
}
