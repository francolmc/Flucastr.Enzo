import { ModelClient, Message } from '../model/client.js';
import { Memory, Tool } from '../memory/memory.js';

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

export function createPlanner(model: ModelClient, memory: Memory): Planner {
  return {
    async resolve(userMessage, userId) {
      const facts = memory.getFacts(userId);
      const tools = memory.getTools();

      const understanding = await understand(model, userMessage, facts);

      const rito = null;

      const plan = rito ?? await planSteps(model, understanding, tools);

      const results: string[] = [];
      for (const step of plan) {
        const result = await executeStep(model, step, tools, results);
        results.push(result);
      }

      return await validateAndRespond(model, userMessage, understanding, results, facts);
    },
  };
}

async function understand(
  model: ModelClient,
  userMessage: string,
  facts: Array<{ key: string; value: string }>
): Promise<string> {
  const factList = facts.map(f => `${f.key}: ${f.value}`).join('\n');

  const raw = await model.complete([
    {
      role: 'system',
      content: `You are analyzing a user request. Describe in ONE clear sentence what the user wants to achieve.

USER CONTEXT:
${factList}

Be specific about files, paths, and content when mentioned.
Respond with ONLY one sentence.`
    },
    { role: 'user', content: userMessage }
  ], { temperature: 0 });

  const understanding = raw.trim();
  return understanding;
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
  previousResults: string[]
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

    const result = await callTool(toolName, toolInput);
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

Verify the objective was achieved and confirm to the user in natural language.
Be brief and direct. No markdown formatting.`
    },
    { role: 'user', content: userMessage }
  ], { temperature: 0.3 });
}

async function callTool(name: string, input: Record<string, unknown>): Promise<string> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.env.HOME ?? '/'],
  });

  const client = new Client({ name: 'enzo', version: '2.0.0' });
  await client.connect(transport);

  try {
    const result = await client.callTool({ name, arguments: input });
    const content = result.content as Array<{ type: string; text: string }>;
    return content.map(c => c.text).join('\n');
  } finally {
    await client.close();
  }
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