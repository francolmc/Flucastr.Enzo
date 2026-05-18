import { ModelClient, Message } from '../model/client.js';
import { Memory, Tool } from '../memory/memory.js';
import { McpRegistry } from '../mcp/registry.js';

export interface PlannerResult {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  response?: string;
  plan?: string[];
}

export interface Planner {
  resolve(
    userMessage: string,
    userId: string,
    conversationContext?: string,
    isVoice?: boolean,
    understandContext?: string,
  ): Promise<string>;
}

export function createPlanner(model: ModelClient, memory: Memory, mcpRegistry: McpRegistry): Planner {
  return {
    async resolve(userMessage, userId, conversationContext?, isVoice?, understandContext?) {
      const facts = memory.getFacts(userId);
      const tools = memory.getTools();

      const understanding = await understand(model, userMessage, facts, tools, understandContext);

      const rito = null;

      const plan = rito ?? await planSteps(model, understanding, tools, conversationContext);

      const results: string[] = [];
      if (plan.length > 0) {
        for (const step of plan) {
          const result = await executeStep(model, step, tools, results, mcpRegistry);
          results.push(result);
        }
      }

      console.log('[results before respond]:', results);

      return await validateAndRespond(model, userMessage, understanding, results, facts, isVoice);
    },
  };
}

async function understand(
  model: ModelClient,
  userMessage: string,
  facts: Array<{ key: string; value: string }>,
  tools: Tool[],
  understandContext?: string
): Promise<string> {
  const factList = facts.map(f => `${f.key}: ${f.value}`).join('\n');
  const toolList = tools.map(t => `${t.name}: ${t.description}`).join('\n');

  const raw = await model.complete([
    {
      role: 'system',
      content: `You are analyzing a user request. Describe in ONE clear sentence what the user wants to achieve.

USER CONTEXT:
${factList}

AVAILABLE TOOLS:
${toolList}

${understandContext ? `CONVERSATION HISTORY (use ONLY to resolve ambiguous references like "the second one", "that", "it", "the first"):
${understandContext}` : ''}

Be specific about what needs to be done.
If the user context contains a file path relevant to the request, include that exact path in your description.
Respond with ONLY one sentence.`
    },
    { role: 'user', content: userMessage }
  ], { temperature: 0 });

  console.log('[understanding]:', raw.trim());

  return raw.trim();
}

async function planSteps(
  model: ModelClient,
  understanding: string,
  tools: Tool[],
  conversationContext?: string
): Promise<string[]> {
  const toolList = tools.map(t => `${t.name}: ${t.description}`).join('\n');
  const ctx = conversationContext
    ? `\nRECENT CONVERSATION:\n${conversationContext}\n`
    : '';

  console.log('[ctx en planSteps]:', conversationContext?.slice(0, 200));

  const raw = await model.complete([
    {
      role: 'system',
      content: `You are a task planner. Break down the objective into the minimum necessary steps.

AVAILABLE TOOLS:
${toolList}
${ctx}
Rules:
- Each step uses exactly ONE tool
- Steps must be in execution order
- Use only tools from the list above
- If the objective requires modifying existing content, first read the current content, then write the updated version
- If no tools are needed to achieve the objective, respond with: "NO_TOOLS"
- Otherwise provide the numbered list of steps.`
    },
    { role: 'user', content: `Objective: ${understanding}` }
  ], { temperature: 0 });

  if (raw.trim().startsWith('NO_TOOLS')) {
    return [];
  }

  const steps = raw.split('\n')
    .filter(line => /^[\dN]+\./.test(line.trim()))
    .map(line => line.trim());

  console.log('[plan]:', steps);

  return steps;
}

async function executeStep(
  model: ModelClient,
  step: string,
  tools: Tool[],
  previousResults: string[],
  mcpRegistry: McpRegistry
): Promise<string> {
  const context = previousResults.length > 0
    ? `\nPREVIOUS RESULTS:\n${previousResults.join('\n')}`
    : '';

  const raw = await model.complete([
    {
      role: 'system',
      content: `Extract the tool parameters for this step.

      STEP: ${step}
      TOOLS: ${JSON.stringify(tools.map(t => ({ name: t.name, schema: t.inputSchema })))}
      ${context}

      If this step needs content from a previous result, use that content.
      Respond with ONLY a JSON object: {"tool": "tool_name", "input": {...}}
      Nothing else.`
    },
    { role: 'user', content: step }
  ], { temperature: 0 });

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return `Step failed: could not parse parameters`;

  try {
    const parsed = JSON.parse(match[0]);
    const toolName = parsed.tool;
    const toolInput = parsed.input ?? {};

    const result = await mcpRegistry.callTool(toolName, toolInput);
    const formatted = result
      .split('\n')
      .filter(line => line.trim())
      .map((line, i) => `${i + 1}. ${line.trim()}`)
      .join('\n');
    console.log('[result raw]:', JSON.stringify(result));
    return `${toolName}:\n${formatted}`;
  } catch (e) {
    return `Step failed: ${e}`;
  }
}

async function validateAndRespond(
  model: ModelClient,
  userMessage: string,
  understanding: string,
  results: string[],
  facts: Array<{ key: string; value: string }>,
  isVoice?: boolean
): Promise<string> {
  const factList = facts.map(f => `${f.key}: ${f.value}`).join('\n');
  const resultList = results.map(r => r.replace(/\\n/g, '\n')).join('\n');

  const voiceInstruction = isVoice
    ? `\nIMPORTANT: This response will be READ ALOUD.
       - Never mention file paths or URLs
       - Never say "open the file" or "check the document"
       - Always state the actual content directly
       - Keep it conversational and natural for speech`
    : '';

  return await model.complete([
    {
      role: 'system',
      content: `You are Enzo, a personal assistant. Respond in Spanish.
      ${voiceInstruction}

      USER CONTEXT:
      ${factList}

      OBJECTIVE:
      ${understanding}

      WHAT WAS DONE:
      ${resultList}

      IMPORTANT: All items in the results are current data. Do not assume any item is completed unless explicitly stated in the results.
      Use ONLY information from the RESULTS section. Never invent or add information not present in the results.
      Present all the information from the results completely. Do not omit any item.
      Confirm to the user what was achieved in natural language.
      Be brief and direct.`
    },
    { role: 'user', content: userMessage }
  ], { temperature: 0.3 });
}

export async function generateResponse(
  model: ModelClient,
  userMessage: string,
  facts: Array<{ key: string; value: string }>,
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