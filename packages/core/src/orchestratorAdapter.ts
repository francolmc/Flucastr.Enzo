import { createPlanner, createModelClient, createMemory, type Planner, type ExecutionContext, type PlannerResponse, type Memory, type ConversationMemory } from './index.js';
import { createMcpRegistry, type McpRegistry } from './mcp/registry.js';
import { loadConfig, type McpServerConfig } from './config.js';
import { createConversationMemory } from './memory/conversation.js';

export interface Orchestrator {
  process(input: OrchestratorInput): Promise<OrchestratorResponse>;
  classifyDetailed(message: string, userId: string, conversationId?: string, source?: string): Promise<ClassificationResult>;
  getMCPRegistry(): McpRegistry;
  getMemoryExtractor(): MemoryExtractor;
}

export interface OrchestratorInput {
  message: string;
  originalMessage?: string;
  conversationId?: string;
  userId: string;
  source?: string;
  agentId?: string;
  requestId?: string;
  userLanguage?: string;
  runtimeHints?: Record<string, unknown>;
  onProgress?: (step: Step) => void;
}

export interface OrchestratorResponse {
  content: string;
  complexityUsed?: string;
  providerUsed?: string;
  modelUsed?: string;
  injectedSkills?: string[];
  durationMs?: number;
  usage?: Record<string, unknown>;
  requestId?: string;
}

export interface ClassificationResult {
  level: 'simple' | 'moderate' | 'complex';
  reason: string;
  prefersHostTools?: boolean;
  suppressSimpleModerateFastPath?: boolean;
  delegationHint?: { agentId?: string; reason: string };
  classifierBranch: string;
}

export interface Step {
  type: 'think' | 'act' | 'observe' | 'delegate';
  requestId?: string;
  action?: string;
  target?: string;
  input?: string;
  output?: string;
  durationMs?: number;
  status?: string;
  modelUsed?: string;
}

export interface MemoryExtractor {
  extractAndSave(userId: string, message: string, response: string): Promise<void>;
}

export interface MemoryService {
  createConversation(userId: string): Promise<string>;
  getHistoryWithMetadata(conversationId: string): Promise<unknown[]>;
  getConversations(userId: string, limit?: number): Promise<unknown[]>;
  deleteConversation(conversationId: string): Promise<void>;
  save(userMessage: string, enzoResponse: string): void;
  getRelevant(currentMessage: string, maxTurns?: number): string;
  getRelevantForUnderstand(currentMessage: string): string;
  getLastTurnResults(): string[];
}

function buildExecutionContext(
  understandContext: string | undefined,
  conversationContext: string | undefined,
  previousResults: string[]
): ExecutionContext {
  return {
    understandContext: understandContext ?? '',
    conversationContext: conversationContext ?? '',
    previousResults,
  };
}

export { buildExecutionContext };

