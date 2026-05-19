import type { Tool } from './types.js';
import type { ModelClient } from '../model/client.js';

export interface ToolRetriever {
  retrieve(objective: string, maxTools?: number): Promise<Tool[]>;
}

export function createToolRetriever(
  model: ModelClient,
  tools: Tool[]
): ToolRetriever {
  const filteredTools = tools.filter(t => 
    !t.description.toUpperCase().includes('DEPRECATED')
  );

  const toolList = filteredTools
  .map(t => {
    const shortDesc = t.description.split('\n')[0].split('.')[0].trim();
    return `- ${t.name}: ${shortDesc}`;
  })
  .join('\n');

  console.log('Tools', `Tool list size: ${toolList.length} chars`);

  return {
    async retrieve(objective: string, maxTools = 6): Promise<Tool[]> {
      const raw = await model.complete([
        {
          role: 'system',
          content: `You are a tool selector. Given an objective, select the minimum tools needed to achieve it.

AVAILABLE TOOLS:
${toolList}

Rules:
- Select only tools directly needed for the objective
- Consider tool dependencies — if a task requires writing, it may also need reading first
- Maximum ${maxTools} tools
- Use ONLY tool names from the AVAILABLE TOOLS list above
- If no tools are needed, respond with: NONE
- Respond with ONLY tool names separated by commas, nothing else`
        },
        { role: 'user', content: `Objective: ${objective}` }
      ], { temperature: 0 });

      const trimmed = raw.trim();

      if (trimmed === 'NONE' || trimmed === '') {
        return [];
      }

      const selectedNames = trimmed
        .split(',')
        .map(n => n.trim().toLowerCase())
        .filter(n => n.length > 0);

      const selected = selectedNames
        .map(name => tools.find(t => t.name.toLowerCase() === name))
        .filter((t): t is Tool => t !== undefined)
        .slice(0, maxTools);

      return selected.length > 0 ? selected : tools.slice(0, maxTools);
    },
  };
}