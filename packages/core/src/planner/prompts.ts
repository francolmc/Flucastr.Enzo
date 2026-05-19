import type { Fact, Tool } from './types.js';

const DEBUG = process.env.ENZO_DEBUG === 'true';

export function log(phase: string, ...args: unknown[]): void {
  if (DEBUG) {
    console.log(`[${phase}]`, ...args);
  }
}

export function buildUnderstandPrompt(
  userMessage: string,
  facts: Fact[],
  tools: Tool[],
  understandContext?: string,
): string {
  const factList = facts.map(f => `${f.key}: ${f.value}`).join('\n');
  const toolList = tools
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');

  let context = `You are analyzing a user request. Describe in ONE clear sentence what the user wants to achieve.

USER CONTEXT:
${factList}

AVAILABLE TOOLS:
${toolList}`;

  if (understandContext) {
    context += `

CONVERSATION HISTORY (use ONLY to resolve ambiguous references like "the second one", "that", "it", "the first"):
${understandContext}`;
  }

 context += `

Be specific about what needs to be done.
If the user context contains a file path relevant to the request, include that exact path in your description.
If the action involves modifying an existing resource, mention that it already exists and its content must be preserved.
If the action involves adding content to an existing resource, note that the current state must be read first, then the updated version written.
Respond with ONLY one sentence IN ENGLISH.`;

  return context;
}

export function buildPlanPrompt(
  understanding: string,
  tools: Tool[],
  conversationContext?: string,
  previousResults: string[] = []
): string {
  const toolList = tools
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');

  let context = `You are a task planner. Break down the objective into the minimum necessary steps.

OBJECTIVE:
${understanding}

AVAILABLE TOOLS:
${toolList}`;

  if (conversationContext) {
    context += `

RECENT CONVERSATION:
${conversationContext}`;
  }

  if (previousResults.length > 0) {
    context += `

PREVIOUS RESULTS (reference these when user says "the second", "that one", etc):
${previousResults.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  }

  context += `

Rules:
- Each step uses exactly ONE tool
- Steps must be in execution order
- Use only tools from the list above
- Always include the exact file path or URL in each step description
- If no tools are needed to respond, respond with "NO_STEPS"

Format each step as:
1. Use [tool_name] to [action] [exact path or URL]

USER: ${understanding}`;

  return context;
}

export function buildExecutePrompt(
  step: string,
  tools: Tool[],
  previousResults: string[] = [],
  context?: string
): string {
  const toolSchemas = JSON.stringify(tools.map(t => ({
    name: t.name,
    schema: t.inputSchema
  })));

  let prompt = `Extract the tool parameters for this step.

STEP: ${step}
TOOLS: ${toolSchemas}`;

  if (context) {
    prompt += `

CONTEXT:
${context}`;
  }

  if (previousResults.length > 0) {
    prompt += `

PREVIOUS RESULTS:
${previousResults.join('\n')}

If your step requires writing or updating content and a previous step already read existing content,
your input MUST include ALL existing content combined with the new content — not just the new part.`;
  }

  prompt += `

When appending content to an existing file using line-based editing tools,
ensure the new content starts with a newline character (\n) to avoid
concatenating with the last line of existing content.

Respond with ONLY a JSON object: {"tool": "tool_name", "input": {...}}
Nothing else.`;

  return prompt;
}

export function buildRespondPrompt(
  userMessage: string,
  understanding: string,
  results: string[],
  facts: Fact[],
  isVoice?: boolean
): string {
  const factList = facts.map(f => `${f.key}: ${f.value}`).join('\n');
  const resultList = results.map(r => r.replace(/\\n/g, '\n')).join('\n');

  let prompt = `You are Enzo, a personal assistant. Respond in Spanish.

USER CONTEXT:
${factList}

OBJECTIVE:
${understanding}

WHAT WAS DONE:
${resultList}`;

  if (isVoice) {
    prompt += `

IMPORTANT: This response will be READ ALOUD.
- Never mention file paths or URLs
- Never say "open the file" or "check the document"
- Always state the actual content directly
- Keep it conversational and natural for speech`;
  }

  prompt += `

Rules:
- All items in WHAT WAS DONE are current data. Do not assume any item is completed unless explicitly stated
- Use ONLY information from the WHAT WAS DONE section. Never invent or add information not present
- If the WHAT WAS DONE section is empty or insufficient, acknowledge that you don't have the information
- Never fabricate tasks, items, or content that were not actually retrieved or performed
- The content in WHAT WAS DONE is the exact data retrieved — report it exactly as shown, do not paraphrase or expand
- Present all the information from the results completely. Do not omit any item
- Confirm to the user what was achieved in natural language
- Be brief and direct

USER: ${userMessage}`;

  return prompt;
}