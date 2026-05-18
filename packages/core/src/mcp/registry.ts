import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServerConfig } from '../config.js';
import { Memory } from '../memory/memory.js';

export interface McpRegistry {
  getServerForTool(toolName: string): McpServerConfig | null;
  callTool(toolName: string, input: Record<string, unknown>): Promise<string>;
}

export async function createMcpRegistry(
  servers: McpServerConfig[],
  memory: Memory
): Promise<McpRegistry> {
  const toolToServer = new Map<string, McpServerConfig>();

  for (const server of servers) {
    try {
      const tools = await discoverTools(server);
      for (const tool of tools) {
        toolToServer.set(tool.name, server);
        memory.saveTool({
          name: tool.name,
          description: tool.description ?? tool.name,
          inputSchema: tool.inputSchema ?? {},
        });
      }
    } catch (e) {
    }
  }

  return {
    getServerForTool(toolName) {
      return toolToServer.get(toolName) ?? null;
    },

    async callTool(toolName, input) {
      const server = toolToServer.get(toolName);
      if (!server) {
        return `Tool "${toolName}" not found in any connected MCP server`;
      }

      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
      });

      const client = new Client({ name: 'enzo', version: '2.0.0' });
      await client.connect(transport);

      try {
        const result = await client.callTool({ name: toolName, arguments: input });
        const content = result.content as Array<{ type: string; text: string }>;
        return content.map(c => c.text).join('\n');
      } finally {
        await client.close();
      }
    },
  };
}

async function discoverTools(server: McpServerConfig) {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
  });

  const client = new Client({ name: 'enzo-discovery', version: '2.0.0' });
  await client.connect(transport);

  try {
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close();
  }
}