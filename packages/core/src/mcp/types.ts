/**
 * Model Context Protocol (MCP) Types
 * Defines the structure for MCP server configuration, tools, and connection states
 */

export interface MCPServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: 'stdio' | 'sse';
  // Para transporte stdio:
  command?: string;                    // ej: "npx"
  args?: string[];                     // ej: ["-y", "@modelcontextprotocol/server-filesystem"]
  env?: Record<string, string>;        // Variables de entorno adicionales
  // Para transporte SSE:
  url?: string;                        // ej: "http://localhost:3100/sse"
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;                 // JSON Schema
  serverId: string;                    // Qué servidor expone esta tool
}

export interface MCPToolCall {
  name: string;
  input: any;
}

export type MCPConnectionStatus = 'connected' | 'disconnected' | 'error' | 'connecting';

export interface MCPConnectionState {
  status: MCPConnectionStatus;
  error?: string;
  toolCount: number;
  lastConnectedAt?: number;
}
