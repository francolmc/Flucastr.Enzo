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
  buildToolsPrompt,
  buildRelevantSkillsSection,
  extractOutputTemplates,
} from './AmplifierLoopPromptHelpers.js';
import { describeHostForExecuteCommandPrompt, humanOsLabel } from '../runtimeHostContext.js';
import {
  applyExecutableToolContext,
  extractFirstJsonObject,
  mergeAvailableToolDefinitions,
  normalizeFastPathToolCall,
  resolveFastPathToolForExecution,
  shouldReturnRawToolOutput,
  validateToolInput,
} from './AmplifierLoopFastPathTools.js';
import { runVerifyBeforeSynthesizeIfEnabled } from './AmplifierVerifyPhase.js';
import type { ExecutableTool } from '../../tools/types.js';
import type { SkillRegistry } from '../../skills/SkillRegistry.js';
import type { MCPRegistry } from '../../mcp/index.js';
import type { RelevantSkill } from '../SkillResolver.js';
import type { CapabilityResolver } from '../CapabilityResolver.js';
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

function formatFastPathDateLine(input: AmplifierInput): string {
  const tz = input.runtimeHints?.timeZone ?? 'America/Santiago';
  const locale = input.runtimeHints?.timeLocale ?? 'es-CL';
  try {
    return new Date().toLocaleString(locale, { timeZone: tz });
  } catch {
    return new Date().toISOString();
  }
}

function resolveHomeDir(input: AmplifierInput): string {
  return input.runtimeHints?.homeDir ?? process.env.HOME ?? os.homedir();
}

