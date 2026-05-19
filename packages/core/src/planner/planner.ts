import { ModelClient } from '../model/client.js';
import { Memory, Tool } from '../memory/memory.js';
import { McpRegistry } from '../mcp/registry.js';
import type {
  ExecutionContext,
  PlannerOptions,
  PlannerResponse,
  Step,
  Fact,
} from './types.js';
import { DEFAULT_PLANNER_OPTIONS } from './types.js';
import { createToolRetriever } from './tool-retriever.js';
import {
  log,
  buildUnderstandPrompt,
  buildPlanPrompt,
  buildExecutePrompt,
  buildRespondPrompt,
} from './prompts.js';

export { buildUnderstandPrompt, buildPlanPrompt, buildExecutePrompt, buildRespondPrompt };

export interface Planner {
  resolve(
    userMessage: string,
    userId: string,
    executionContext: ExecutionContext,
    isVoice?: boolean,
  ): Promise<PlannerResponse>;
}

export function createPlanner(
  model: ModelClient,
  memory: Memory,
  mcpRegistry: McpRegistry,
  options: PlannerOptions = DEFAULT_PLANNER_OPTIONS
): Planner {
  const allTools = memory.getTools();
  const retriever = createToolRetriever(model, allTools);

  log('Tools', `Available ${allTools.length} tools:`);
  allTools.forEach(t => log('Tools', `  - ${t.name}: ${t.description}`));

  return {
    async resolve(userMessage, userId, executionContext, isVoice?) {
      const facts = memory.getFacts(userId);

      const { understandContext, conversationContext, previousResults } = executionContext;

      log('Planner', `Starting resolve for user ${userId}`);

      log('Planner', 'Phase 0: Tool Retrieval');
      const understanding = await understand(model, userMessage, facts, allTools, understandContext);
      log('Understand', understanding);

      const relevantTools = await retriever.retrieve(understanding, 5);
      log('Tools', `Retrieved ${relevantTools.length} tools:`, relevantTools.map(t => t.name));

      log('Planner', 'Phase 2: Plan');
      const plan = await planSteps(model, understanding, relevantTools, conversationContext, previousResults);
      log('Plan', `${plan.length} steps planned:`, plan.map(s => s.text));

      if (plan.length === 0) {
        log('Planner', 'No steps needed, generating direct response');
        const response = await generateResponse(model, userMessage, facts, understandContext);
        return {
          content: response,
          stepsExecuted: 0,
          stepsPlanned: 0,
          truncated: false,
        };
      }

      const results: string[] = [];
      let stepsExecuted = 0;
      let totalSteps = 0;
      let truncated = false;

      log('Planner', 'Phase 3: Execute');
      for (const step of plan) {
        if (totalSteps >= options.maxTotalSteps) {
          log('Planner', `Max steps (${options.maxTotalSteps}) reached, truncating`);
          truncated = true;
          break;
        }

        totalSteps++;
        log('Execute', `Step ${totalSteps}/${options.maxTotalSteps}: ${step.text}`);

        const result = await executeStep(model, step.text, relevantTools, results, mcpRegistry, executionContext);
        results.push(result);
        stepsExecuted++;
        log('Execute', `Result (${result.length} chars):`, result.substring(0, 150));
      }

      log('Planner', 'Phase 4: Respond');
      const response = await validateAndRespond(model, userMessage, understanding, results, facts, isVoice);
      log('Respond', response.substring(0, 200) + (response.length > 200 ? '...' : ''));

      log('Planner', `Completed: ${stepsExecuted} steps executed, truncated: ${truncated}`);

      return {
        content: response,
        stepsExecuted,
        stepsPlanned: plan.length,
        truncated,
      };
    },
  };
}

async function understand(
  model: ModelClient,
  userMessage: string,
  facts: Fact[],
  tools: Tool[],
  understandContext?: string
): Promise<string> {
  const prompt = buildUnderstandPrompt(userMessage, facts, tools, understandContext);

  const raw = await model.complete([
    { role: 'system', content: prompt },
    { role: 'user', content: userMessage }
  ], { temperature: 0 });

  log('Understand raw', raw);
  return raw.trim();
}

async function planSteps(
  model: ModelClient,
  understanding: string,
  tools: Tool[],
  conversationContext?: string,
  previousResults: string[] = []
): Promise<Step[]> {
  const prompt = buildPlanPrompt(understanding, tools, conversationContext, previousResults);

  const raw = await model.complete([
    { role: 'system', content: prompt },
    { role: 'user', content: understanding }
  ], { temperature: 0 });

  const trimmed = raw.trim();

  if (trimmed === 'NO_STEPS' || trimmed === 'NO_TOOLS') {
    return [];
  }

  const steps: Step[] = [];
  const lines = trimmed.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (/^[\d]+\./.test(trimmedLine)) {
      const stepText = trimmedLine.replace(/^[\d]+\.\s*/, '').trim();
      steps.push({ text: stepText });
    }
  }

  log('Plan raw', raw);

  return steps;
}

async function executeStep(
  model: ModelClient,
  step: string,
  tools: Tool[],
  previousResults: string[],
  mcpRegistry: McpRegistry,
  executionContext: ExecutionContext
): Promise<string> {
  const { understandContext } = executionContext;
  const context = understandContext?.length > 0
    ? `USER REFERENCED PREVIOUS RESULTS:\n${understandContext}`
    : undefined;

  const prompt = buildExecutePrompt(step, tools, previousResults, context);

  const raw = await model.complete([
    { role: 'system', content: prompt },
    { role: 'user', content: step }
  ], { temperature: 0 });

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return `Step failed: could not parse parameters from: ${raw.substring(0, 100)}`;
  }

  try {
    const parsed = JSON.parse(match[0]);
    const toolName = parsed.tool;
    const toolInput = parsed.input ?? {};

    if (!toolName) {
      return `Step failed: no tool name in response`;
    }

    log('Execute', `Calling tool: ${toolName} with input:`, toolInput);
    const result = await mcpRegistry.callTool(toolName, toolInput);
    const formatted = result
      .split('\n')
      .filter(line => line.trim())
      .map((line, i) => `${i + 1}. ${line.trim()}`)
      .join('\n');

    return `${toolName} result:\nContent:\n${formatted}`;
  } catch (e) {
    return `Step failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function validateAndRespond(
  model: ModelClient,
  userMessage: string,
  understanding: string,
  results: string[],
  facts: Fact[],
  isVoice?: boolean
): Promise<string> {
  const prompt = buildRespondPrompt(userMessage, understanding, results, facts, isVoice);

  return await model.complete([
    { role: 'system', content: prompt },
    { role: 'user', content: userMessage }
  ], { temperature: 0.3 });
}

export async function generateResponse(
  model: ModelClient,
  userMessage: string,
  facts: Fact[],
  context?: string
): Promise<string> {
  const factList = facts.map(f => `${f.key}: ${f.value}`).join('\n');
  const ctx = context ? `\nContext:\n${context}\n` : '';

  return await model.complete([
    {
      role: 'system',
      content: `You are Enzo, a personal assistant. Respond naturally in Spanish.

USER CONTEXT:
${factList}
${ctx}`
    },
    { role: 'user', content: userMessage }
  ], { temperature: 0.3 });
}