/**
 * MCPConnection
 * Manages a single connection to an MCP server
 * Handles both stdio and SSE transports
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { z } from 'zod';
import { MCPServerConfig, MCPTool, MCPConnectionStatus } from './types.js';

export class MCPConnection {
  private config: MCPServerConfig;
  private client?: Client;
  private transport?: StdioClientTransport | SSEClientTransport;
  private tools: MCPTool[] = [];
  private status: MCPConnectionStatus = 'disconnected';
  private error?: string;
  private lastConnectedAt?: number;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  get serverConfig(): MCPServerConfig {
    return this.config;
  }

  get toolList(): MCPTool[] {
    return this.tools;
  }

  get connectionStatus(): MCPConnectionStatus {
    return this.status;
  }

  get connectionError(): string | undefined {
    return this.error;
  }

  get lastConnected(): number | undefined {
    return this.lastConnectedAt;
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      console.log(`[MCPConnection] Server "${this.config.name}" already connected or connecting`);
      return;
    }

    this.status = 'connecting';
    this.error = undefined;

    try {
      console.log(`[MCPConnection] Connecting to "${this.config.name}" (${this.config.transport})...`);

      // Create appropriate transport
      if (this.config.transport === 'stdio') {
        if (!this.config.command) {
          throw new Error('stdio transport requires "command" field');
        }

        this.transport = new StdioClientTransport({
          command: this.config.command,
          args: this.config.args || [],
          env: this.config.env 
            ? { ...process.env as Record<string, string>, ...this.config.env } 
            : (process.env as Record<string, string>),
        });
      } else if (this.config.transport === 'sse') {
        if (!this.config.url) {
          throw new Error('SSE transport requires "url" field');
        }

        this.transport = new SSEClientTransport(new URL(this.config.url));
      } else {
        throw new Error(`Unsupported transport: ${this.config.transport}`);
      }

      // Create and initialize client
      this.client = new Client(
        {
          name: `enzo-mcp-client`,
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);

      // List available tools
      const toolsResponse = await (this.client.request as any)(
        {
          method: 'tools/list',
        },
        z.any()
      );

      if (toolsResponse && (toolsResponse as any).tools && Array.isArray((toolsResponse as any).tools)) {
        this.tools = ((toolsResponse as any).tools).map((t: any) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || {},
          serverId: this.config.id,
        }));

        console.log(
          `[MCPConnection] Connected to "${this.config.name}". Found ${this.tools.length} tools`
        );
      } else {
        console.log(`[MCPConnection] Connected to "${this.config.name}" but could not list tools`);
      }

      this.status = 'connected';
      this.lastConnectedAt = Date.now();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.error = errorMessage;
      this.status = 'error';
      console.error(
        `[MCPConnection] Failed to connect to "${this.config.name}": ${errorMessage}`
      );
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
        this.client = undefined;
      }
      if (this.transport) {
        // Transport cleanup if needed
        this.transport = undefined;
      }
      this.tools = [];
      this.status = 'disconnected';
      this.error = undefined;
      console.log(`[MCPConnection] Disconnected from "${this.config.name}"`);
    } catch (err) {
      console.error(`[MCPConnection] Error disconnecting from "${this.config.name}":`, err);
      throw err;
    }
  }

  async callTool(toolName: string, input: any): Promise<string> {
    if (this.status !== 'connected' || !this.client) {
      throw new Error(
        `Cannot call tool "${toolName}": server "${this.config.name}" is not connected`
      );
    }

    try {
      console.log(`[MCPConnection] Calling tool "${toolName}" on "${this.config.name}"`);

      const response = await (this.client.request as any)(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: input,
          },
        },
        z.any()
      );

      // Extract the result
      if (response && (response as any).content && Array.isArray((response as any).content)) {
        const content = (response as any).content;
        // Return the first text content, or stringify the whole response
        const textContent = content.find((c: any) => c.type === 'text');
        return textContent ? textContent.text : JSON.stringify(response);
      }

      return JSON.stringify(response);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[MCPConnection] Error calling tool "${toolName}" on "${this.config.name}": ${errorMessage}`
      );
      throw err;
    }
  }

  async listTools(): Promise<MCPTool[]> {
    if (this.status !== 'connected') {
      return [];
    }
    return this.tools;
  }

  getState() {
    return {
      status: this.status,
      error: this.error,
      toolCount: this.tools.length,
      lastConnectedAt: this.lastConnectedAt,
    };
  }
}
