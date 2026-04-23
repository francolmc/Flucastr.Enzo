import { Message, LLMProvider } from '../providers/types.js';
import { AmplifierInput, AmplifierResult, Step, AvailableCapabilities, ComplexityLevel, ResolvedAction, InjectedSkillUsage } from './types.js';
import { CapabilityResolver } from './CapabilityResolver.js';
import { ContextSynthesizer } from './ContextSynthesizer.js';
import { EscalationManager } from './EscalationManager.js';
import { IntentAnalyzer } from './IntentAnalyzer.js';
import { ExecutableTool } from '../tools/types.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { MCPRegistry } from '../mcp/index.js';
import { SkillResolver, RelevantSkill } from './SkillResolver.js';
import { Decomposer, Subtask } from './Decomposer.js';
import { formatSearchResults } from '../utils/SearchResultFormatter.js';
import { extractFilePath, extractTargetDir } from '../utils/PathExtractor.js';
import { extractToolOutput } from '../utils/ToolOutputExtractor.js';
import { FileOrganizationService } from '../services/FileOrganizationService.js';
import path from 'path';
import { parseFirstJsonObject, repairJsonString } from '../utils/StructuredJson.js';
import { normalizeError } from './NormalizedError.js';
import type { AmplifierLoopLog } from './amplifier/AmplifierLoopLog.js';
import { createDefaultAmplifierLoopLog } from './amplifier/AmplifierLoopLog.js';
import { initStageMetrics, recordStageMetric } from './amplifier/AmplifierLoopMetrics.js';
import {
  buildAssistantIdentityPrompt,
  buildRelevantSkillsSection,
  extractOutputTemplates,
  extractWeatherLocation,
  buildWeatherGeocodingCommand,
  extractWeatherCoordsFromSteps,
  buildWeatherForecastCommand,
} from './amplifier/AmplifierLoopPromptHelpers.js';
import {
  extractFirstJsonObject,
  mergeAvailableToolDefinitions,
  normalizeFastPathToolCall,
  resolveFastPathToolForExecution,
  shouldReturnRawToolOutput,
  shellOutputIndicatesFailure,
  textContainsPlaceholderPath,
  validateToolInput,
} from './amplifier/AmplifierLoopFastPathTools.js';

export type AmplifierLoopOptions = {
  maxIterations?: number;
  skillRegistry?: SkillRegistry;
  mcpRegistry?: MCPRegistry;
  log?: AmplifierLoopLog;
  /** false disables file-organization subtask path */
  fileOrganization?: boolean;
};

export class AmplifierLoop {
  private log: AmplifierLoopLog;
  private baseProvider: LLMProvider;
  private capabilityResolver: CapabilityResolver;
  private contextSynthesizer: ContextSynthesizer;
  private escalationManager: EscalationManager;
  private intentAnalyzer: IntentAnalyzer;
  private skillResolver: SkillResolver;
  private decomposer: Decomposer;
  private fileOrgService: FileOrganizationService | null;
  private maxIterations: number;
  private executableTools: ExecutableTool[];
  private skillRegistry?: SkillRegistry;
  private mcpRegistry?: MCPRegistry;

