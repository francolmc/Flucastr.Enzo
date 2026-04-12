/**
 * MCPRegistry
 * Central registry for managing MCP server connections
 * Handles persistence, connection lifecycle, and tool discovery
 */

import { v4 as uuidv4 } from 'uuid';
import { MCPConnection } from './MCPConnection.js';
import { MCPServerConfig, MCPTool } from './types.js';
import { MemoryService } from '../memory/MemoryService.js';

export class MCPRegistry {
  private connections: Map<string, MCPConnection> = new Map();
  private memoryService?: MemoryService;

  constructor(memoryService?: MemoryService) {
    this.memoryService = memoryService;
  }

  /**
   * Add a new MCP server configuration
   * If no ID provided, generate one
   */
  async addServer(config: Omit<MCPServerConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<MCPServerConfig> {
    const id = `mcp_${uuidv4().slice(0, 8)}`;
    const now = Date.now();

    const fullConfig: MCPServerConfig = {
      ...config,
      id,
      createdAt: now,
      updatedAt: now,
    } as MCPServerConfig;

    // Save to memory service if available
    if (this.memoryService) {
      this.memoryService.saveMCPServer(fullConfig);
    }

    // Add to in-memory registry
    const connection = new MCPConnection(fullConfig);
    this.connections.set(id, connection);

    console.log(`[MCPRegistry] Server "${fullConfig.name}" added with ID "${id}"`);

    // If enabled, try to connect immediately
    if (fullConfig.enabled) {
      try {
        await connection.connect();
        console.log(`[MCPRegistry] Auto-connected to "${fullConfig.name}"`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[MCPRegistry] Failed to auto-connect "${fullConfig.name}": ${errMsg}`);
      }
    }

    return fullConfig;
  }

  /**
   * Remove a server and disconnect if connected
   */
  async removeServer(id: string): Promise<void> {
    const connection = this.connections.get(id);

    if (connection) {
      try {
        await connection.disconnect();
      } catch (err) {
        console.warn(`[MCPRegistry] Error disconnecting "${connection.serverConfig.name}":`, err);
      }
      this.connections.delete(id);
    }

    if (this.memoryService) {
      this.memoryService.deleteMCPServer(id);
    }

    console.log(`[MCPRegistry] Server "${id}" removed`);
  }

  /**
   * Enable a server and optionally connect it
   */
  async enableServer(id: string): Promise<void> {
    const connection = this.connections.get(id);

    if (connection) {
      if (this.memoryService) {
        this.memoryService.updateMCPServer(id, { enabled: true });
      }

      // Try to connect if not already connected
      if (connection.connectionStatus !== 'connected') {
        await this.reconnect(id).catch(err => {
          console.warn(`[MCPRegistry] Failed to connect "${connection.serverConfig.name}": ${err.message}`);
        });
      }
    }
  }

  /**
   * Disable a server and disconnect if connected
   */
  async disableServer(id: string): Promise<void> {
    const connection = this.connections.get(id);

    if (connection) {
      try {
        await connection.disconnect();
      } catch (err) {
        console.warn(`[MCPRegistry] Error disconnecting "${connection.serverConfig.name}":`, err);
      }

      if (this.memoryService) {
        this.memoryService.updateMCPServer(id, { enabled: false });
      }
    }
  }

  /**
   * Get a specific server connection
   */
  getServer(id: string): MCPConnection | null {
    return this.connections.get(id) || null;
  }

  /**
   * Get all server connections (regardless of connection status)
   */
  getAllServers(): MCPConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get only connected servers
   */
  getConnectedServers(): MCPConnection[] {
    return this.getAllServers().filter(c => c.connectionStatus === 'connected');
  }

  /**
   * Get all tools from all connected servers
   */
  getAllTools(): MCPTool[] {
    const allTools: MCPTool[] = [];

    for (const connection of this.getConnectedServers()) {
      allTools.push(...connection.toolList);
    }

    return allTools;
  }

  /**
   * Call a tool on its corresponding server
   * Expects tool name in format: "mcp_${serverId}_${toolName}" or just toolName if serverId known
   */
  async callTool(toolName: string, input: any): Promise<string> {
    // Try to extract serverId from tool name (format: mcp_${serverId}_${toolName})
    let serverId: string | null = null;
    let actualToolName = toolName;

    if (toolName.startsWith('mcp_')) {
      const parts = toolName.substring(4).split('_');
      if (parts.length >= 2) {
        // Reconstruct serverId from parts (handles cases like "mcp_my_server_read_file")
        // We need to find the matching server
        for (const connection of this.getConnectedServers()) {
          const serverIdSlug = connection.serverConfig.id
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_');

          if (toolName.includes(`mcp_${connection.serverConfig.id}_`)) {
            serverId = connection.serverConfig.id;
            actualToolName = toolName.substring(`mcp_${serverId}_`.length);
            break;
          }
        }
      }
    }

    if (!serverId) {
      throw new Error(`Could not determine server for tool: ${toolName}`);
    }

    const connection = this.getServer(serverId);
    if (!connection) {
      throw new Error(`Server "${serverId}" not found or not connected`);
    }

    return await connection.callTool(actualToolName, input);
  }

  /**
   * Reload/reconnect all enabled servers
   * Used on startup with MCP_AUTO_CONNECT flag
   */
  async reconnectAll(): Promise<void> {
    console.log('[MCPRegistry] Reconnecting all enabled servers...');

    if (this.memoryService) {
      const configs = this.memoryService.getMCPServers();

      for (const config of configs) {
        if (config.enabled) {
          try {
            await this.reconnect(config.id);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(`[MCPRegistry] Failed to reconnect "${config.name}": ${errMsg}`);
          }
        }
      }
    }
  }

  /**
   * Reconnect a specific server
   */
  async reconnect(id: string): Promise<void> {
    // Disconnect if already connected
    const existingConnection = this.connections.get(id);
    if (existingConnection) {
      try {
        await existingConnection.disconnect();
      } catch (err) {
        console.warn(`[MCPRegistry] Error disconnecting during reconnect:`, err);
      }
    }

    // Get config (from memory service or from existing connection)
    let config: MCPServerConfig | null = null;

    if (this.memoryService) {
      const configs = this.memoryService.getMCPServers();
      config = configs.find(c => c.id === id) || null;
    }

    if (!config && existingConnection) {
      config = existingConnection.serverConfig;
    }

    if (!config) {
      throw new Error(`No configuration found for server "${id}"`);
    }

    // Create new connection
    const connection = new MCPConnection(config);
    await connection.connect();
    this.connections.set(id, connection);

    console.log(`[MCPRegistry] Reconnected to server "${config.name}"`);
  }

  /**
   * Load and initialize servers from memory
   * Should be called during application startup
   */
  async loadServersFromMemory(): Promise<void> {
    if (!this.memoryService) {
      console.log('[MCPRegistry] No memory service provided, skipping server loading');
      return;
    }

    console.log('[MCPRegistry] Loading servers from memory...');
    const configs = this.memoryService.getMCPServers();
    console.log(`[MCPRegistry] Found ${configs.length} server(s) in persistence`);

    if (configs.length === 0) {
      console.log('[MCPRegistry] No servers to load');
      return;
    }

    for (const config of configs) {
      console.log(`[MCPRegistry] Loading server "${config.name}" (ID: ${config.id}, enabled: ${config.enabled})`);
      const connection = new MCPConnection(config);
      this.connections.set(config.id, connection);

      // Only connect if enabled
      if (config.enabled) {
        try {
          await connection.connect();
          console.log(`[MCPRegistry] ✓ Connected to "${config.name}"`);
        } catch (err) {
          console.warn(
            `[MCPRegistry] ✗ Failed to connect to "${config.name}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      } else {
        console.log(`[MCPRegistry] - Server "${config.name}" is disabled, skipping connection`);
      }
    }

    console.log(`[MCPRegistry] Server loading complete. ${this.getConnectedServers().length} server(s) connected`);
  }

  /**
   * Convert MCP tools to Tool[] format for orchestrator integration
   * Returns tools with names prefixed as "mcp_${serverId}_${toolName}"
   */
  getMCPToolsForOrchestrator(): any[] {
    const tools: any[] = [];

    for (const connection of this.getConnectedServers()) {
      for (const mcpTool of connection.toolList) {
        tools.push({
          name: `mcp_${connection.serverConfig.id}_${mcpTool.name}`,
          description: `[MCP: ${connection.serverConfig.name}] ${mcpTool.description}`,
          parameters: mcpTool.inputSchema || {},
        });
      }
    }

    return tools;
  }

  /**
   * Get state of all servers for API response
   */
  getServersState() {
    return this.getAllServers().map(connection => ({
      ...connection.serverConfig,
      ...connection.getState(),
    }));
  }
}
