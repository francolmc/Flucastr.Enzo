#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn, ChildProcess } from 'node:child_process';
import process from 'node:process';

interface ClaudeCodeSession {
  id: string;
  process: ChildProcess;
  active: boolean;
  createdAt: Date;
}

class ClaudeCodeMCPServer {
  private server: Server;
  private sessions: Map<string, ClaudeCodeSession> = new Map();

  constructor() {
    this.server = new Server({
      name: 'claude-code-mcp-server',
      version: '1.0.0',
    });

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error: Error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'claude_code_execute',
          description: 'Execute a command in Claude Code with context and return results',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The prompt to send to Claude Code',
              },
              context: {
                type: 'string',
                description: 'Additional context (files, variables, etc.)',
              },
              working_directory: {
                type: 'string',
                description: 'Working directory for the command',
              },
              session_id: {
                type: 'string',
                description: 'Session ID for continuous conversation (optional)',
              },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'claude_code_create_session',
          description: 'Create a new Claude Code session for continuous work',
          inputSchema: {
            type: 'object',
            properties: {
              working_directory: {
                type: 'string',
                description: 'Working directory for the session',
              },
            },
            required: ['working_directory'],
          },
        },
        {
          name: 'claude_code_end_session',
          description: 'End a Claude Code session and clean up resources',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Session ID to end',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'claude_code_get_status',
          description: 'Get status of active Claude Code sessions',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'claude_code_iterate_development',
          description: 'Iterative development with Claude Code based on user stories',
          inputSchema: {
            type: 'object',
            properties: {
              user_story: {
                type: 'string',
                description: 'User story to implement',
              },
              acceptance_criteria: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of acceptance criteria',
              },
              max_iterations: {
                type: 'number',
                description: 'Maximum number of iterations (default: 5)',
              },
              working_directory: {
                type: 'string',
                description: 'Working directory for development',
              },
            },
            required: ['user_story', 'acceptance_criteria'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'claude_code_execute':
            return await this.handleClaudeCodeExecute(args);
          case 'claude_code_create_session':
            return await this.handleCreateSession(args);
          case 'claude_code_end_session':
            return await this.handleEndSession(args);
          case 'claude_code_get_status':
            return await this.handleGetStatus();
          case 'claude_code_iterate_development':
            return await this.handleIterativeDevelopment(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
      }
    });
  }

  private async handleClaudeCodeExecute(args: any): Promise<any> {
    const { prompt, context, working_directory, session_id } = args;

    try {
      const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;
      
      // Use existing session or create temporary one
      let sessionId = session_id;
      if (!sessionId) {
        sessionId = await this.createSession(working_directory || process.cwd());
      }

      const result = await this.executeInSession(sessionId, fullPrompt);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              session_id: sessionId,
              result: result,
              timestamp: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              timestamp: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    }
  }

  private async handleCreateSession(args: any): Promise<any> {
    const { working_directory } = args;
    
    try {
      const sessionId = await this.createSession(working_directory);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              session_id: sessionId,
              working_directory: working_directory,
              created_at: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          },
        ],
      };
    }
  }

  private async handleEndSession(args: any): Promise<any> {
    const { session_id } = args;
    
    try {
      await this.endSession(session_id);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              session_id: session_id,
              ended_at: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          },
        ],
      };
    }
  }

  private async handleGetStatus(): Promise<any> {
    const activeSessions = Array.from(this.sessions.entries()).map(([id, session]) => ({
      id,
      active: session.active,
      created_at: session.createdAt.toISOString(),
      pid: session.process.pid,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            active_sessions: activeSessions,
            total_sessions: this.sessions.size,
            timestamp: new Date().toISOString(),
          }, null, 2),
        },
      ],
    };
  }

  private async handleIterativeDevelopment(args: any): Promise<any> {
    const { 
      user_story, 
      acceptance_criteria, 
      max_iterations = 5, 
      working_directory 
    } = args;

    try {
      const sessionId = await this.createSession(working_directory || process.cwd());
      const results = [];

      for (let iteration = 1; iteration <= max_iterations; iteration++) {
        const iterationPrompt = `
Iteration ${iteration}/${max_iterations}

User Story: ${user_story}

Acceptance Criteria:
${acceptance_criteria.map((criteria: string, index: number) => `${index + 1}. ${criteria}`).join('\n')}

${iteration > 1 ? `Previous iterations results:\n${results.map(r => r.result).join('\n---\n')}` : ''}

Please implement or improve the functionality to meet the acceptance criteria. 
Focus on:
1. Code quality and best practices
2. Testing and validation
3. Documentation
4. Error handling

If all acceptance criteria are met, indicate "COMPLETED" and provide a summary.
If not, continue with improvements and specify what still needs work.
`;

        const result = await this.executeInSession(sessionId, iterationPrompt);
        results.push({
          iteration,
          result,
          timestamp: new Date().toISOString(),
        });

        // Check if completed
        if (result.includes('COMPLETED')) {
          break;
        }
      }

      await this.endSession(sessionId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              user_story,
              acceptance_criteria,
              iterations: results,
              total_iterations: results.length,
              completed: results[results.length - 1]?.result?.includes('COMPLETED') || false,
              timestamp: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              timestamp: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    }
  }

  private async createSession(workingDirectory: string): Promise<string> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const claudeProcess = spawn('claude-code', [], {
      cwd: workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session: ClaudeCodeSession = {
      id: sessionId,
      process: claudeProcess,
      active: true,
      createdAt: new Date(),
    };

    this.sessions.set(sessionId, session);

    // Handle process errors
    claudeProcess.on('error', (error: Error) => {
      console.error(`Claude Code process error for session ${sessionId}:`, error);
      session.active = false;
    });

    claudeProcess.on('exit', (code: number | null) => {
      console.log(`Claude Code process exited for session ${sessionId} with code ${code}`);
      session.active = false;
      this.sessions.delete(sessionId);
    });

    return sessionId;
  }

  private async executeInSession(sessionId: string, prompt: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    
    if (!session || !session.active) {
      throw new Error(`Session ${sessionId} not found or inactive`);
    }

    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      session.process.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      session.process.stderr?.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      // Send prompt to Claude Code
      session.process.stdin?.write(prompt + '\n');

      // Wait for response (simple timeout-based approach)
      setTimeout(() => {
        if (errorOutput) {
          reject(new Error(errorOutput));
        } else {
          resolve(output || 'No output received');
        }
      }, 30000); // 30 second timeout
    });
  }

  private async endSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    
    if (session) {
      session.process.kill('SIGTERM');
      session.active = false;
      this.sessions.delete(sessionId);
    }
  }

  private async cleanup(): Promise<void> {
    for (const [sessionId] of this.sessions) {
      await this.endSession(sessionId);
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Claude Code MCP server running on stdio');
  }
}

const server = new ClaudeCodeMCPServer();
server.run().catch((error: Error) => console.error(error));