export function createOrchestrator(
  ollamaBaseUrl: string,
  primaryModel: string,
  dbPath: string,
  mcpServers: McpServerConfig[]
): Orchestrator {
  const config = loadConfig();
  const model = createModelClient(config);

  const memory = createMemory(config) as Memory & ConversationMemory;
  const conversationMemory = createConversationMemory();

  let mcpRegistry: McpRegistry | null = null;

  const getOrCreateMcpRegistry = async (): Promise<McpRegistry> => {
    if (!mcpRegistry) {
      mcpRegistry = await createMcpRegistry(mcpServers, memory);
    }
    return mcpRegistry;
  };

  const plannerCache: Map<string, { planner: Planner; mcp: McpRegistry }> = new Map();

  const getPlannerForUser = async (userId: string): Promise<{ planner: Planner; mcp: McpRegistry }> => {
    const cached = plannerCache.get(userId);
    if (cached) return cached;

    const mcp = await getOrCreateMcpRegistry();
    const planner = createPlanner(model, memory, mcp);
    plannerCache.set(userId, { planner, mcp });
    return { planner, mcp };
  };

  return {
    async process(input: OrchestratorInput): Promise<OrchestratorResponse> {
      const { planner } = await getPlannerForUser(input.userId);

      const understandContext = conversationMemory.getRelevantForUnderstand(input.message);
      const conversationContext = conversationMemory.getRelevant(input.message);
      const lastTurnResults = conversationMemory.getLastTurnResults();

      const executionContext = buildExecutionContext(
        understandContext,
        conversationContext,
        lastTurnResults
      );

      const result: PlannerResponse = await planner.resolve(
        input.message,
        input.userId,
        executionContext,
        false
      );

      conversationMemory.save(input.message, result.content);

      return {
        content: result.content,
        requestId: input.requestId,
      };
    },

    async classifyDetailed(
      message: string,
      userId: string,
      conversationId?: string,
      source?: string
    ): Promise<ClassificationResult> {
      return {
        level: 'simple',
        reason: 'Core-v2 uses simple classification',
        classifierBranch: 'simple',
      };
    },

    getMCPRegistry(): McpRegistry {
      if (!mcpRegistry) {
        throw new Error('MCP registry not initialized');
      }
      return mcpRegistry;
    },

    getMemoryExtractor(): MemoryExtractor {
      return {
        async extractAndSave(userId: string, message: string, response: string): Promise<void> {
        },
      };
    },
  };
}

export function createInMemoryMemoryService(): MemoryService {
  const turns: Array<{ userMessage: string; enzoResponse: string; timestamp: number }> = [];
  const conversations: Array<{ id: string; userId: string; createdAt: number }> = [];

  function extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .map(w => w.replace(/[^a-záéíóúñ]/g, ''))
      .filter(w => w.length > 3);
  }

  return {
    async createConversation(userId: string): Promise<string> {
      const id = `conv-${Date.now()}`;
      conversations.push({ id, userId, createdAt: Date.now() });
      return id;
    },

    async getHistoryWithMetadata(conversationId: string): Promise<unknown[]> {
      return [];
    },

    async getConversations(userId: string, limit = 20): Promise<unknown[]> {
      return conversations
        .filter(c => c.userId === userId)
        .slice(-limit)
        .map(c => ({ id: c.id, createdAt: c.createdAt, updatedAt: c.createdAt }));
    },

    async deleteConversation(conversationId: string): Promise<void> {
      const idx = conversations.findIndex(c => c.id === conversationId);
      if (idx >= 0) conversations.splice(idx, 1);
    },

    save(userMessage: string, enzoResponse: string): void {
      turns.push({
        userMessage,
        enzoResponse,
        timestamp: Date.now(),
      });
      if (turns.length > 20) turns.shift();
    },

    getRelevant(currentMessage: string, maxTurns = 3): string {
      if (turns.length === 0) return '';

      const lastTurn = turns[turns.length - 1];
      const currentKeywords = new Set(extractKeywords(currentMessage));

      const previous = turns.slice(0, -1);
      const scored = previous
        .map(t => {
          const keywords = extractKeywords(t.userMessage + ' ' + t.enzoResponse);
          const matches = keywords.filter(k => currentKeywords.has(k)).length;
          return { turn: t, score: matches / Math.max(currentKeywords.size, 1) };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxTurns - 1)
        .map(x => x.turn);

      const selected = [...scored, lastTurn];
      return selected
        .map(t => `User: ${t.userMessage}\nEnzo: ${t.enzoResponse}`)
        .join('\n\n');
    },

    getRelevantForUnderstand(currentMessage: string): string {
      if (turns.length === 0) return '';
      const recent = turns.slice(-2);
      return recent.map(t => `User: ${t.userMessage}`).join('\n');
    },

    getLastTurnResults(): string[] {
      if (turns.length === 0) return [];
      return [turns[turns.length - 1].enzoResponse];
    },
  };
}