  constructor(
    baseProvider: LLMProvider,
    executableTools: ExecutableTool[] = [],
    options?: AmplifierLoopOptions
  ) {
    this.log = options?.log ?? createDefaultAmplifierLoopLog();
    this.baseProvider = baseProvider;
    this.executableTools = executableTools;
    this.maxIterations = options?.maxIterations ?? 8;
    this.skillRegistry = options?.skillRegistry;
    this.mcpRegistry = options?.mcpRegistry;
    this.capabilityResolver = new CapabilityResolver();
    this.intentAnalyzer = new IntentAnalyzer(baseProvider);
    this.capabilityResolver.setIntentAnalyzer(this.intentAnalyzer);
    this.contextSynthesizer = new ContextSynthesizer();
    this.escalationManager = new EscalationManager();
    this.skillResolver = new SkillResolver();
    this.decomposer = new Decomposer(baseProvider);
    this.fileOrgService =
      options?.fileOrganization === false
        ? null
        : new FileOrganizationService(baseProvider, this.withTimeout.bind(this));
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`LLM timeout after ${ms}ms (${label})`)), ms)
      ),
    ]);
  }

  private async requestToolInputCorrection(
    userMessage: string,
    toolName: string,
    input: any,
    errorDetail: string
  ): Promise<{ toolName: string; toolInput: any } | null> {
    const correctionPrompt = `You produced an invalid tool call.
Return ONLY one valid JSON object in this format:
{"action":"tool","tool":"${toolName}","input":{...}}

Validation error: ${errorDetail}
Previous input: ${JSON.stringify(input ?? {})}

Do not change the tool name. Only fix missing/invalid input fields.
No markdown. No prose.`;

    const response = await this.withTimeout(
      this.baseProvider.complete({
        messages: [
          { role: 'system', content: correctionPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0,
        maxTokens: 256,
      }),
      60_000,
      'tool input correction'
    );

    const parsed = parseFirstJsonObject<any>(response.content ?? '', { tryRepair: true });
    if (!parsed) return null;
    return normalizeFastPathToolCall(parsed.value, this.executableTools);
  }

  async amplify(input: AmplifierInput): Promise<AmplifierResult> {
    const startTime = Date.now();
    const steps: Step[] = [];
    const requestId = input.requestId;
    const stageMetrics = initStageMetrics();
    const modelsUsed = new Set<string>();
    const toolsUsed = new Set<string>();

    let currentContext = '';
    let iteration = 0;
    let hasEnoughInfo = false;

    modelsUsed.add(this.baseProvider.model);
    const preResolvedSkills = this.skillRegistry
      ? await this.skillResolver.resolveRelevantSkills(input.message, this.skillRegistry)
      : [];
    if (preResolvedSkills.length > 0) {
      this.log.info(
        `[AmplifierLoop] Relevant skills pre-resolved: ${preResolvedSkills
          .map((skill) => `${skill.name}(${Math.round(skill.relevanceScore * 100)}%)`)
          .join(', ')}`
      );
    }
    const injectedSkills = new Map<string, InjectedSkillUsage>();
    const rememberInjectedSkills = (skills: RelevantSkill[]): void => {
      for (const skill of skills) {
        const existing = injectedSkills.get(skill.id);
        if (!existing || skill.relevanceScore > existing.relevanceScore) {
          injectedSkills.set(skill.id, {
            id: skill.id,
            name: skill.name,
            relevanceScore: skill.relevanceScore,
          });
        }
      }
    };
    rememberInjectedSkills(preResolvedSkills);

    const minRequiredSteps = preResolvedSkills.reduce((max, skill) => {
      // Fuente 1: pasos estructurados en frontmatter (más confiable)
      if (skill.steps?.length) return Math.max(max, skill.steps.length);
      // Fuente 2: detectar el paso de número más alto mencionado en el contenido
      const markers = (skill.content ?? '').match(/\bpaso\s+(\d+)|\bstep\s+(\d+)/gi) ?? [];
      const maxN = markers.reduce((m, s) => {
        const n = parseInt(s.replace(/\D/g, ''));
        return isNaN(n) ? m : Math.max(m, n);
      }, 0);
      return Math.max(max, maxN);
    }, 0);

    const hasMultiStepSkillRequirement = minRequiredSteps >= 2;
    if (hasMultiStepSkillRequirement) {
      this.log.info(`[AmplifierLoop] Multi-step skill detected: minRequiredSteps=${minRequiredSteps}`);
    }

    // FAST-PATH: SIMPLE y MODERATE usan el mismo path directo (un solo tool call + síntesis)
    // MODERATE = exactamente una herramienta requerida, igual que SIMPLE pero con tool obligatoria
    if ((input.classifiedLevel === ComplexityLevel.SIMPLE || input.classifiedLevel === ComplexityLevel.MODERATE) && !hasMultiStepSkillRequirement) {
      const isModerate = input.classifiedLevel === ComplexityLevel.MODERATE;
      this.log.info(`[AmplifierLoop] Fast-path ${isModerate ? 'MODERATE' : 'SIMPLE'}`);

      const mergedToolDefs = mergeAvailableToolDefinitions(input, this.mcpRegistry);
      const toolsList = mergedToolDefs.map((t) => `- ${t.name}: ${t.description}`).join('\n');

      // Detect if user is asking about capabilities — inject real skill list to avoid hallucination
      const isCapabilityQuery = /\b(qu[eé] puedes|what can you|capabilities|habilidades|skills|funciones|qu[eé] sabes|what do you|qu[eé] eres capaz|qu[eé] haces|what are you)\b/i.test(input.message);
      let skillListSection = '';
      if (isCapabilityQuery && this.skillRegistry) {
        const enabledSkills = this.skillRegistry.getEnabled();
        if (enabledSkills.length > 0) {
          const skillLines = enabledSkills
            .map(s => `- ${s.metadata.name}: ${s.metadata.description}`)
            .join('\n');
          skillListSection = `\nAVAILABLE SKILLS (list these when asked about capabilities):\n${skillLines}\n`;
        }
      }
      const relevantSkillsSection = buildRelevantSkillsSection(preResolvedSkills);
      const requiredTemplateSection = extractOutputTemplates(preResolvedSkills);

      const toolUsageRule = isModerate
        ? `You MUST use one of the tools above to answer this request. Do NOT answer from memory.`
        : `If you can answer directly without tools, respond with plain text.`;

      const homeDir = process.env.HOME ?? '/Users/franco';
      const systemPrompt = `${buildAssistantIdentityPrompt(input)}
Date: ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}.
OS: macOS. Home directory: ${homeDir}. ALWAYS use absolute macOS paths (e.g. ${homeDir}/Downloads, NOT /home/user/...).

AVAILABLE TOOLS:
${toolsList}
${skillListSection}
${relevantSkillsSection}
To use a tool, respond ONLY with JSON (no extra text, no markdown):
{"action":"tool","tool":"TOOL_NAME","input":{PARAMS}}

CRITICAL: "action", "tool", "input" are CODE IDENTIFIERS — NEVER translate them to Spanish or any other language.
Built-in tool names: execute_command, web_search, read_file, write_file, remember.
MCP tools are listed above as mcp_<serverId>_<toolName> — copy the EXACT string from the list. Never use a skill name from RELEVANT SKILLS as the "tool" value; skills are instructions only.
WRONG: {"accion":"ejecutar","herramienta":"vm_stat","entrada":{}}
RIGHT: {"action":"tool","tool":"execute_command","input":{"command":"vm_stat"}}

Valid examples:
{"action":"tool","tool":"execute_command","input":{"command":"ls /path/to/folder"}}
{"action":"tool","tool":"execute_command","input":{"command":"vm_stat"}}
{"action":"tool","tool":"execute_command","input":{"command":"df -h"}}
{"action":"tool","tool":"execute_command","input":{"command":"sw_vers"}}
{"action":"tool","tool":"web_search","input":{"query":"search terms"}}
{"action":"tool","tool":"read_file","input":{"path":"/path/to/file.txt"}}
{"action":"tool","tool":"remember","input":{"userId":"${input.userId}","key":"key_name","value":"value"}}

${toolUsageRule}

TOOL SELECTION — CRITICAL:
- List / show folder contents → execute_command with "ls /the/folder/path"
- Read a FILE → read_file (ONLY for files, NEVER for folders/directories)
- Search the internet for information → web_search
- Call an HTTP/API endpoint when user provides a URL → execute_command with curl
  Example: {"action":"tool","tool":"execute_command","input":{"command":"curl -s 'https://api.example.com/data'"}}
- Query current system state (RAM, disk, processes, OS version, CPU) → execute_command
  Useful commands: "vm_stat" (RAM), "df -h" (disk), "sw_vers" (macOS version), "top -l 1 -n 5" (processes)
- External APIs / third-party services (when an mcp_… tool is listed) → use that exact tool name and input schema from the list
- Run any other shell command → execute_command
- NEVER use web_search when the user provides an explicit URL — use execute_command + curl instead

RULES:
- NEVER use read_file on a folder/directory — it will fail. Use execute_command + ls instead.
- Never invent file contents — use read_file
- Never invent search results — use web_search
- Never invent system metrics (RAM, disk, processes) — always run the command with execute_command
- One tool call per response, no extra fields in the JSON input
- web_search input must be ONLY: {"query": "search terms"} — nothing else

${input.userLanguage && input.userLanguage !== 'es'
  ? `CRITICAL: Respond in ${input.userLanguage.toUpperCase()}. NOT in Spanish. NOT in any other language.`
  : 'Respond in Spanish (es).'}
If responding with plain text (no tool), write in this language.`;

      const messages: Message[] = [
        ...input.history,
        { role: 'user', content: input.message },
      ];

      // Primera llamada: el modelo decide y genera el input de tool en un solo paso
      let firstResponse;
      const fastThinkStart = Date.now();
      try {
        firstResponse = await this.withTimeout(
          this.baseProvider.complete({
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
            temperature: 0.3,
            maxTokens: 384,
          }),
          180_000,
          'SIMPLE first call'
        );
      } catch (err) {
        this.log.error('[AmplifierLoop] SIMPLE path - primera llamada falló:', err);
        recordStageMetric(stageMetrics, 'think', Date.now() - fastThinkStart, false);
        throw err;
      }
      recordStageMetric(stageMetrics, 'think', Date.now() - fastThinkStart, true);

      const rawContent = (firstResponse.content ?? '').trim();
      this.log.info('[AmplifierLoop] SIMPLE path - primera respuesta:', rawContent.substring(0, 150));

      let finalContent = rawContent;

      // Normalizar el formato de respuesta antes de parsear.
      // Algunos modelos pequeños emiten "toolname{...}" en vez de {"action":"tool","tool":"toolname","input":{...}}
      // También puede haber múltiples tool calls concatenados — tomar solo el primero.
      let normalizedContent = rawContent;
      if (!rawContent.startsWith('{')) {
        // Intentar detectar formato "toolname{json}" → {"action":"tool","tool":"toolname","input":{json}}
        const toolnamePattern = rawContent.match(/^(\w+)\s*(\{[\s\S]+)/);
        if (toolnamePattern) {
          const possibleTool = toolnamePattern[1].toLowerCase();
          const jsonPart = toolnamePattern[2];
          // Extraer solo el primer objeto JSON balanceado
          let depth = 0, end = -1, inStr = false, esc = false;
          for (let i = 0; i < jsonPart.length; i++) {
            const ch = jsonPart[i];
            if (esc) { esc = false; continue; }
            if (ch === '\\' && inStr) { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
          }
          if (end !== -1) {
            const argsJson = jsonPart.slice(0, end + 1);
            normalizedContent = `{"action":"tool","tool":"${possibleTool}","input":${argsJson}}`;
            this.log.info(`[AmplifierLoop] SIMPLE path - formato normalizado: ${normalizedContent.substring(0, 100)}`);
          }
        }

        // Si el modelo mezcló texto + JSON, extraer el primer JSON embebido para ejecutarlo.
        if (!normalizedContent.startsWith('{')) {
          const embeddedJson = extractFirstJsonObject(rawContent);
          if (embeddedJson) {
            normalizedContent = embeddedJson;
            this.log.info('[AmplifierLoop] SIMPLE path - JSON embebido detectado y extraído');
          }
        }

        // Fallback: si el modelo devolvió un comando de shell como texto plano (sin JSON),
        // auto-envolverlo como execute_command
        if (!normalizedContent.startsWith('{')) {
          const shellCmdPattern = /^(ls|df|du|ps|top|sw_vers|vm_stat|uname|which|find|cat|mkdir|mv|cp|curl|wget|git|npm|pip|brew|open|echo|pwd|env|printenv)\s/i;
          if (shellCmdPattern.test(rawContent.trim())) {
            normalizedContent = JSON.stringify({
              action: 'tool',
              tool: 'execute_command',
              input: { command: rawContent.trim() },
            });
            this.log.info('[AmplifierLoop] SIMPLE path - comando shell detectado, auto-wrapped como execute_command');
          }
        }
      }

      // Si el modelo respondió con JSON de herramienta, ejecutarla
      if (normalizedContent.startsWith('{')) {
        try {
          const parsedResult = parseFirstJsonObject<any>(normalizedContent, { tryRepair: true });
          if (!parsedResult) {
            const repairedCandidate = repairJsonString(normalizedContent);
            const repairedResult = parseFirstJsonObject<any>(repairedCandidate, { tryRepair: true });
            if (!repairedResult) {
              throw new Error('JSON inválido incluso después de reparación');
            }
            this.log.info('[AmplifierLoop] SIMPLE path - JSON reparado exitosamente');
          }
          const parsed = (parsedResult ?? parseFirstJsonObject<any>(repairJsonString(normalizedContent), { tryRepair: true }))!.value;
          let { toolName, toolInput } = normalizeFastPathToolCall(parsed, this.executableTools);

          let resolved =
            toolName && toolName !== 'none'
              ? resolveFastPathToolForExecution(toolName, mergedToolDefs, this.executableTools)
              : null;

          if (resolved) {
              let execName = resolved.name;

              const validationError = validateToolInput(execName, toolInput, this.executableTools, this.mcpRegistry);
              if (validationError) {
                this.log.warn(`[AmplifierLoop] SIMPLE path - invalid tool input: ${validationError}`);
                const correctedCall = await this.requestToolInputCorrection(
                  input.message,
                  execName,
                  toolInput,
                  validationError
                ).catch((error) => {
                  this.log.warn('[AmplifierLoop] SIMPLE path - tool correction failed:', error);
                  return null;
                });
                if (correctedCall) {
                  toolName = correctedCall.toolName;
                  toolInput = correctedCall.toolInput;
                  resolved = resolveFastPathToolForExecution(toolName, mergedToolDefs, this.executableTools);
                  if (!resolved) {
                    finalContent = `No se pudo resolver la herramienta tras la corrección: ${toolName}`;
                    this.log.warn(`[AmplifierLoop] SIMPLE path - unresolved after correction: ${toolName}`);
                  } else {
                    execName = resolved.name;
                    this.log.info(`[AmplifierLoop] SIMPLE path - corrected tool input for "${execName}"`);
                  }
                }
              }

              if (resolved) {
              const validationAfterCorrection = validateToolInput(execName, toolInput, this.executableTools, this.mcpRegistry);
              if (validationAfterCorrection) {
                finalContent = `Tool input validation failed: ${validationAfterCorrection}`;
                this.log.warn(`[AmplifierLoop] SIMPLE path - ${validationAfterCorrection}`);
              } else {
                toolsUsed.add(execName);
                this.log.info(
                  `[AmplifierLoop] SIMPLE path - ejecutando "${execName}" (${resolved.kind}):`,
                  toolInput
                );

                let rawToolOutput = '';
                let setupError: string | undefined;

                const actStart = Date.now();
                if (resolved.kind === 'internal') {
                  const tool = this.executableTools.find((t) => t.name === execName);
                  if (!tool) {
                    setupError = `Herramienta interna no encontrada: ${execName}`;
                  } else {
                    const result = await tool.execute(toolInput);
                    rawToolOutput = extractToolOutput(result, { maxChars: 3000 });
                    if (execName === 'web_search' && result.success) {
                      const formatted = formatSearchResults(result.data as any, 'full');
                      if (formatted) rawToolOutput = formatted;
                    }
                  }
                } else if (this.mcpRegistry) {
                  try {
                    rawToolOutput = await this.mcpRegistry.callTool(execName, toolInput);
                  } catch (mcpErr) {
                    const normalizedMcpError = normalizeError(mcpErr, 'mcp');
                    rawToolOutput = `Error [${normalizedMcpError.code}]: ${normalizedMcpError.technicalMessage}`;
                  }
                } else {
                  setupError = 'MCP no está disponible en este entorno.';
                }
                recordStageMetric(stageMetrics, 'act', Date.now() - actStart, !setupError && !rawToolOutput.toLowerCase().startsWith('error'));

                if (setupError) {
                  finalContent = setupError;
                } else {
                const toolOutput = rawToolOutput;

                this.log.info('[AmplifierLoop] SIMPLE path - resultado tool (preview):', toolOutput.substring(0, 200));

                if (resolved.kind === 'internal' && shouldReturnRawToolOutput(execName, input.message, toolOutput)) {
                  finalContent = toolOutput;
                  this.log.info('[AmplifierLoop] SIMPLE path - síntesis omitida (output directo)');
                } else {
                  const synthesisPrompt = `${buildAssistantIdentityPrompt(input)}
${relevantSkillsSection}
${requiredTemplateSection}
You executed a tool and got this result:

TOOL: ${execName}
RESULTADO REAL DE EJECUCIÓN (no inventar, no agregar información):
${toolOutput}

Write a response to the user based on this real result.
Do NOT invent or add information not present in the result.
Do NOT explain the internal process or mention tools.
If REQUIRED OUTPUT TEMPLATES are present, you MUST follow one template exactly.
Template rules have higher priority than "natural phrasing".
Do not change labels/order/emoji/sections from the chosen template.
When a required field is missing in the tool result, keep the format and use "N/D" for that field.

${input.userLanguage && input.userLanguage !== 'es'
  ? `CRITICAL: Write your response in ${input.userLanguage.toUpperCase()}. NOT in Spanish.`
  : 'Write your response in Spanish (es).'}`;

                  let synthesisResponse;
                  const synthStart = Date.now();
                  try {
                    synthesisResponse = await this.withTimeout(
                      this.baseProvider.complete({
                        messages: [
                          { role: 'system', content: synthesisPrompt },
                          { role: 'user', content: input.message },
                        ],
                        temperature: 0.7,
                        maxTokens: 512,
                      }),
                      180_000,
                      'SIMPLE synthesis'
                    );
                  } catch (synthErr) {
                    this.log.error('[AmplifierLoop] SIMPLE path - síntesis falló:', synthErr);
                    synthesisResponse = null;
                    recordStageMetric(stageMetrics, 'synthesize', Date.now() - synthStart, false);
                  }
                  if (synthesisResponse) {
                    recordStageMetric(stageMetrics, 'synthesize', Date.now() - synthStart, true);
                  }

                  finalContent = synthesisResponse?.content?.trim()
                    ? synthesisResponse.content.trim()
                    : toolOutput;
                }
                }
              }
              }
          } else if (toolName && toolName !== 'none') {
              this.log.warn(`[AmplifierLoop] SIMPLE path - tool "${toolName}" no encontrada`);
          }
        } catch {
          // No era JSON válido — usar la respuesta directa como texto
          this.log.info('[AmplifierLoop] SIMPLE path - respuesta directa (no JSON)');
        }
      }

      if (!finalContent) {
        this.log.warn('[AmplifierLoop] SIMPLE path - contenido vacío, usando fallback');
        finalContent = 'No pude procesar tu solicitud. ¿Puedes intentarlo de nuevo?';
      }

      this.log.info('[AmplifierLoop] SIMPLE path - respuesta final:', finalContent.substring(0, 100));

      return {
        content: finalContent,
        requestId,
        stepsUsed: steps,
        modelsUsed: Array.from(modelsUsed),
        toolsUsed: Array.from(toolsUsed),
        injectedSkills: Array.from(injectedSkills.values()),
        durationMs: Date.now() - startTime,
        stageMetrics,
        complexityUsed: input.classifiedLevel,
      };
    }

    if (hasMultiStepSkillRequirement && (input.classifiedLevel === ComplexityLevel.SIMPLE || input.classifiedLevel === ComplexityLevel.MODERATE)) {
      this.log.info('[AmplifierLoop] Fast-path disabled due to multi-step skill requirement');
    }

    // DECOMPOSE: Si la tarea es COMPLEX, dividir en subtareas antes del loop
    let subtasks: Subtask[] = [];
    let accumulatedContext = '';

    if (input.classifiedLevel === ComplexityLevel.COMPLEX) {
      this.log.info('[AmplifierLoop] COMPLEX task — decomposing into subtasks');
      
      // Include all available capabilities (including MCP-prefixed tools) in decomposition.
      const toolNames = input.availableTools.map((tool) => tool.name);
      const decomposition = await this.decomposer.decompose(input.message, toolNames, input.history);
      subtasks = decomposition.steps;

      this.log.info(`[AmplifierLoop] Executing ${subtasks.length} subtask(s) sequentially`);

      // Ejecutar cada subtarea secuencialmente
      for (const subtask of subtasks) {
        this.log.info(`[AmplifierLoop] Subtask ${subtask.id}/${subtasks.length}: ${subtask.tool} — ${subtask.description}`);

        // DIRECT EXECUTION: Si la subtarea tiene dependencia Y una tool definida por el Decomposer,
        // ejecutar directamente sin loop ReAct — el modelo solo genera el contenido
        if (subtask.dependsOn !== null && subtask.tool !== 'none' && accumulatedContext) {
          const tool = this.executableTools.find(t => t.name === subtask.tool);

          if (tool) {
            this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Direct execution of "${subtask.tool}"`);

            // Para write_file: el modelo genera el contenido, nosotros ejecutamos la tool
            if (subtask.tool === 'write_file') {
              const originalMsg = input.originalMessage ?? input.message;
              let filePath = extractFilePath(originalMsg) ?? 'output.md';
              const ext = path.extname(filePath).toLowerCase();
              const textLikeExtensions = new Set(['.txt', '.md', '.json', '.csv', '.log', '.ts', '.js', '.py']);
              if (ext && !textLikeExtensions.has(ext)) {
                const parsed = path.parse(filePath);
                filePath = path.join(parsed.dir || '.', `${parsed.name}_summary.md`);
                this.log.warn(
                  `[AmplifierLoop] write_file target "${parsed.base}" is not text-friendly. Redirecting summary output to "${filePath}"`
                );
              }

              this.log.info(`[AmplifierLoop] Target file path: ${filePath}`);

              // Pedir al modelo que genere SOLO el contenido del archivo
              const contentPrompt = `Based on the following information, write a concise markdown summary.
Output ONLY the markdown content — no explanations, no preamble, no code blocks.
Start directly with the content.

INFORMATION:
${accumulatedContext}`;

              let fileContent = '';
              try {
                const contentResponse = await this.withTimeout(
                  this.baseProvider.complete({
                    messages: [
                      { role: 'system', content: contentPrompt },
                      { role: 'user', content: `Write the content for ${filePath}` },
                    ],
                    temperature: 0.5,
                    maxTokens: 1024,
                  }),
                  180_000,
                  'write_file content generation'
                );
                fileContent = contentResponse.content?.trim() ?? '';
              } catch (err) {
                this.log.error('[AmplifierLoop] Failed to generate file content:', err);
                fileContent = accumulatedContext; // Fallback: usar contexto crudo
              }

              // Ejecutar write_file directamente
              try {
                const directInput = { path: filePath, content: fileContent };
                const validationError = validateToolInput('write_file', directInput, this.executableTools, this.mcpRegistry);
                if (validationError) {
                  throw new Error(validationError);
                }
                const result = await tool.execute(directInput);
                const output = result.success
                  ? `File created successfully at ${filePath}`
                  : `Error: ${result.error}`;

                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - write_file result:`, output);
                toolsUsed.add('write_file');
                accumulatedContext += `\n\nStep ${subtask.id} (write_file): ${output}\nFile path: ${filePath}`;

                steps.push({
                  iteration,
                  type: 'act',
                  requestId,
                  action: 'tool',
                  target: 'write_file',
                  input: JSON.stringify({ path: filePath }),
                  output,
                  status: output.toLowerCase().includes('error') ? 'error' : 'ok',
                  modelUsed: this.baseProvider.model,
                });
              } catch (err) {
                this.log.error('[AmplifierLoop] write_file execution failed:', err);
              }

              continue; // Siguiente subtarea
            }

            // Para execute_command con dependencia: varios modos según lo que pidió el usuario
            else if (subtask.tool === 'execute_command') {
              const originalMsg = input.originalMessage ?? input.message;

              // FAST PATH: si el Decomposer generó un comando shell concreto (mv, mkdir, cp...)
              // simplemente ejecutarlo — no pasar por FileOrganizationService
              const concreteShellPattern = /^(mv|mkdir|cp|rsync|ln|rm)\s/i;
              if (concreteShellPattern.test(subtask.input.trim())) {
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Concrete shell command, running directly`);
                let output = '';
                try {
                  const directInput = { command: subtask.input.trim() };
                  const validationError = validateToolInput('execute_command', directInput, this.executableTools, this.mcpRegistry);
                  if (validationError) {
                    throw new Error(validationError);
                  }
                  const result = await tool.execute(directInput);
                  const stdout = (result.data as any)?.stdout ?? '';
                  // For mv/mkdir commands stdout is empty on success — build a meaningful message
                  if (result.success) {
                    output = stdout.trim() || `success`;
                  } else {
                    output = `Error: ${result.error}`;
                  }
                } catch (err) {
                  output = `Error: ${err}`;
                }
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - result:`, output.substring(0, 200));
                toolsUsed.add('execute_command');
                accumulatedContext += `\n\nStep ${subtask.id} (execute_command): ${output}`;
                steps.push({
                  iteration,
                  type: 'act',
                  requestId,
                  action: 'tool',
                  target: 'execute_command',
                  input: JSON.stringify({ command: subtask.input.trim() }),
                  output,
                  status: output.toLowerCase().includes('error') ? 'error' : 'ok',
                  modelUsed: this.baseProvider.model,
                });
                continue;
              }

              // ORGANIZE PATH: FileOrganizationService
              // Guard: skip if step 1 failed or returned no usable file list
              const lsOutputLooksValid = accumulatedContext.trim().length > 0 &&
                !accumulatedContext.toLowerCase().includes('no such file or directory') &&
                !accumulatedContext.toLowerCase().startsWith('error:');

              if (!lsOutputLooksValid) {
                this.log.warn(`[AmplifierLoop] Subtask ${subtask.id} - Skipping: step 1 produced no valid ls output`);
                continue;
              }

              if (!this.fileOrgService) {
                this.log.warn(
                  `[AmplifierLoop] Subtask ${subtask.id} - Skipping organize path (file organization disabled)`
                );
                continue;
              }

              // Extract SOURCE directory from step 1's ls command, NOT from user message.
              // The user message may contain the destination path, which would be wrong as source.
              const step1 = subtasks.find(s => s.id === subtask.dependsOn);
              const lsMatch = step1?.input?.match(/ls\s+"?(\/[^\s"]+)"?/);
              const sourceDir = lsMatch?.[1] ?? extractTargetDir(originalMsg, input.history);

              if (!sourceDir) {
                this.log.warn(`[AmplifierLoop] Subtask ${subtask.id} - Could not extract source directory`);
                continue;
              }

              const files = this.fileOrgService.extractFilenames(accumulatedContext);

              if (files.length === 0) {
                this.log.warn(`[AmplifierLoop] Subtask ${subtask.id} - No files to organize`);
                continue;
              }

              const namedFolder = this.fileOrgService.detectNamedFolder(originalMsg);

              // Detect targeted move: message contains an explicit destination path that is different
              // from the source (e.g., "move files from /Downloads to /Downloads/Clases")
              const allPaths = (originalMsg.match(/(\/[^\s'"(),]+)/g) ?? [])
                .map(p => p.replace(/[?!,;:.]+$/, '').replace(/\/$/, ''));
              const destPath = allPaths
                .filter(p => p !== sourceDir)
                .sort((a, b) => b.length - a.length)[0] ?? null;
              const isTargetedMove = destPath !== null && destPath.startsWith('/') && destPath !== sourceDir;

              let shellCommand: string;
              let output: string;
              let groups: Record<string, string[]> = {};

              if (namedFolder) {
                // MODE 1: move everything into a single named folder within sourceDir
                const destFolder = `${sourceDir}/${namedFolder}`;
                shellCommand = this.fileOrgService.buildNamedFolderCommand(files, sourceDir, namedFolder);
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Move-to-named-folder: ${files.length} items → "${destFolder}"`);
                try {
                  const validationError = validateToolInput('execute_command', { command: shellCommand }, this.executableTools, this.mcpRegistry);
                  if (validationError) {
                    throw new Error(validationError);
                  }
                  const result = await tool.execute({ command: shellCommand });
                  output = result.success
                    ? `Moved ${files.filter(f => f !== namedFolder).length} item(s) to ${destFolder}`
                    : `Error: ${result.error}`;
                } catch (err) {
                  output = `Error: ${err}`;
                }
              } else if (isTargetedMove && destPath) {
                // MODE 2: targeted move — user specified an explicit destination directory
                // Move only the files that exist in the ls output (skip existing subdirs matching destPath basename)
                const destBasename = destPath.split('/').pop() ?? '';
                const filesToMove = files
                  .filter(f => f !== destBasename) // don't move the destination folder itself
                  .map(f => `"${sourceDir}/${f.replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`)
                  .join(' ');
                shellCommand = filesToMove.length > 0
                  ? `mkdir -p "${destPath}" && mv ${filesToMove} "${destPath}/"`
                  : `mkdir -p "${destPath}"`;
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Targeted move: ${files.length} items → "${destPath}"`);
                try {
                  const validationError = validateToolInput('execute_command', { command: shellCommand }, this.executableTools, this.mcpRegistry);
                  if (validationError) {
                    throw new Error(validationError);
                  }
                  const result = await tool.execute({ command: shellCommand });
                  output = result.success
                    ? `Moved ${files.filter(f => f !== destBasename).length} item(s) to ${destPath}`
                    : `Error: ${result.error}`;
                } catch (err) {
                  output = `Error: ${err}`;
                }
              } else {
                // MODE 3: semantic categorization via LLM
                const mapping = await this.fileOrgService.categorizeFiles(files);
                const built = this.fileOrgService.buildSemanticOrganizeCommand(mapping, sourceDir);
                shellCommand = built.command;
                groups = built.groups;
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Organize (${files.length} files → ${Object.keys(groups).length} folders):`, shellCommand.substring(0, 400));
                try {
                  const validationError = validateToolInput('execute_command', { command: shellCommand }, this.executableTools, this.mcpRegistry);
                  if (validationError) {
                    throw new Error(validationError);
                  }
                  const result = await tool.execute({ command: shellCommand });
                  const folderList = Object.keys(groups).join(', ');
                  output = result.success
                    ? `Organized ${files.length} items into ${Object.keys(groups).length} folders: ${folderList}`
                    : `Error: ${result.error}`;
                } catch (err) {
                  output = `Error: ${err}`;
                }
              }

              this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - result:`, output);
              toolsUsed.add('execute_command');
              accumulatedContext += `\n\nStep ${subtask.id} (execute_command): ${output}`;
              steps.push({
                iteration,
                type: 'act',
                requestId,
                action: 'tool',
                target: 'execute_command',
                input: JSON.stringify({ command: shellCommand }),
                output,
                status: output.toLowerCase().includes('error') ? 'error' : 'ok',
                modelUsed: this.baseProvider.model,
              });

              continue; // Siguiente subtarea
            }
          }
        }

        // DIRECT EXECUTION for execute_command without dependsOn:
        // Use the command from Decomposer directly — avoids ReAct loop hallucinating wrong paths
        // Note: use == null (not ===) to catch both null and undefined (Decomposer may omit the field)
        if (subtask.dependsOn == null && subtask.tool === 'execute_command') {
          const ecTool = this.executableTools.find(t => t.name === 'execute_command');
          if (ecTool && subtask.input) {
            // Guard: si el Decomposer puso solo una ruta como input (en vez de un comando),
            // convertirlo automáticamente a "ls /ruta"
            let command = subtask.input.trim();
            if (command.startsWith('/') && !command.includes(' ')) {
              this.log.warn(`[AmplifierLoop] Subtask ${subtask.id} - input looks like a path, converting to "ls ${command}"`);
              command = `ls "${command}"`;
            }
            this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Direct execute_command: ${command}`);
            try {
              const directInput = { command };
              const validationError = validateToolInput('execute_command', directInput, this.executableTools, this.mcpRegistry);
              if (validationError) {
                throw new Error(validationError);
              }
              const result = await ecTool.execute(directInput);
              const output = result.success
                ? ((result.data as any)?.stdout ?? JSON.stringify(result.data))
                : `Error: ${result.error}`;

              toolsUsed.add('execute_command');
              // Append to accumulatedContext (don't overwrite — previous steps may have context)
              accumulatedContext += (accumulatedContext ? '\n\n' : '') + output;
              steps.push({
                iteration,
                type: 'act',
                requestId,
                action: 'tool',
                target: 'execute_command',
                input: JSON.stringify({ command: subtask.input }),
                output,
                status: output.toLowerCase().includes('error') ? 'error' : 'ok',
                modelUsed: this.baseProvider.model,
              });
              this.log.info(`[AmplifierLoop] Subtask ${subtask.id} completed (direct). ls output: ${output.substring(0, 200)}`);
            } catch (err) {
              this.log.error('[AmplifierLoop] Direct execute_command failed:', err);
            }
            continue; // Skip ReAct loop
          }
        }

        // Direct execution for web_search without dependsOn — avoids ReAct overhead
        if (subtask.dependsOn == null && subtask.tool === 'web_search') {
          const wsTool = this.executableTools.find(t => t.name === 'web_search');
          if (wsTool && subtask.input) {
            this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Direct web_search: "${subtask.input}"`);
            try {
              const directInput = { query: subtask.input };
              const validationError = validateToolInput('web_search', directInput, this.executableTools, this.mcpRegistry);
              if (validationError) {
                throw new Error(validationError);
              }
              const result = await wsTool.execute(directInput);
              if (result.success) {
                const wsOutput = formatSearchResults(result.data as any, 'compact') || JSON.stringify(result.data);
                toolsUsed.add('web_search');
                accumulatedContext += (accumulatedContext ? '\n\n' : '') + wsOutput;
                steps.push({
                  iteration,
                  type: 'act',
                  requestId,
                  action: 'tool',
                  target: 'web_search',
                  input: JSON.stringify({ query: subtask.input }),
                  output: wsOutput,
                  status: 'ok',
                  modelUsed: this.baseProvider.model,
                });
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} completed (direct web_search)`);
              } else {
                this.log.error('[AmplifierLoop] Direct web_search failed:', result.error);
              }
            } catch (err) {
              this.log.error('[AmplifierLoop] Direct web_search threw:', err);
            }
            continue; // Skip ReAct loop
          }
        }

        // REACT LOOP: Para subtareas sin dependencia o sin tool definida
        // Construir el mensaje para esta subtarea específica
        let subtaskMessage: string;

        if (subtask.dependsOn !== null && accumulatedContext) {
          // Esta subtarea depende de una anterior — incluir resultado previo explícitamente
          subtaskMessage = `TASK: ${subtask.description}

IMPORTANT: Use the following information from the previous step as the content:
---
${accumulatedContext}
---

Your job is ONLY to execute this task using the information above.
Do NOT search for more information. Use what is provided.`;
        } else {
          subtaskMessage = subtask.description;
        }

        const forcedTool = subtask.tool && subtask.tool !== 'none'
          ? input.availableTools.find((tool) => tool.name === subtask.tool)
          : undefined;

        // Crear un input modificado para esta subtarea
        const subtaskInput: AmplifierInput = {
          ...input,
          message: subtaskMessage,
          availableTools: forcedTool ? [forcedTool] : input.availableTools,
          // When decomposition already selected a concrete tool, avoid skill/agent drift in the sub-loop.
          availableSkills: forcedTool ? [] : input.availableSkills,
          availableAgents: forcedTool ? [] : input.availableAgents,
          classifiedLevel: ComplexityLevel.MODERATE, // Cada subtarea es MODERATE
        };

        // Ejecutar el loop de ReAct para esta subtarea (máximo 4 iteraciones por subtarea)
        let subtaskIteration = 0;
        const subtaskMaxIterations = 4;
        let subtaskDone = false;
        let subtaskResult = '';

        while (subtaskIteration < subtaskMaxIterations && !subtaskDone) {
          subtaskIteration++;
          const subtaskResolvedSkills = forcedTool
            ? []
            : this.skillRegistry
            ? await this.skillResolver.resolveRelevantSkills(subtaskInput.message, this.skillRegistry)
            : preResolvedSkills;
          rememberInjectedSkills(subtaskResolvedSkills);

          const subThinkStart = Date.now();
          const thinkStep = await this.think(
            subtaskInput,
            accumulatedContext,
            subtaskIteration,
            modelsUsed,
            steps,
            undefined,
            subtaskResolvedSkills
          );
          recordStageMetric(stageMetrics, 'think', Date.now() - subThinkStart, true);
          steps.push(thinkStep);
          input.onProgress?.(thinkStep);

          this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Think:`, thinkStep.output?.substring(0, 150));

          const capabilities: AvailableCapabilities = {
            tools: subtaskInput.availableTools,
            skills: subtaskInput.availableSkills,
            agents: subtaskInput.availableAgents,
          };

          const resolvedAction = await this.capabilityResolver.resolve(
            thinkStep.output ?? '',
            capabilities
          );

          this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Action:`, resolvedAction.type, resolvedAction.target);

          if (resolvedAction.type === 'none') {
            subtaskDone = true;
            subtaskResult = thinkStep.output ?? '';
            break;
          }

          const subActStart = Date.now();
          const actStep = await this.act(resolvedAction, subtaskIteration, modelsUsed, toolsUsed, input.userId, requestId);
          recordStageMetric(stageMetrics, 'act', Date.now() - subActStart, !(actStep.output || '').toLowerCase().includes('error'));
          steps.push(actStep);
          input.onProgress?.(actStep);

          const subObserveStart = Date.now();
          const observeStep = this.observe(actStep, subtaskIteration, requestId);
          recordStageMetric(stageMetrics, 'observe', Date.now() - subObserveStart, true);
          steps.push(observeStep);
          input.onProgress?.(observeStep);

          subtaskResult = observeStep.output ?? '';

          // Si la tool se ejecutó exitosamente, la subtarea está completa
          if (actStep.output && !actStep.output.includes('failed') && !actStep.output.includes('Error')) {
            subtaskDone = true;
          }
        }

        // Acumular resultado de esta subtarea para la siguiente
        if (subtaskResult) {
          accumulatedContext += `\n\nStep ${subtask.id} (${subtask.tool}): ${subtaskResult}`;
          this.log.info(`[AmplifierLoop] Subtask ${subtask.id} completed. Context size: ${accumulatedContext.length} chars`);
        }
      }

      // Sintetizar todos los resultados acumulados
      this.log.info('[AmplifierLoop] All subtasks completed — synthesizing final response');

      // Skip LLM synthesis when only execute_command was used:
      // small models hallucinate "I can't manipulate files" even when commands succeeded.
      // Instead, extract the last step result from accumulatedContext and return it directly.
      const onlyExecuteCommands = toolsUsed.size > 0 && [...toolsUsed].every(t => t === 'execute_command');
      if (onlyExecuteCommands) {
        // Extract the last Step N output from accumulatedContext
        const stepLines = accumulatedContext.match(/Step \d+ \(execute_command\): ([\s\S]*?)(?=\n\nStep \d+|$)/g) ?? [];
        const lastStepOutput = stepLines.length > 0
          ? (stepLines[stepLines.length - 1].replace(/^Step \d+ \(execute_command\): /, '').trim())
          : accumulatedContext.trim();
        const hasError =
          shellOutputIndicatesFailure(lastStepOutput) || shellOutputIndicatesFailure(accumulatedContext);
        const hasPlaceholder =
          textContainsPlaceholderPath(lastStepOutput) || textContainsPlaceholderPath(accumulatedContext);
        const lang = input.userLanguage ?? 'en';
        const shouldReturnRaw = shouldReturnRawToolOutput('execute_command', input.message, lastStepOutput);
        if (!hasError && !hasPlaceholder) {
          const directContent = shouldReturnRaw
            ? lastStepOutput
            : (lang === 'es' ? `Listo, operación completada.` : `Done, operation completed.`);
          this.log.info('[AmplifierLoop] Skipping synthesis (execute_command only) — direct response');
          return {
            content: directContent,
            requestId,
            stepsUsed: steps,
            modelsUsed: Array.from(modelsUsed),
            toolsUsed: Array.from(toolsUsed),
            injectedSkills: Array.from(injectedSkills.values()),
            durationMs: Date.now() - startTime,
            stageMetrics,
            complexityUsed: ComplexityLevel.COMPLEX,
          };
        }
        this.log.info(
          '[AmplifierLoop] execute_command-only path had failure or placeholder — synthesizing user-facing explanation'
        );
      }

      const complexSynthStart = Date.now();
      const synthesizeStep = await this.synthesize(
        input,
        accumulatedContext,
        iteration,
        modelsUsed,
        preResolvedSkills
      );
      recordStageMetric(stageMetrics, 'synthesize', Date.now() - complexSynthStart, true);
      steps.push(synthesizeStep);

      return {
        content: synthesizeStep.output ?? accumulatedContext,
        requestId,
        stepsUsed: steps,
        modelsUsed: Array.from(modelsUsed),
        toolsUsed: Array.from(toolsUsed),
        injectedSkills: Array.from(injectedSkills.values()),
        durationMs: Date.now() - startTime,
        stageMetrics,
        complexityUsed: ComplexityLevel.COMPLEX,
      };
    }

    let forcedToolRetryCount = 0;
    let consecutiveAlgorithmToolErrors = 0;
    while (iteration < this.maxIterations && !hasEnoughInfo) {
      iteration++;

      // THINK: modelo base analiza qué necesita
      const thinkStart = Date.now();
      const thinkStep = await this.think(
        input,
        currentContext,
        iteration,
        modelsUsed,
        steps,
        undefined,
        preResolvedSkills
      );
      recordStageMetric(stageMetrics, 'think', Date.now() - thinkStart, true);
      steps.push(thinkStep);
      input.onProgress?.(thinkStep);

      this.log.info(`[AmplifierLoop] Iteration ${iteration} - Think output:`, thinkStep.output?.substring(0, 200));

      // ACT: ejecuta lo que necesita
      const capabilities: AvailableCapabilities = {
        tools: input.availableTools,
        skills: input.availableSkills,
        agents: input.availableAgents,
      };

      let resolvedAction = await this.capabilityResolver.resolve(
        thinkStep.output || '',
        capabilities
      );

      this.log.info(`[AmplifierLoop] Iteration ${iteration} - Resolved action:`, {
        type: resolvedAction.type,
        target: resolvedAction.target,
        reason: resolvedAction.reason
      });

      // Bloquear "none" mientras no se hayan completado todos los pasos requeridos por el skill.
      // Contamos solo acciones de tipo tool; ejecutar una "skill" no equivale a completar un paso.
      const stepsExecutedCount = steps.filter(s => s.type === 'act' && s.action === 'tool').length;
      const mustUseToolNow = hasMultiStepSkillRequirement && stepsExecutedCount < minRequiredSteps;
      const weatherSkillActive = preResolvedSkills.some(
        (skill) => (skill.name ?? '').toLowerCase() === 'weather'
      );

      // Guardrail: for weather multi-step, enforce canonical commands for step 1/2.
      // This avoids malformed curl generations (wrong query param, missing URL, placeholders).
      if (weatherSkillActive && resolvedAction.type === 'tool' && resolvedAction.target === 'execute_command') {
        if (stepsExecutedCount === 0) {
          const location = extractWeatherLocation(input.message);
          if (location) {
            resolvedAction = {
              ...resolvedAction,
              input: { command: buildWeatherGeocodingCommand(location) },
              reason: `${resolvedAction.reason} (normalized weather step 1 command)`,
            };
            this.log.info(`[AmplifierLoop] Iteration ${iteration} - normalized weather step 1 command for "${location}"`);
          }
        } else if (stepsExecutedCount === 1) {
          const coords = extractWeatherCoordsFromSteps(steps);
          if (coords) {
            resolvedAction = {
              ...resolvedAction,
              input: { command: buildWeatherForecastCommand(coords.latitude, coords.longitude) },
              reason: `${resolvedAction.reason} (normalized weather step 2 command)`,
            };
            this.log.info(
              `[AmplifierLoop] Iteration ${iteration} - normalized weather step 2 command (${coords.latitude}, ${coords.longitude})`
            );
          }
        }
      }
      if (resolvedAction.type === 'none' && mustUseToolNow) {
        this.log.warn(
          `[AmplifierLoop] Iteration ${iteration} - resolvedAction=none but only ${stepsExecutedCount}/${minRequiredSteps} steps done; retrying THINK`
        );

        const fallbackAction = await this.capabilityResolver.resolve(input.message, capabilities);
        const isKnownTool = fallbackAction.type === 'tool'
          && capabilities.tools.some((tool) => tool.name === fallbackAction.target);
        if (isKnownTool) {
          resolvedAction = fallbackAction;
          this.log.info(`[AmplifierLoop] Iteration ${iteration} - fallback action selected:`, {
            type: resolvedAction.type,
            target: resolvedAction.target,
            reason: resolvedAction.reason,
          });
        } else if (forcedToolRetryCount < 2) {
          forcedToolRetryCount++;
          currentContext = [
            currentContext,
            'Previous THINK result was invalid for this request because it returned no action.',
            `This request requires a multi-step skill (${stepsExecutedCount}/${minRequiredSteps} completed).`,
            'You MUST return a valid JSON tool call in the next iteration.',
            'Do NOT return {"action":"none"} before all required tool steps are completed.',
            'Do NOT return {"action":"skill"} in this stage.',
          ]
            .filter(Boolean)
            .join('\n');
          this.log.warn('[AmplifierLoop] Forcing one additional THINK retry with stricter context');
          continue;
        } else {
          this.log.warn('[AmplifierLoop] Unable to force valid tool call after retries; ending loop to avoid timeout');
        }
      }

      if (mustUseToolNow && resolvedAction.type !== 'tool') {
        if (forcedToolRetryCount < 2) {
          forcedToolRetryCount++;
          currentContext = [
            currentContext,
            `Invalid action type "${resolvedAction.type}" for multi-step execution (${stepsExecutedCount}/${minRequiredSteps}).`,
            'Only tool actions are valid while the algorithm is in progress.',
            'Return ONLY {"action":"tool","tool":"...","input":{...}}.',
          ]
            .filter(Boolean)
            .join('\n');
          this.log.warn(`[AmplifierLoop] Iteration ${iteration} - non-tool action during multi-step; retrying THINK`);
          continue;
        }
        this.log.warn('[AmplifierLoop] Repeated non-tool actions during multi-step; ending loop to avoid timeout');
        hasEnoughInfo = true;
        break;
      }

      if (resolvedAction.type === 'none') {
        hasEnoughInfo = true;
        break;
      }

      const actStart = Date.now();
      const actStep = await this.act(
        resolvedAction,
        iteration,
        modelsUsed,
        toolsUsed,
        input.userId,
        requestId
      );
      recordStageMetric(stageMetrics, 'act', Date.now() - actStart, !(actStep.output || '').toLowerCase().includes('error'));
      steps.push(actStep);
      input.onProgress?.(actStep);

      // OBSERVE: integra el resultado al contexto
      const observeStart = Date.now();
      const observeStep = this.observe(actStep, iteration, requestId);
      recordStageMetric(stageMetrics, 'observe', Date.now() - observeStart, true);
      steps.push(observeStep);
      this.log.info(`[AmplifierLoop] Iteration ${iteration} - Observe output:`, observeStep.output?.substring(0, 200));

      if (hasMultiStepSkillRequirement && actStep.action === 'tool') {
        const observeText = (observeStep.output ?? '').toLowerCase();
        const hasToolFailure =
          observeText.includes('tool execution failed') ||
          observeText.includes('"error":true') ||
          observeText.includes('tool not found') ||
          observeText.includes('invalid string value') ||
          observeText.includes('cannot initialize float') ||
          observeText.includes('no value found');
        const hasUnresolvedPlaceholder =
          observeText.includes('latitude_placeholder') ||
          observeText.includes('longitude_placeholder') ||
          observeText.includes('latitude_from_step_1') ||
          observeText.includes('longitude_from_step_1');

        if (hasToolFailure || hasUnresolvedPlaceholder) {
          consecutiveAlgorithmToolErrors++;
          this.log.warn(
            `[AmplifierLoop] Algorithm tool error ${consecutiveAlgorithmToolErrors}/2 at iteration ${iteration}`
          );
          if (consecutiveAlgorithmToolErrors >= 2) {
            currentContext = this.contextSynthesizer.compress(steps) +
              '\n\nAlgorithm terminated early due to repeated tool errors. ' +
              'Do not continue looping. Report failure and ask user to retry with city/country.';
            hasEnoughInfo = true;
            break;
          }
        } else {
          consecutiveAlgorithmToolErrors = 0;
        }
      }

      currentContext = this.contextSynthesizer.compress(steps);

      // Fine-tuning: once a multi-step skill completed all required tool steps successfully,
      // stop iterating and move directly to final synthesis.
      if (hasMultiStepSkillRequirement) {
        const executedToolSteps = steps.filter((s) => s.type === 'act' && s.action === 'tool').length;
        if (executedToolSteps >= minRequiredSteps && consecutiveAlgorithmToolErrors === 0) {
          this.log.info(
            `[AmplifierLoop] Multi-step execution complete (${executedToolSteps}/${minRequiredSteps}). Finalizing without extra THINK iteration`
          );
          hasEnoughInfo = true;
          break;
        }
      }

      if (iteration >= this.maxIterations) {
        this.log.warn(
          `[AmplifierLoop] Reached max iterations (${this.maxIterations}), forcing synthesis`
        );
        hasEnoughInfo = true;
      }
    }

    // SYNTHESIZE: modelo base narra la respuesta final
    const finalSynthStart = Date.now();
    const synthesizeStep = await this.synthesize(
      input,
      currentContext,
      iteration + 1,
      modelsUsed,
      preResolvedSkills
    );
    recordStageMetric(stageMetrics, 'synthesize', Date.now() - finalSynthStart, true);
    steps.push(synthesizeStep);
    input.onProgress?.(synthesizeStep);

    return {
      content: synthesizeStep.output || '',
      requestId,
      stepsUsed: steps,
      modelsUsed: Array.from(modelsUsed),
      toolsUsed: Array.from(toolsUsed),
      injectedSkills: Array.from(injectedSkills.values()),
      durationMs: Date.now() - startTime,
      stageMetrics,
      complexityUsed: input.classifiedLevel,
    };
  }

  private async think(
    input: AmplifierInput,
    context: string,
    iteration: number,
    modelsUsed: Set<string>,
    previousSteps: Step[] = [],
    skipSkills?: boolean,
    resolvedSkills?: RelevantSkill[]
  ): Promise<Step> {
    const startTime = Date.now();
    // Build a deduplicated tool list. Orchestrator already merges MCP tools into input.availableTools.
    const mergedTools = [...input.availableTools];
    if (this.mcpRegistry) {
      for (const mcpTool of this.mcpRegistry.getMCPToolsForOrchestrator()) {
        if (!mergedTools.some((tool) => tool.name === mcpTool.name)) {
          mergedTools.push(mcpTool);
        }
      }
    }
    const toolsList = mergedTools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');

    // Detect if we are in mid-execution of a multi-step skill algorithm.
    // When there are previous act steps AND multi-step skills are active, switch to an
    // algorithm-mode prompt that explicitly tells the model which step to execute next.
    const previousActSteps = previousSteps.filter(s => s.type === 'act');
    const previousObservations = previousSteps.filter(s => s.type === 'observe' && s.output);
    const skillsToInjectForThink: RelevantSkill[] = (!skipSkills && this.skillRegistry)
      ? (resolvedSkills ?? await this.skillResolver.resolveRelevantSkills(input.message, this.skillRegistry))
      : [];

    const multiStepSkills = skillsToInjectForThink.filter(skill => {
      if (skill.steps?.length && skill.steps.length >= 2) return true;
      const markers = (skill.content ?? '').match(/\bpaso\s+(\d+)|\bstep\s+(\d+)/gi) ?? [];
      const maxN = markers.reduce((m, s) => Math.max(m, parseInt(s.replace(/\D/g, '')) || 0), 0);
      return maxN >= 2;
    });

    const isAlgorithmMode = multiStepSkills.length > 0;

    let algorithmModeBlock = '';
    if (isAlgorithmMode) {
      const skill = multiStepSkills[0];
      const stepsCompleted = previousActSteps.length;

      // Build step list: prefer structured steps, else extract from content markers
      let stepDescriptions: string[] = [];
      if (skill.steps?.length) {
        stepDescriptions = skill.steps.map((s, i) => `  Step ${i + 1}: ${s.description}${s.tool ? ` [tool: ${s.tool}]` : ''}`);
      } else {
        // Extract "Paso N: ..." lines from content as a fallback
        const pasoLines = (skill.content ?? '')
          .split('\n')
          .filter(l => /^\d+\.\s/.test(l.trim()) || /\bpaso\s+\d+/i.test(l))
          .slice(0, 10)
          .map((l, i) => `  Step ${i + 1}: ${l.trim()}`);
        stepDescriptions = pasoLines.length > 0 ? pasoLines : [`  (see skill algorithm below)`];
      }

      const totalSteps = Math.max(1, skill.steps?.length ?? stepDescriptions.length);
      const nextStepN = Math.min(stepsCompleted + 1, totalSteps);
      const expectedToolForNextStep = skill.steps?.[nextStepN - 1]?.tool;
      const observationSummary = previousObservations
        .map((s, i) => `  Step ${i + 1} result: ${(s.output ?? '').substring(0, 300)}`)
        .join('\n');

      algorithmModeBlock = `
━━━ SKILL ALGORITHM IN PROGRESS: "${skill.name}" ━━━
Total steps required: ${totalSteps}
Steps completed: ${stepsCompleted}/${totalSteps}

Algorithm:
${stepDescriptions.join('\n')}

Results so far:
${observationSummary}

CURRENT TASK: Execute step ${nextStepN} of the algorithm.
${expectedToolForNextStep ? `REQUIRED TOOL FOR THIS STEP: ${expectedToolForNextStep}` : ''}
Return ONLY a JSON tool call for step ${nextStepN}. {"action":"none"} is NOT valid until all ${totalSteps} steps are complete.
Do NOT return conversational text. Do NOT return {"action":"skill"}.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    }

    const systemPrompt = `${buildAssistantIdentityPrompt(input)}
${isAlgorithmMode ? algorithmModeBlock : 'Your task is to decide what action is needed.'}

AVAILABLE TOOLS:
${toolsList}

CRITICAL: To use a tool, respond ONLY with this EXACT JSON format:
{"action":"tool","tool":"TOOL_NAME","input":{"param":"value"}}

The "input" field MUST be a nested object. Never put params at the root level.

CORRECT examples:
{"action":"tool","tool":"execute_command","input":{"command":"ls /path/to/folder"}}
{"action":"tool","tool":"web_search","input":{"query":"search terms"}}
{"action":"tool","tool":"read_file","input":{"path":"/path/to/file.txt"}}
{"action":"tool","tool":"write_file","input":{"path":"/path/to/file.md","content":"File content here"}}
{"action":"tool","tool":"remember","input":{"userId":"${input.userId}","key":"key_name","value":"value"}}

WRONG examples (never do this):
{"action":"execute_command","command":"ls ~/Downloads"}
{"action":"web_search","query":"something"}

${isAlgorithmMode ? '' : `If you already have enough information:
{"action":"none"}

`}ABSOLUTE RULES:
- To CREATE or OVERWRITE a file with content → use write_file (structure: {"path":"...","content":"..."})
- Never invent file contents — use read_file or write based on actual data
- Never invent search results — use web_search
- To list a folder use execute_command with "ls /path/to/folder"
- For file paths, use the paths provided by the user in the message
- One tool call per response
- Never add text outside the JSON
- ALWAYS use absolute paths starting with / — never relative paths like "ls Downloads" or "mkdir documents/"
- Extract the target directory from the user's message and prefix every path with it
- Never invent files or folders — only use what execute_command results actually showed

Iteration: ${iteration}/${this.maxIterations}
${context ? `Context from previous steps:\n${context}` : ''}`;

    // input.history ya contiene el memoryBlock inyectado por Orchestrator — no duplicar
    const messages: Message[] = [
      ...input.history,
      { role: 'user', content: input.message },
    ];

    // Inject skills into THINK context
    const DEBUG = process.env.ENZO_DEBUG === 'true';
    if (DEBUG) this.log.info(`[AmplifierLoop] SkillRegistry available:`, !!this.skillRegistry);
    if (this.skillRegistry) {
      const enabledSkills = this.skillRegistry.getEnabled();
      if (DEBUG) this.log.info(`[AmplifierLoop] Enabled skills count:`, enabledSkills.length);
      enabledSkills.forEach(s => {
        if (DEBUG) this.log.info(`[AmplifierLoop] Skill available: ${s.metadata.name}`);
      });
    }

    if (!skipSkills && skillsToInjectForThink.length > 0) {
      if (DEBUG) this.log.info(`[AmplifierLoop] Relevant skills found:`, skillsToInjectForThink.length);
      skillsToInjectForThink.forEach(s => {
        if (DEBUG) this.log.info(`[AmplifierLoop] Relevant skill: ${s.name} (score: ${(s.relevanceScore * 100).toFixed(0)}%)`);
      });

      for (const skill of skillsToInjectForThink) {
        // En modo algoritmo evitamos inyectar todo el SKILL.md para reducir latencia/contexto.
        const content = isAlgorithmMode && multiStepSkills.some(ms => ms.id === skill.id)
          ? `Skill "${skill.name}" activo en modo algoritmo. Sigue estrictamente el bloque "SKILL ALGORITHM IN PROGRESS".`
          : `Skill "${skill.name}" disponible para esta consulta (relevancia: ${(skill.relevanceScore * 100).toFixed(0)}%):\n\n${skill.content}`;

        messages.push({ role: 'system', content });
        if (DEBUG) this.log.info(
          `[AmplifierLoop] Injected skill "${skill.name}" (relevance: ${(skill.relevanceScore * 100).toFixed(0)}%)${isAlgorithmMode ? ' [algorithm mode]' : ''} into THINK context`
        );
      }
    }

    // Acumular resultados de iteraciones anteriores (solo en modo no-algoritmo; en algoritmo ya están en el system prompt)
    if (!isAlgorithmMode && previousSteps.length > 0) {
      const previousResults = previousObservations
        .map(s => ({
          role: 'assistant' as const,
          content: `Resultado de acción anterior: ${s.output}`,
        }));

      if (previousResults.length > 0) {
        this.log.info(`[AmplifierLoop] Adding ${previousResults.length} previous results to context`);
        this.log.info(`[AmplifierLoop] First result preview:`, previousResults[0].content.substring(0, 150));
      }

      messages.push(...previousResults);
    }

    if (isAlgorithmMode) {
      this.log.info(`[AmplifierLoop] Algorithm mode: step ${previousActSteps.length + 1}/${multiStepSkills[0].steps?.length ?? '?'} of skill "${multiStepSkills[0].name}"`);
    }

    const response = await this.withTimeout(
      this.baseProvider.complete({
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.5,
        maxTokens: 512,
      }),
      180_000,
      'think'
    );

    modelsUsed.add(this.baseProvider.model);

    return {
      iteration,
      type: 'think',
      requestId: input.requestId,
      output: response.content,
      durationMs: Date.now() - startTime,
      status: 'ok',
      modelUsed: this.baseProvider.model,
    };
  }

  private async act(
    resolvedAction: ResolvedAction,
    iteration: number,
    modelsUsed: Set<string>,
    toolsUsed: Set<string>,
    userId?: string,
    requestId?: string
  ): Promise<Step> {
    const startTime = Date.now();
    let output = '';

    try {
      if (resolvedAction.type === 'tool') {
        toolsUsed.add(resolvedAction.target);
        const validationError = validateToolInput(resolvedAction.target, resolvedAction.input, this.executableTools, this.mcpRegistry);
        if (validationError) {
          output = `Error [TOOL_VALIDATION_ERROR]: ${validationError}`;
          return {
            iteration,
            type: 'act',
            requestId,
            action: resolvedAction.type,
            target: resolvedAction.target,
            input: JSON.stringify(resolvedAction.input),
            output,
            durationMs: Date.now() - startTime,
            status: 'error',
            modelUsed: this.baseProvider.model,
          };
        }
        
        // Check if this is an MCP tool
        if (resolvedAction.target.startsWith('mcp_') && this.mcpRegistry) {
          try {
            const result = await this.mcpRegistry.callTool(resolvedAction.target, resolvedAction.input);
            output = `MCP Tool execution successful: ${result}`;
          } catch (err) {
            const normalized = normalizeError(err, 'mcp');
            output = `Error [${normalized.code}]: ${normalized.technicalMessage}`;
          }
        } else {
          // Execute internal tool
          const tool = this.executableTools.find(t => t.name === resolvedAction.target);
          if (tool) {
            // Inject userId for RememberTool if not already present
            const toolInput = resolvedAction.input;
            if (resolvedAction.target === 'remember' && userId && !toolInput.userId) {
              toolInput.userId = userId;
            }
            const result = await tool.execute(toolInput);
            if (!result.success) {
              output = `Error [TOOL_EXECUTION_ERROR]: ${result.error}`;
            } else if (resolvedAction.target === 'web_search') {
              output = formatSearchResults(result.data as any, 'compact') || `Tool execution successful: ${JSON.stringify(result.data)}`;
            } else {
              output = `Tool execution successful: ${JSON.stringify(result.data)}`;
            }
          } else {
            output = `Tool not found: ${resolvedAction.target}`;
          }
        }
      } else if (resolvedAction.type === 'skill') {
        toolsUsed.add(resolvedAction.target);
        if (this.skillRegistry) {
          const skill =
            this.skillRegistry.get(resolvedAction.target) ??
            this.skillRegistry
              .getAll()
              .find((available) => available.metadata.name === resolvedAction.target);
          if (skill) {
            output = `Skill content:\n${skill.content}`;
          } else {
            output = `Skill not found: ${resolvedAction.target}`;
          }
        } else {
          output = `Skill registry not available`;
        }
      } else if (resolvedAction.type === 'agent') {
        toolsUsed.add(resolvedAction.target);
        // Agent selection is applied before AmplifierLoop (runtime provider/profile resolution in Orchestrator).
        // Keep this branch explicit to avoid surfacing a misleading "not implemented" message.
        output = `Agent routing acknowledged for "${resolvedAction.target}". Continuing with active runtime provider.`;
      } else if (resolvedAction.type === 'escalate') {
        output = `Escalating to powerful provider for: ${resolvedAction.input}`;
      } else if (resolvedAction.type === 'mcp') {
        // TODO: Este caso no debería llegar aquí, MCP se maneja como tool con prefijo mcp_
        output = `[MCP manejado como tool, este caso es inesperado]`;
      }
    } catch (error) {
      const normalized = normalizeError(error, 'orchestrator');
      output = `Error [${normalized.code}]: ${normalized.technicalMessage}`;
      this.log.error(`[AmplifierLoop] Action failed at iteration ${iteration}:`, normalized.technicalMessage);
    }

    return {
      iteration,
      type: 'act',
      requestId,
      action: resolvedAction.type,
      target: resolvedAction.target,
      input: JSON.stringify(resolvedAction.input),
      output,
      durationMs: Date.now() - startTime,
      status: output.toLowerCase().includes('error') ? 'error' : 'ok',
      modelUsed: this.baseProvider.model,
    };
  }

  private observe(actStep: Step, iteration: number, requestId?: string): Step {
    return {
      iteration,
      type: 'observe',
      requestId,
      output: actStep.output,
      status: actStep.status ?? 'ok',
      modelUsed: this.baseProvider.model,
    };
  }


  private async synthesize(
    input: AmplifierInput,
    context: string,
    iteration: number,
    modelsUsed: Set<string>,
    resolvedSkills: RelevantSkill[] = []
  ): Promise<Step> {
    const startTime = Date.now();
    const userLanguage = input.userLanguage || 'en';
    const relevantSkillsSection = buildRelevantSkillsSection(resolvedSkills);
    const requiredTemplateSection = extractOutputTemplates(resolvedSkills);
    
    const systemPrompt = `${buildAssistantIdentityPrompt(input)}
${relevantSkillsSection}
${requiredTemplateSection}

${context ? `Tasks completed and results:\n${context}\n` : ''}

Write a response to the user:
- Summarize what you found or did
- If a file was created, ALWAYS mention the exact file path
- If you found information, share the key points briefly
- Be direct — the user wants results, not process descriptions
- If REQUIRED OUTPUT TEMPLATES are present, follow one template exactly (strict precedence)
- If a required template field is missing in the context, keep format and write "N/D"

RESPONSE LANGUAGE: ${userLanguage === 'es' ? 'SPANISH' : userLanguage.toUpperCase()}
Your response MUST be in this language. This is mandatory.
The language of the context does NOT affect the language of your response.`;

    const messages: Message[] = [
      ...input.history.slice(-4),
      { role: 'user', content: input.message },
    ];

    const response = await this.withTimeout(
      this.baseProvider.complete({
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.7,
        maxTokens: 1024,
      }),
      180_000,
      'synthesize'
    );

    modelsUsed.add(this.baseProvider.model);

    return {
      iteration,
      type: 'synthesize',
      requestId: input.requestId,
      output: response.content,
      durationMs: Date.now() - startTime,
      status: 'ok',
      modelUsed: this.baseProvider.model,
    };
  }
}
