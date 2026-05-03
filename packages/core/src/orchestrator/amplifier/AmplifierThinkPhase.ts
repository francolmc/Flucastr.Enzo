import type { Message, LLMProvider } from '../../providers/types.js';
import type { AmplifierInput, Step } from '../types.js';
import type { SkillRegistry } from '../../skills/SkillRegistry.js';
import type { MCPRegistry } from '../../mcp/index.js';
import type { SkillResolver, RelevantSkill } from '../SkillResolver.js';
import {
  buildMultiStepAlgorithmPlan,
  buildStepDescriptionsForSkill,
  countCompletedToolActs,
  isMultiStepRelevantSkill,
  resolveAlgorithmCursor,
} from '../SkillAlgorithmProgress.js';
import {
  buildAssistantIdentityPrompt,
  buildRuntimeThreeLayersContractPrompt,
  buildThinkDelegationCatalogBlock,
  buildToolsPrompt,
  capRelevantSkillsForPrompt,
} from './AmplifierLoopPromptHelpers.js';
import {
  describeHostForExecuteCommandPrompt,
  describeLocalWallClockPromptLine,
} from '../runtimeHostContext.js';
import type { AmplifierLoopLog } from './AmplifierLoopLog.js';
import { resolveAmplifierDialogueMessages } from './ContinuityMessages.js';

export type ThinkPhaseDeps = {
  baseProvider: LLMProvider;
  withTimeout: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
  maxIterations: number;
  mcpRegistry?: MCPRegistry;
  skillRegistry?: SkillRegistry;
  skillResolver: SkillResolver;
  log: AmplifierLoopLog;
};

export type ThinkPhaseParams = {
  input: AmplifierInput;
  context: string;
  iteration: number;
  modelsUsed: Set<string>;
  previousSteps?: Step[];
  skipSkills?: boolean;
  resolvedSkills?: RelevantSkill[];
};

