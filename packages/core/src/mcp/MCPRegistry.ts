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
   * Update server configuration (description, name, etc.)
   */
  async updateServer(id: string, updates: Partial<MCPServerConfig>): Promise<void> {
    console.log(`[MCPRegistry] updateServer called with id=${id}, updates=`, updates);
    if (this.memoryService) {
      console.log(`[MCPRegistry] Calling memoryService.updateMCPServer`);
      this.memoryService.updateMCPServer(id, updates);
    } else {
      console.warn(`[MCPRegistry] memoryService is not available`);
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
   * Call a tool on the appropriate server
   * Expects tool name in format: "mcp_${serverId}_${toolName}" or just toolName if serverId known
   */
  async callTool(toolName: string, input: any, taskContext?: { description: string }): Promise<string> {
    // Try to extract serverId from tool name (format: mcp_${serverId}_${toolName})
    let serverId: string | null = null;
    let actualToolName = toolName;

    if (toolName.startsWith('mcp_')) {
      const parts = toolName.substring(4).split('_');
      if (parts.length >= 2) {
        let potentialServerId = parts[0];
        
        // Check if any server matches (directly, or if server ID has mcp_ prefix, without it)
        for (const connection of this.getAllServers()) {
          const serverIdFromConfig = connection.serverConfig.id;
          
          // Match: direct, or server has mcp_ prefix and matches without prefix
          const serverIdStripped = serverIdFromConfig.startsWith('mcp_') 
            ? serverIdFromConfig.substring(4)  // Remove 'mcp_' to get '848f563d'
            : serverIdFromConfig;
          
          if (serverIdFromConfig === potentialServerId || serverIdStripped === potentialServerId || serverIdFromConfig.endsWith(potentialServerId)) {
            serverId = serverIdFromConfig;
            actualToolName = parts.slice(1).join('_');
            if (process.env.ENZO_DEBUG === 'true') {
              console.log(`[MCPRegistry] Found server ${serverId} for tool ${toolName}, actual tool: ${actualToolName}, status: ${connection.connectionStatus}`);
            }
            break;
          }
        }
      }
    }

    if (!serverId && process.env.ENZO_DEBUG === 'true') {
      const parts = toolName.substring(4).split('_');
      const potentialServerId = parts[0];
      console.log(`[MCPRegistry] Server not found for tool ${toolName}, potential serverId: ${potentialServerId}`);
      console.log(`[MCPRegistry] Available servers:`, this.getAllServers().map(c => ({ id: c.serverConfig.id, status: c.connectionStatus })));
    }

    if (!serverId) {
      throw new Error(`Could not determine server for tool: ${toolName}`);
    }

    const connection = this.getServer(serverId);
    if (!connection) {
      throw new Error(`Server "${serverId}" not found or not connected`);
    }

    return await connection.callTool(actualToolName, input, taskContext);
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
    const allServers = this.getAllServers();
    const connectedServers = this.getConnectedServers();

    console.log(`[MCPRegistry] getMCPToolsForOrchestrator: ${allServers.length} total servers, ${connectedServers.length} connected`);
    
    if (allServers.length > 0 && connectedServers.length === 0) {
      console.log('[MCPRegistry] Servers exist but none are connected. Server states:');
      allServers.forEach(s => {
        console.log(`  - ${s.serverConfig.name} (${s.serverConfig.id}): status=${s.connectionStatus}, enabled=${s.serverConfig.enabled}`);
      });
    }

    for (const connection of connectedServers) {
      for (const mcpTool of connection.toolList) {
        tools.push({
          name: `${connection.serverConfig.id}_${mcpTool.name}`,
          description: `[MCP: ${connection.serverConfig.name}] ${mcpTool.description}`,
          parameters: mcpTool.inputSchema || {},
        });
      }
    }

    return tools;
  }

  /**
   * Get the input schema for a specific MCP tool
   */
  getMCPToolSchema(toolName: string): any | null {
    if (!toolName.startsWith('mcp_')) return null;
    
    const parts = toolName.split('_');
    if (parts.length < 3) return null;
    
    const serverId = `mcp_${parts[1]}`;
    const actualToolName = parts.slice(2).join('_');
    
    const connection = this.getServer(serverId);
    if (!connection) return null;
    
    const tool = connection.toolList.find(t => t.name === actualToolName);
    return tool?.inputSchema || null;
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
