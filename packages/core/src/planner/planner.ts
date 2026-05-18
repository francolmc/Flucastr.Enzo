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
  ): Promise<string>;
}

export function createPlanner(model: ModelClient, memory: Memory, mcpRegistry: McpRegistry): Planner {
  return {
    async resolve(userMessage, userId) {
      const facts = memory.getFacts(userId);
      const tools = memory.getTools();

      const understanding = await understand(model, userMessage, facts, tools);

      const rito = null;

      const plan = rito ?? await planSteps(model, understanding, tools);

      const results: string[] = [];
      for (const step of plan) {
        const result = await executeStep(model, step, tools, results, mcpRegistry);
        results.push(result);

        const done = await isObjectiveComplete(model, understanding, results);
        if (done) break;
      }

      return await validateAndRespond(model, userMessage, understanding, results, facts);
    },
  };
}

async function understand(
  model: ModelClient,
  userMessage: string,
  facts: Array<{ key: string; value: string }>,
  tools: Tool[]
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

Be specific. If the user wants web information, note that search tools are available.
If the user context contains a specific file path relevant to the request, include that exact path in your description.
Respond with ONLY one sentence.`
    },
    { role: 'user', content: userMessage }
  ], { temperature: 0 });

  return raw.trim();
}

async function planSteps(
  model: ModelClient,
  understanding: string,
  tools: Tool[]
): Promise<string[]> {
  const toolList = tools.map(t => `${t.name}: ${t.description}`).join('\n');

  const raw = await model.complete([
    {
      role: 'system',
      content: `You are a task planner. Break down the objective into ALL necessary steps to complete it.

AVAILABLE TOOLS:
${toolList}

Rules:
- Each step must use exactly ONE tool
- Steps must be in execution order
- Include ALL steps needed — do not skip any
- To modify a file: you need BOTH read_file (to get current content) AND write_file (to save updated content)
- Be specific about file paths and content

Respond with a numbered list using actual numbers. Each line: "1. tool_name: what to do"
Example:
1. read_file: read /path/to/file
2. write_file: write updated content to /path/to/file
Nothing else.`
    },
    { role: 'user', content: `Objective: ${understanding}` }
  ], { temperature: 0 });

  const steps = raw.split('\n')
    .filter(line => /^[\dN]+\./.test(line.trim()))
    .map(line => line.trim());

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
    return `${toolName}: ${result.slice(0, 300)}`;
  } catch (e) {
    return `Step failed: ${e}`;
  }
}

async function validateAndRespond(
  model: ModelClient,
  userMessage: string,
  understanding: string,
  results: string[],
  facts: Array<{ key: string; value: string }>
): Promise<string> {
  const factList = facts.map(f => `${f.key}: ${f.value}`).join('\n');
  const resultList = results.join('\n');

  return await model.complete([
    {
      role: 'system',
      content: `You are Enzo, a personal assistant. Respond in Spanish.

USER CONTEXT:
${factList}

WHAT WAS DONE:
${resultList}

Use ONLY information from the RESULTS section. Never invent or add information not present in the results.
List ALL items from the results. Do not summarize or omit any item.
Verify the objective was achieved and confirm to the user in natural language.
Be brief and direct. No markdown formatting.`
    },
    { role: 'user', content: userMessage }
  ], { temperature: 0.3 });
}

async function isObjectiveComplete(
  model: ModelClient,
  understanding: string,
  results: string[]
): Promise<boolean> {
  const raw = await model.complete([
    {
      role: 'system',
      content: `You evaluate if a task objective has been FULLY achieved with CONCRETE results.

OBJECTIVE: ${understanding}

RESULTS SO FAR:
${results.join('\n')}

Rules:
- If the objective requires reading a file, the file content must be in the results
- If the objective requires web search, search results must be in the results  
- Listing directories or checking permissions is NOT achieving the objective
- Only answer YES if the actual requested data is present in the results

Respond with ONLY "YES" or "NO".`
    },
    { role: 'user', content: 'Is the objective fully complete with concrete results?' }
  ], { temperature: 0 });

  return raw.trim().toUpperCase().startsWith('YES');
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