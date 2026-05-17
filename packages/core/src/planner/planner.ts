import { ModelClient, Message } from '../model/client.js';
import { Memory, Tool } from '../memory/memory.js';

export type PlannerAction =
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  | { type: 'response'; content: string }
  | { type: 'done'; content: string };

export interface Planner {
  decide(
    userMessage: string,
    userId: string,
    history: Message[],
    previousResult?: string
  ): Promise<PlannerAction>;
}

export function createPlanner(model: ModelClient, memory: Memory): Planner {
  return {
    async decide(userMessage, userId, history, previousResult) {
      const facts = memory.getFacts(userId);
      const tools = memory.getTools();

      const systemPrompt = buildSystemPrompt(facts, tools, previousResult);

      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage },
      ];

      const raw = await model.complete(messages, { temperature: 0.2 });
      return parseAction(raw);
    },
  };
}

function buildSystemPrompt(
  facts: Array<{ key: string; value: string }>,
  tools: Tool[],
  previousResult?: string
): string {
  const parts: string[] = [];

  parts.push(`You are Enzo, an intelligent personal assistant.
Your job is to help the user by taking real actions — not just talking about them.`);

  if (facts.length > 0) {
    parts.push(`WHAT YOU KNOW ABOUT THE USER:
${facts.map(f => `- ${f.key}: ${f.value}`).join('\n')}`);
  }

  if (tools.length > 0) {
    parts.push(`TOOLS AVAILABLE:
${tools.map(t => `- ${t.name}: ${t.description}
  Input schema: ${JSON.stringify(t.inputSchema)}`).join('\n')}`);
  }

  if (previousResult) {
    parts.push(`ACTIONS TAKEN SO FAR:
${previousResult}

Based on these results, decide the NEXT action. Do not repeat actions already taken.
If you have enough information to complete the task, use write_file or respond directly.`);
  }

  parts.push(`DECISION RULES:
- If you need to take an action (create, read, write, search, organize) → use a tool
- If the previous action gave you what you need → respond to the user
- If you have all the information needed → respond directly
- NEVER say you cannot do something if a tool can do it
- NEVER invent file contents or search results

RESPOND WITH EXACTLY ONE of these JSON formats:

Use a tool:
{"action":"tool","name":"tool_name","input":{...}}

Respond to user:
{"action":"response","content":"your response here"}

Task complete:
{"action":"done","content":"final response to user"}`);

  return parts.join('\n\n');
}

function parseAction(raw: string): PlannerAction {
  const cleaned = raw.replace(/```json|```/g, '').trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    return { type: 'response', content: cleaned };
  }

  let jsonStr = match[0];

  let open = 0;
  let closeAt = -1;
  for (let i = 0; i < jsonStr.length; i++) {
    if (jsonStr[i] === '{') open++;
    if (jsonStr[i] === '}') {
      open--;
      if (open === 0) { closeAt = i; break; }
    }
  }
  if (closeAt !== -1) {
    jsonStr = jsonStr.slice(0, closeAt + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);

    if (parsed.action === 'tool' && parsed.name) {
      return {
        type: 'tool',
        name: parsed.name,
        input: parsed.input ?? {},
      };
    }

    if (parsed.action === 'response' && parsed.content) {
      return { type: 'response', content: parsed.content };
    }

    if (parsed.action === 'done' && parsed.content) {
      return { type: 'done', content: parsed.content };
    }

    return { type: 'response', content: raw.trim() };
  } catch {
    return { type: 'response', content: raw.trim() };
  }
}