export async function runThinkPhase(deps: ThinkPhaseDeps, p: ThinkPhaseParams): Promise<Step> {
  const { baseProvider, withTimeout, maxIterations, mcpRegistry, skillRegistry, skillResolver, log } = deps;
  const { input, context, iteration, modelsUsed, previousSteps = [], skipSkills, resolvedSkills } = p;
  const startTime = Date.now();

  const mergedTools = [...input.availableTools];
  if (mcpRegistry) {
    for (const mcpTool of mcpRegistry.getMCPToolsForOrchestrator()) {
      if (!mergedTools.some((tool) => tool.name === mcpTool.name)) {
        mergedTools.push(mcpTool);
      }
    }
  }
  const toolsPrompt = buildToolsPrompt(mergedTools);

  const previousObservations = previousSteps.filter((s) => s.type === 'observe' && s.output);
  const preResolvedSkills = input.resolvedSkills ?? resolvedSkills;
  const skillsResolvedFull: RelevantSkill[] =
    !skipSkills && skillRegistry
      ? preResolvedSkills ??
        (await skillResolver.resolveRelevantSkills(input.message, skillRegistry, {
          llm: baseProvider,
          withTimeout,
        }))
      : [];

  const multiStepSkills = skillsResolvedFull.filter(isMultiStepRelevantSkill);
  const skillsToInjectForThink = capRelevantSkillsForPrompt(skillsResolvedFull);
  const algorithmPlan = buildMultiStepAlgorithmPlan(multiStepSkills);

  const isAlgorithmMode = multiStepSkills.length > 0;

  let algorithmModeBlock = '';
  if (isAlgorithmMode) {
    const completedToolActs = countCompletedToolActs(previousSteps);
    const cursor = resolveAlgorithmCursor(completedToolActs, algorithmPlan);
    const skill = cursor?.currentSkill ?? multiStepSkills[0]!;
    const stepsCompleted = completedToolActs;
    const totalSteps = cursor?.totalStepsAllSkills ?? buildStepDescriptionsForSkill(skill).length;
    const stepDescriptions = buildStepDescriptionsForSkill(skill);
    const totalInCurrentSkill = stepDescriptions.length;
    const localNext = cursor?.stepWithinSkill ?? Math.min(stepsCompleted + 1, totalInCurrentSkill);
    const observationSummary = previousObservations
      .map((s, i) => `  Tool step ${i + 1} result: ${(s.output ?? '').substring(0, 300)}`)
      .join('\n');

    const segmentHint =
      cursor && cursor.planLength > 1
        ? `\nMulti-skill chain: segment ${cursor.skillIndex + 1}/${cursor.planLength} ("${skill.name}"). Global progress: ${stepsCompleted}/${totalSteps} tool steps.\n`
        : '';

    algorithmModeBlock = `
━━━ SKILL ALGORITHM IN PROGRESS: "${skill.name}" ━━━
Total tool steps required (all segments): ${totalSteps}
Tool steps completed: ${stepsCompleted}/${totalSteps}${segmentHint}
Current segment (${skill.name}): local step ${localNext}/${totalInCurrentSkill}

Algorithm (this segment):
${stepDescriptions.join('\n')}

Results so far:
${observationSummary}

CURRENT TASK: Execute local step ${localNext} of this segment (${skill.name}). Global tool-step ${stepsCompleted + 1} of ${totalSteps}.
Return ONLY a JSON tool call for this step. {"action":"none"} is NOT valid until all ${totalSteps} global tool steps are complete.
Do NOT return conversational text. Do NOT return {"action":"skill"}.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  const imageDelegationBlock =
    !isAlgorithmMode && input.imageContext?.base64 && input.imageContext?.mimeType
      ? `
IMAGE CONTEXT:
The host attached image bytes for this turn (forwarded to delegable agents). Do not invent visual details — if you need pixels, delegate once with a concrete "task" (include the user's question about the image).
Prefer a catalog user preset whose description/system role plausibly covers vision; otherwise use "vision_agent".
`
      : '';

  const delegationCatalogBlock = !isAlgorithmMode
    ? buildThinkDelegationCatalogBlock(input.availableAgents ?? [], input.delegationHint)
    : '';

  const systemPrompt = `${buildAssistantIdentityPrompt(input)}

${buildRuntimeThreeLayersContractPrompt()}

${describeHostForExecuteCommandPrompt(input.runtimeHints)}
${describeLocalWallClockPromptLine(input.runtimeHints)}
${isAlgorithmMode ? algorithmModeBlock : 'Your task is to decide what action is needed.'}
${imageDelegationBlock}
${toolsPrompt}

DELEGATION — use when the task genuinely exceeds your capabilities:
If you determine that completing this task requires capabilities beyond what
you can do with the available tools, you can delegate to a specialized agent.

To delegate, respond with:
{"action": "delegate", "agent": "<agent_id_from_catalog_below>", "task": "<what needs to be done>", "reason": "<why you cannot do it>"}

${delegationCatalogBlock}
DELEGATION RULES — read carefully:
- Only delegate when you genuinely cannot complete the task with available tools
- Never delegate simple tasks you can handle with web_search, write_file, or execute_command
- Never delegate just because the task is long — delegate when it requires capabilities you lack
- Always try first. Delegate only when you realize mid-reasoning that you cannot proceed
- The "task" string must be concrete and self-contained: the specialist receives ranked user memories, a short conversation/tool-trace summary built by the host, and optional image bytes — not the full raw chat. Put essential requirements, constraints, and success criteria in "task".

WHEN DELEGATION FAILS — especially if a prior observation mentions API authentication failures (invalid API key, unauthorized, HTTP 401/403):
- Do not tell the user you intrinsically "cannot see" images or lack a modality if the observation clearly indicates backend credentials or remote API rejection — distinguish configuration/service errors from model limits.
- If the catalog lists another Anthropic specialist that could reasonably handle the same multimodal task, you may emit one further {"action":"delegate"} toward a different agent id (not repetition loops).
- If no suitable specialist remains, use {"action":"none"} with a short factual message for the operator: verify ANTHROPIC_API_KEY in the deployment environment and any stored anthropic keys in configuration.

PROACTIVE SEARCH RULE:
Before answering any question about facts, people, companies, prices, events,
or anything that could have changed, use web_search.
Do not answer from memory when web_search is available.
If you are unsure whether to search — search.

CRITICAL — follow the canonical format inside AVAILABLE TOOLS above.
Use {"action":"tool","tool":"<exact_name_from_that_list>","input":{...}}. Never invent a tool name.

CORRECT examples:
{"action":"tool","tool":"execute_command","input":{"command":"ls /path/to/folder"}}
{"action":"tool","tool":"web_search","input":{"query":"search terms"}}
{"action":"tool","tool":"read_file","input":{"path":"/path/to/file.txt"}}
{"action":"tool","tool":"write_file","input":{"path":"/path/to/file.md","content":"File content here"}}
{"action":"tool","tool":"remember","input":{"key":"key_name","value":"value"}}
{"action":"tool","tool":"calendar","input":{"action":"add","title":"Meeting","start_iso":"2026-06-01T15:30:00Z","notes":"optional"}}
{"action":"delegate","agent":"claude_code","task":"Refactor the payment module for testability with full tests","reason":"Requires large-scale code changes beyond tool execution"}

WRONG examples (never do this):
{"action":"execute_command","command":"ls ~/Downloads"}
{"action":"web_search","query":"something"}

${
  isAlgorithmMode
    ? ''
    : `If you already have enough information:
{"action":"none"}

`
}ABSOLUTE RULES:
- To CREATE or OVERWRITE a file with content → use write_file (structure: {"path":"...","content":"..."})
- Never invent file contents — use read_file or write based on actual data
- Never invent search results — use web_search
- To list a folder use execute_command with a command that shows entry types clearly, e.g. ls -la /path/to/folder or ls -Fa /path/to/folder
- For file paths, use the paths provided by the user in the message OR copy path segments VERBATIM from prior tool output (especially ls). NEVER translate or rename files (e.g. "organized tasks.txt" must not become "tareas organizadas.txt").
- If the user refers to a file loosely but context lists a different exact name, use that exact name from context or run ls again — do not guess a translated filename.
- One tool call per response
- Never add text outside the JSON
- ALWAYS use absolute paths starting with / — never relative paths like "ls Downloads" or "mkdir documents/"
- Extract the target directory from the user's message and prefix every path with it
- Never invent files or folders — only use what execute_command results actually showed

Iteration: ${iteration}/${maxIterations}
${context ? `Context from previous steps:\n${context}` : ''}`;

  const messages: Message[] = [...resolveAmplifierDialogueMessages(input), { role: 'user', content: input.message }];

  const DEBUG = process.env.ENZO_DEBUG === 'true';
  if (DEBUG) log.info(`[AmplifierLoop] SkillRegistry available:`, !!skillRegistry);
  if (skillRegistry) {
    const enabledSkills = skillRegistry.getEnabled();
    if (DEBUG) log.info(`[AmplifierLoop] Enabled skills count:`, enabledSkills.length);
    enabledSkills.forEach((s) => {
      if (DEBUG) log.info(`[AmplifierLoop] Skill available: ${s.metadata.name}`);
    });
  }

  if (!skipSkills && skillsToInjectForThink.length > 0) {
    if (DEBUG) log.info(`[AmplifierLoop] Relevant skills found:`, skillsToInjectForThink.length);
    skillsToInjectForThink.forEach((s) => {
      if (DEBUG)
        log.info(`[AmplifierLoop] Relevant skill: ${s.name} (score: ${(s.relevanceScore * 100).toFixed(0)}%)`);
    });

    for (const skill of skillsToInjectForThink) {
      const content =
        isAlgorithmMode && multiStepSkills.some((ms) => ms.id === skill.id)
          ? `Skill "${skill.name}" activo en modo algoritmo. Sigue estrictamente el bloque "SKILL ALGORITHM IN PROGRESS".`
          : `Skill "${skill.name}" disponible para esta consulta (relevancia: ${(skill.relevanceScore * 100).toFixed(0)}%):\n\n${skill.content}`;

      messages.push({ role: 'system', content });
      if (DEBUG)
        log.info(
          `[AmplifierLoop] Injected skill "${skill.name}" (relevance: ${(skill.relevanceScore * 100).toFixed(0)}%)${isAlgorithmMode ? ' [algorithm mode]' : ''} into THINK context`
        );
    }
  }

  if (!isAlgorithmMode && previousSteps.length > 0) {
    const previousResults = previousObservations.map((s) => ({
      role: 'assistant' as const,
      content: `Resultado de acción anterior: ${s.output}`,
    }));

    if (previousResults.length > 0) {
      log.info(`[AmplifierLoop] Adding ${previousResults.length} previous results to context`);
      log.info(`[AmplifierLoop] First result preview:`, previousResults[0].content.substring(0, 150));
    }

    messages.push(...previousResults);
  }

  if (isAlgorithmMode && algorithmPlan.length > 0) {
    const ct = countCompletedToolActs(previousSteps);
    const cur = resolveAlgorithmCursor(ct, algorithmPlan);
    log.info(
      `[AmplifierLoop] Algorithm mode: global tool-step ${ct + 1}/${cur?.totalStepsAllSkills ?? '?'}; segment "${cur?.currentSkill.name ?? multiStepSkills[0]?.name}"`
    );
  }

  const useNativeToolCalling =
    process.env.ENZO_NATIVE_TOOL_CALLING === 'true' && !isAlgorithmMode && mergedTools.length > 0;

  const response = await withTimeout(
    baseProvider.complete({
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.5,
      maxTokens: 512,
      ...(useNativeToolCalling ? { tools: mergedTools } : {}),
    }),
    180_000,
    'think'
  );

  modelsUsed.add(baseProvider.model);

  let thinkOutput = response.content ?? '';
  if (response.toolCalls?.length) {
    const tc = response.toolCalls[0]!;
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
    thinkOutput = thinkOutput.trim() ? `${jsonLine}\n${thinkOutput}` : jsonLine;
  }

  return {
    iteration,
    type: 'think',
    requestId: input.requestId,
    output: thinkOutput,
    durationMs: Date.now() - startTime,
    status: 'ok',
    modelUsed: baseProvider.model,
  };
}
