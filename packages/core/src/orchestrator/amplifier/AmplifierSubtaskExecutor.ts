import { MCPRegistry } from '../../mcp/index.js';
import { extractFilePath } from '../../utils/PathExtractor.js';
import type { Step } from '../types.js';

export interface SubtaskExecutorDeps {
  mcpRegistry: MCPRegistry | undefined;
  baseProvider: {
    complete: (params: {
      messages: { role: string; content: string }[];
      temperature: number;
      maxTokens: number;
    }) => Promise<{ content?: string }>;
  };
  withTimeout: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
  toolsUsed: Set<string>;
}

export async function executeSubtaskMCP(
  subtask: { id: number; tool: string; input: string; description?: string },
  accumulatedContext: string,
  inputOriginalMessage: string,
  deps: SubtaskExecutorDeps
): Promise<{ output: string; steps: Step[]; completed: boolean }> {
  const steps: Step[] = [];
  let output = '';
  let completed = false;

  if (!deps.mcpRegistry) {
    return { output: 'MCP registry not available', steps, completed: false };
  }

  const mcpTool = subtask.tool;

  if (mcpTool.includes('simulate-research-query') || mcpTool.includes('research')) {
    try {
      const mcpResult = await deps.mcpRegistry.callTool(mcpTool, {
        query: subtask.input || 'research',
      });

      output = mcpResult.substring(0, 500);
      deps.toolsUsed.add(mcpTool);
      completed = true;

      steps.push({
        iteration: 0,
        type: 'act',
        requestId: '',
        action: 'tool',
        target: mcpTool,
        input: JSON.stringify({ query: subtask.input }),
        output: mcpResult,
        status: 'ok',
        modelUsed: '',
      });
    } catch (err) {
      output = `ERROR: ${err}`;
    }
  } else if (mcpTool.includes('write_file')) {
    const filePath = extractFilePath(inputOriginalMessage) ?? 'output.md';

    try {
      const contentPrompt = `Based on the following context, write a concise markdown file.
Output ONLY the markdown content.

CONTEXT:
${accumulatedContext}`;

      const contentResponse = await deps.withTimeout(
        deps.baseProvider.complete({
          messages: [
            { role: 'system', content: contentPrompt },
            { role: 'user', content: `Write the content for ${filePath}` },
          ],
          temperature: 0.5,
          maxTokens: 2048,
        }),
        60_000,
        'mcp write_file content'
      );

      const fileContent = contentResponse.content?.trim() ?? accumulatedContext;

      const mcpResult = await deps.mcpRegistry.callTool(mcpTool, {
        path: filePath,
        content: fileContent,
      });

      output = `File written to ${filePath}`;
      deps.toolsUsed.add(mcpTool);
      completed = true;

      steps.push({
        iteration: 0,
        type: 'act',
        requestId: '',
        action: 'tool',
        target: mcpTool,
        input: JSON.stringify({ path: filePath }),
        output: mcpResult,
        status: 'ok',
        modelUsed: '',
      });
    } catch (err) {
      output = `ERROR: ${err}`;
    }
  } else {
    try {
      const mcpResult = await deps.mcpRegistry.callTool(mcpTool, { input: subtask.input });
      output = mcpResult.substring(0, 500);
      deps.toolsUsed.add(mcpTool);
      completed = true;
    } catch (err) {
      output = `ERROR: ${err}`;
    }
  }

  return { output, steps, completed };
}