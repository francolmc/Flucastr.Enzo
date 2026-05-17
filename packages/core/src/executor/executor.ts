import { Memory, Tool } from '../memory/memory.js';

export interface ExecutionResult {
  success: boolean;
  output: string;
  toolName: string;
}

export interface Executor {
  execute(toolName: string, input: Record<string, unknown>): Promise<ExecutionResult>;
  getAvailableTools(): Tool[];
}

export function createExecutor(memory: Memory): Executor {
  const tools = memory.getTools();

  return {
    getAvailableTools() {
      return tools;
    },

    async execute(toolName, input) {
      const tool = tools.find(t => t.name === toolName);

      if (!tool) {
        return {
          success: false,
          output: `Tool "${toolName}" not found. Available tools: ${tools.map(t => t.name).join(', ')}`,
          toolName,
        };
      }

      try {
        const result = await callTool(toolName, input);
        return { success: true, output: result, toolName };
      } catch (error) {
        return {
          success: false,
          output: `Tool "${toolName}" failed: ${error instanceof Error ? error.message : String(error)}`,
          toolName,
        };
      }
    },
  };
}

async function callTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/stdio.js'
  );

  const transport = new StdioClientTransport({
    command: 'npx',
    args: [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      process.env.HOME ?? '/',
    ],
  });

  const client = new Client({ name: 'enzo', version: '2.0.0' });
  await client.connect(transport);

  try {
    const result = await client.callTool({ name, arguments: input });
    const content = result.content as Array<{ type: string; text: string }>;
    return content.map((c) => c.text).join('\n');
  } finally {
    await client.close();
  }
}