function resolveOsLabel(input: AmplifierInput): string {
  return input.runtimeHints?.osLabel ?? humanOsLabel();
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
  const relevantSkillsSection = buildRelevantSkillsSection(preResolvedSkills);
  const requiredTemplateSection = extractOutputTemplates(preResolvedSkills);

  const toolUsageRule = isModerate
    ? `You MUST use one of the tools above to answer this request. Do NOT answer from memory.`
    : `If you can answer directly without tools, respond with plain text.`;

  const moderateToolJsonOnly = isModerate
    ? `

CRITICAL: When you need to use a tool, respond with ONLY the JSON object.
No text before, no text after, no explanation.
WRONG: "Ejecutando el comando... {"action":"tool"...}"
RIGHT: {"action":"tool","tool":"execute_command","input":{"command":"ls -la /home/franco"}}

If you include any text outside the JSON, the tool will not execute.
`
    : '';

  const homeDir = resolveHomeDir(input);
  const osLabel = resolveOsLabel(input);
  const dateLine = formatFastPathDateLine(input);

  const systemPrompt = `${buildAssistantIdentityPrompt(input)}

${describeHostForExecuteCommandPrompt(input.runtimeHints)}
Date: ${dateLine}.
OS: ${osLabel}. Home directory: ${homeDir}. ALWAYS use absolute paths (e.g. ${homeDir}/Downloads, NOT /home/user/...).

${toolsPrompt}
${skillListSection}
${relevantSkillsSection}
To use a tool, respond ONLY with JSON (no extra text, no markdown):
{"tool":"TOOL_NAME","input":{PARAMS}}

CRITICAL: "action", "tool", "input" are CODE IDENTIFIERS — NEVER translate them to Spanish or any other language.
Built-in tool names: execute_command, web_search, read_file, write_file, remember.
MCP tools are listed above as mcp_<serverId>_<toolName> — copy the EXACT string from the list. Never use a skill name from RELEVANT SKILLS as the "tool" value; skills are instructions only.
WRONG: {"accion":"ejecutar","herramienta":"df","entrada":{}}
RIGHT: {"action":"tool","tool":"execute_command","input":{"command":"df -h"}}${moderateToolJsonOnly}

Valid examples (adapt utilities to HOST OS above — linux vs macOS vs Windows):
{"action":"tool","tool":"execute_command","input":{"command":"ls /path/to/folder"}}
{"action":"tool","tool":"execute_command","input":{"command":"df -h"}}
{"action":"tool","tool":"execute_command","input":{"command":"uname -a"}}
{"action":"tool","tool":"web_search","input":{"query":"search terms"}}
{"action":"tool","tool":"read_file","input":{"path":"/path/to/file.txt"}}
{"action":"tool","tool":"remember","input":{"userId":"${input.userId}","key":"key_name","value":"value"}}

${toolUsageRule}

TOOL SELECTION — CRITICAL:
- List / show folder contents → execute_command; use a form that shows file vs directory unambiguously, e.g. \`ls -la /path\` or \`ls -Fa /path\` (not plain \`ls\` alone when the user needs trustworthy names and types)
- Read a FILE → read_file (ONLY for files, NEVER for folders/directories)
- Search the internet for information → web_search
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
- The rule is: when in doubt → web_search. Only skip search for math, greetings,
  and questions explicitly about your capabilities or identity
- Never invent search results — use web_search
- Never invent system metrics (RAM, disk, processes) — always run the command with execute_command
- One tool call per response, no extra fields in the JSON input
- web_search input must be ONLY: {"query": "search terms"} — nothing else

${
  input.userLanguage && input.userLanguage !== 'es'
    ? `CRITICAL: Respond in ${input.userLanguage.toUpperCase()}. NOT in Spanish. NOT in any other language.`
    : 'Respond in Spanish (es).'
}
If responding with plain text (no tool), write in this language.`;

  const messages: Message[] = [...input.history, { role: 'user', content: input.message }];

  let rawContent: string;
  let firstResponse;
  const fastThinkStart = Date.now();
  try {
    firstResponse = await withTimeout(
      baseProvider.complete({
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.3,
        maxTokens: 384,
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

  rawContent = (firstResponse.content ?? '').trim();
  log.info('[AmplifierLoop] SIMPLE path - primera respuesta:', rawContent.substring(0, 150));

  let finalContent = rawContent;

  let normalizedContent = rawContent;
  if (isModerate && !normalizedContent.startsWith('{')) {
    const forcedTool = '';
    const strictPrompt = `${buildAssistantIdentityPrompt(input)}
You failed to return a valid tool JSON in a MODERATE request.
Return ONLY JSON now. No prose, no markdown, no narration before or after the object.
${forcedTool ? `You MUST use tool "${forcedTool}".` : 'You MUST use one of the available tools.'}
Format:
{"action":"tool","tool":"TOOL_NAME","input":{...}}`;
    try {
      const retry = await withTimeout(
        baseProvider.complete({
          messages: [
            { role: 'system', content: strictPrompt },
            { role: 'user', content: input.message },
          ],
          temperature: 0,
          maxTokens: 220,
        }),
        60_000,
        'SIMPLE moderate strict-tool retry'
      );
      const retried = (retry.content ?? '').trim();
      if (retried.startsWith('{') || extractFirstJsonObject(retried)) {
        normalizedContent = retried.startsWith('{') ? retried : extractFirstJsonObject(retried) ?? retried;
        log.info('[AmplifierLoop] SIMPLE path - strict moderation retry produced tool JSON');
      }
    } catch (retryErr) {
      log.warn('[AmplifierLoop] SIMPLE path - strict moderation retry failed:', retryErr);
    }
  }
  if (!rawContent.startsWith('{')) {
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
      if (end !== -1) {
        const argsJson = jsonPart.slice(0, end + 1);
        normalizedContent = `{"action":"tool","tool":"${possibleTool}","input":${argsJson}}`;
        log.info(`[AmplifierLoop] SIMPLE path - formato normalizado: ${normalizedContent.substring(0, 100)}`);
      }
    }

    if (!normalizedContent.startsWith('{')) {
      const embeddedJson = extractFirstJsonObject(rawContent);
      if (embeddedJson) {
        normalizedContent = embeddedJson;
        log.info('[AmplifierLoop] SIMPLE path - JSON embebido detectado y extraído');
      }
    }

  }

  if (normalizedContent.startsWith('{')) {
    try {
      const parsedResult = parseFirstJsonObject<any>(normalizedContent, { tryRepair: true });
      if (!parsedResult) {
        const repairedCandidate = repairJsonString(normalizedContent);
        const repairedResult = parseFirstJsonObject<any>(repairedCandidate, { tryRepair: true });
        if (!repairedResult) {
          throw new Error('JSON inválido incluso después de reparación');
        }
        log.info('[AmplifierLoop] SIMPLE path - JSON reparado exitosamente');
      }
      const parsed = (
        parsedResult ?? parseFirstJsonObject<any>(repairJsonString(normalizedContent), { tryRepair: true })
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
              finalContent = `No se pudo resolver la herramienta tras la corrección: ${toolName}`;
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
                const result = await tool.execute(preparedToolInput);
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
                const verifyStart = Date.now();
                const verified = await runVerifyBeforeSynthesizeIfEnabled(
                  { baseProvider, withTimeout },
                  input,
                  toolOutput,
                  steps.length + 1,
                  modelsUsed,
                  !!verifyBeforeSynthesize
                );
                if (verified.step) {
                  steps.push(verified.step);
                  recordStageMetric(stageMetrics, 'verify', Date.now() - verifyStart, true);
                }
                const evidenceForSynth = verified.context;

                const synthesisPrompt = `${buildAssistantIdentityPrompt(input)}
${relevantSkillsSection}
${requiredTemplateSection}
You executed a tool and got this result:

TOOL: ${execName}
RESULTADO REAL DE EJECUCIÓN (no inventar, no agregar información):
${evidenceForSynth}

Write a response to the user based on this real result.
Do NOT invent or add information not present in the result.
If the result looks like command output with multiple lines (listings, tables, logs), put the COMPLETE tool output in a single markdown fenced code block first, then at most one short sentence if needed. Never invent paths, merge lines into categories, or label something as a file or directory unless that distinction appears in the output.
Do NOT explain the internal process or mention tools.
If REQUIRED OUTPUT TEMPLATES are present, you MUST follow one template exactly.
Template rules have higher priority than "natural phrasing".
Do not change labels/order/emoji/sections from the chosen template.
When a required field is missing in the tool result, keep the format and use "N/D" for that field.

${
  input.userLanguage && input.userLanguage !== 'es'
    ? `CRITICAL: Write your response in ${input.userLanguage.toUpperCase()}. NOT in Spanish.`
    : 'Write your response in Spanish (es).'
}`;

                let synthesisResponse;
                const synthStart = Date.now();
                try {
                  synthesisResponse = await withTimeout(
                    baseProvider.complete({
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
                  log.error('[AmplifierLoop] SIMPLE path - síntesis falló:', synthErr);
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
        log.warn(`[AmplifierLoop] SIMPLE path - tool "${toolName}" no encontrada`);
      }
    } catch {
      log.info('[AmplifierLoop] SIMPLE path - respuesta directa (no JSON)');
    }
  }

  if (!finalContent) {
    log.warn('[AmplifierLoop] SIMPLE path - contenido vacío, usando fallback');
    finalContent = 'No pude procesar tu solicitud. ¿Puedes intentarlo de nuevo?';
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
