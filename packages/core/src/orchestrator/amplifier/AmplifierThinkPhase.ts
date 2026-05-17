import os from 'os';
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
  buildMemoryPromptSection,
  buildToolsPrompt,
  capRelevantSkillsForPrompt,
  buildRelevantSkillsSection,
  buildThinkContractPrompt,
} from './AmplifierLoopPromptHelpers.js';
import type { AmplifierLoopLog } from './AmplifierLoopLog.js';
import { resolveAmplifierDialogueMessages } from './ContinuityMessages.js';

function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

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
  /** Mutable accumulator — caller passes by reference to collect real token counts. */
  usageAccumulator?: { inputTokens: number; outputTokens: number };
};

export async function runThinkPhase(deps: ThinkPhaseDeps, p: ThinkPhaseParams): Promise<Step> {
  const { baseProvider, withTimeout, maxIterations, mcpRegistry, skillRegistry, skillResolver, log } = deps;
  const { input, context, iteration, modelsUsed, previousSteps = [], skipSkills, resolvedSkills, usageAccumulator } = p;
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
  const skillsToInjectForPrompt = capRelevantSkillsForPrompt(skillsResolvedFull);
  const algorithmPlan = buildMultiStepAlgorithmPlan(multiStepSkills);

  const isAlgorithmMode = multiStepSkills.length > 0;

  const completedToolActs = countCompletedToolActs(previousSteps);
  const totalStepsAllSkills = isAlgorithmMode
    ? (resolveAlgorithmCursor(completedToolActs, algorithmPlan)?.totalStepsAllSkills ?? buildStepDescriptionsForSkill(multiStepSkills[0]!).length)
    : undefined;

  const webSearchTool = mergedTools.find((t) => {
    const name = t.name.toLowerCase();
    const desc = (t.description ?? '').toLowerCase();
    return (
      (name.includes('web') && name.includes('search')) ||
      name.includes('web-search') ||
      (name.endsWith('_search') &&
        (desc.includes('web') ||
          desc.includes('internet') ||
          desc.includes('duckduckgo') ||
          desc.includes('brave') ||
          desc.includes('search the web') ||
          desc.includes('buscar en internet')))
    );
  });
  const hasWebSearch = webSearchTool != null;
  const webSearchToolName = webSearchTool?.name;

  const memorySection = buildMemoryPromptSection(input);

  const systemPrompt = [
    `[REASONING MODE] You are thinking, not responding to the user.
Your output is internal reasoning — it will NEVER be shown directly to the user.
The user only sees the final synthesized response after all reasoning is complete.
Emit ONLY JSON. Never write conversational text.`,
    buildAssistantIdentityPrompt(input),
    memorySection,
    toolsPrompt,
    skillsToInjectForPrompt.length > 0 ? buildRelevantSkillsSection(skillsToInjectForPrompt) : '',
    buildThinkContractPrompt({
      context,
      iteration,
      maxIterations,
      isAlgorithmMode,
      stepsCompleted: isAlgorithmMode ? completedToolActs : undefined,
      totalSteps: totalStepsAllSkills,
      hasWebSearch,
      webSearchToolName,
      homeDir: input.runtimeHints?.homeDir ?? process.env.HOME ?? os.homedir(),
    }),
  ]
    .filter(Boolean)
    .join('\n\n');

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

  if (!skipSkills && skillsToInjectForPrompt.length > 0) {
    if (DEBUG) log.info(`[AmplifierLoop] Relevant skills found:`, skillsToInjectForPrompt.length);
    skillsToInjectForPrompt.forEach((s) => {
      if (DEBUG)
        log.info(`[AmplifierLoop] Relevant skill: ${s.name} (score: ${(s.relevanceScore * 100).toFixed(0)}%)`);
    });

    for (const skill of skillsToInjectForPrompt) {
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
      content: `Resultado de accion anterior: ${s.output}`,
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
  if (usageAccumulator) {
    usageAccumulator.inputTokens += response.usage?.inputTokens ?? 0;
    usageAccumulator.outputTokens += response.usage?.outputTokens ?? 0;
  }

  let thinkOutput = stripThink(response.content ?? '');
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