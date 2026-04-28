import type { Message, LLMProvider } from '../../providers/types.js';
import type { AmplifierInput, Step } from '../types.js';
import type { SkillRegistry } from '../../skills/SkillRegistry.js';
import type { MCPRegistry } from '../../mcp/index.js';
import type { SkillResolver, RelevantSkill } from '../SkillResolver.js';
import { buildAssistantIdentityPrompt } from './AmplifierLoopPromptHelpers.js';
import { describeHostForExecuteCommandPrompt } from '../runtimeHostContext.js';
import type { AmplifierLoopLog } from './AmplifierLoopLog.js';

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
  const toolsList = mergedTools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');

  const previousActSteps = previousSteps.filter((s) => s.type === 'act');
  const previousObservations = previousSteps.filter((s) => s.type === 'observe' && s.output);
  const preResolvedSkills = input.resolvedSkills ?? resolvedSkills;
  const skillsToInjectForThink: RelevantSkill[] =
    !skipSkills && skillRegistry
      ? preResolvedSkills ?? (await skillResolver.resolveRelevantSkills(input.message, skillRegistry))
      : [];

  const multiStepSkills = skillsToInjectForThink.filter((skill) => {
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

    let stepDescriptions: string[] = [];
    if (skill.steps?.length) {
      stepDescriptions = skill.steps.map(
        (s, i) => `  Step ${i + 1}: ${s.description}${s.tool ? ` [tool: ${s.tool}]` : ''}`
      );
    } else {
      const pasoLines = (skill.content ?? '')
        .split('\n')
        .filter((l) => /^\d+\.\s/.test(l.trim()) || /\bpaso\s+\d+/i.test(l))
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

  const imageDelegationBlock =
    !isAlgorithmMode && input.imageContext?.base64 && input.imageContext?.mimeType
      ? `
IMAGE DELEGATION (mandatory):
The user message concerns an image the local model could not analyze. Image bytes are attached only for delegation — you MUST NOT invent or guess visual content from text alone.
Respond with exactly ONE JSON object: {"action":"delegate","agent":"vision_agent","task":"<what to analyze or extract from the image>","reason":"Local model does not support vision; image is in delegation context"}.
Use a concrete task (include any user question about the image in the task text). No other action is valid until this delegation runs.
`
      : '';

  const systemPrompt = `${buildAssistantIdentityPrompt(input)}

${describeHostForExecuteCommandPrompt(input.runtimeHints)}
${isAlgorithmMode ? algorithmModeBlock : 'Your task is to decide what action is needed.'}
${imageDelegationBlock}
AVAILABLE TOOLS:
${toolsList}

DELEGATION — use when the task genuinely exceeds your capabilities:
If you determine that completing this task requires capabilities beyond what
you can do with the available tools, you can delegate to a specialized agent.

To delegate, respond with:
{"action": "delegate", "agent": "<agent_name>", "task": "<what needs to be done>", "reason": "<why you cannot do it>"}

Available agents:
- "claude_code": for complex code generation, debugging, architecture decisions,
  writing more than 50 lines of code, or technical analysis requiring deep reasoning
- "doc_agent": for generating professional documents (reports, proposals, presentations)
  that require structured formatting, multiple sections, or executive-level quality
- "vision_agent": for analyzing images when the local model cannot process them

DELEGATION RULES — read carefully:
- Only delegate when you genuinely cannot complete the task with available tools
- Never delegate simple tasks you can handle with web_search, write_file, or execute_command
- Never delegate just because the task is long — delegate when it requires capabilities you lack
- Always try first. Delegate only when you realize mid-reasoning that you cannot proceed
- When delegating, provide a complete and specific task description — the agent has no other context

PROACTIVE SEARCH RULE:
Before answering any question about facts, people, companies, prices, events,
or anything that could have changed, use web_search.
Do not answer from memory when web_search is available.
If you are unsure whether to search — search.

CRITICAL: To use a tool, respond ONLY with this EXACT JSON format:
{"action":"tool","tool":"TOOL_NAME","input":{"param":"value"}}

The "input" field MUST be a nested object. Never put params at the root level.

CORRECT examples:
{"action":"tool","tool":"execute_command","input":{"command":"ls /path/to/folder"}}
{"action":"tool","tool":"web_search","input":{"query":"search terms"}}
{"action":"tool","tool":"read_file","input":{"path":"/path/to/file.txt"}}
{"action":"tool","tool":"write_file","input":{"path":"/path/to/file.md","content":"File content here"}}
{"action":"tool","tool":"remember","input":{"userId":"${input.userId}","key":"key_name","value":"value"}}
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

  const messages: Message[] = [...input.history, { role: 'user', content: input.message }];

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

  if (isAlgorithmMode) {
    log.info(
      `[AmplifierLoop] Algorithm mode: step ${previousActSteps.length + 1}/${multiStepSkills[0].steps?.length ?? '?'} of skill "${multiStepSkills[0].name}"`
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
