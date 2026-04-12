import { Message, Tool, LLMProvider } from '../providers/types.js';
import type { Subtask, DecompositionResult } from './Decomposer.js';
import type { AssistantProfile, UserProfile } from '../config/ConfigService.js';

export enum ComplexityLevel {
  SIMPLE = 'SIMPLE',
  MODERATE = 'MODERATE',
  COMPLEX = 'COMPLEX',
  AGENT = 'AGENT',
}

export interface Skill {
  id?: string;
  name: string;
  description: string;
  execute?(input: any): Promise<any>;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  assistantNameOverride?: string;
  personaOverride?: string;
  toneOverride?: string;
}

export type StepAction = 'tool' | 'skill' | 'mcp' | 'agent' | 'escalate' | 'none';

export interface Step {
  iteration: number;
  type: 'think' | 'act' | 'observe' | 'synthesize';
  action?: StepAction;
  target?: string;
  input?: string;
  output?: string;
  modelUsed: string;
}

export interface AmplifierInput {
  message: string;
  originalMessage?: string; // Original message before any translation or processing
  conversationId: string;
  userId: string;
  history: Message[];
  availableTools: Tool[];
  availableSkills: Skill[];
  availableAgents: AgentConfig[];
  classifiedLevel?: ComplexityLevel;
  /** User's preferred language (e.g., 'es', 'en'). Defaults to 'es'. */
  userLanguage?: string;
  selectedAgent?: AgentConfig;
  assistantProfile?: AssistantProfile;
  userProfile?: UserProfile;
  memoryBlock?: string;
  onProgress?: (step: Step) => void;
  decomposition?: {
    steps: Subtask[];
    originalMessage: string;
  };
}

export interface AmplifierResult {
  content: string;
  stepsUsed: Step[];
  modelsUsed: string[];
  toolsUsed: string[];
  injectedSkills: InjectedSkillUsage[];
  durationMs: number;
  complexityUsed?: string;
}

export interface InjectedSkillUsage {
  id: string;
  name: string;
  relevanceScore: number;
}

export interface AvailableCapabilities {
  tools: Tool[];
  skills: Skill[];
  agents: AgentConfig[];
  powerfulProvider?: LLMProvider;
}

export interface ResolvedAction {
  type: StepAction;
  target: string;
  reason: string;
  input: any;
}

export interface EscalationInput {
  subtask: string;
  context: string;
  preferredProvider: string;
}

export interface SubTask {
  id: string;
  description: string;
  dependsOn: string[];
  requiredLevel: ComplexityLevel;
  result?: string;
}

export interface DecomposedTask {
  original: string;
  subtasks: SubTask[];
}

export interface OrchestratorResponse {
  content: string;
  complexityUsed: ComplexityLevel;
  providerUsed: string;
  modelUsed: string;
  injectedSkills: InjectedSkillUsage[];
  subtasks?: SubTask[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd?: number;
  };
  durationMs: number;
}

export interface ClassificationResult {
  level: ComplexityLevel;
  reason: string;
}

export interface OrchestratorInput {
  message: string;
  originalMessage?: string; // Original message before any transformation
  conversationId: string;
  userId: string;
  source?: 'web' | 'telegram' | 'unknown';
  classifiedLevel?: ComplexityLevel;
  userLanguage?: string;
  agentId?: string;
  onProgress?: (step: Step) => void;
}

export const AVAILABLE_TOOLS = [
  {
    name: 'web_search',
    description: 'Search the internet for information',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from the filesystem',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'execute_command',
    description: 'Execute a shell command',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path where the file will be created' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'remember',
    description: 'Save important user information to memory for future conversations. Use proactively when user shares personal details, preferences, or important facts about themselves.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key (e.g., "nombre", "mascota", "profesion")' },
        value: { type: 'string', description: 'Information to save' },
      },
      required: ['key', 'value'],
    },
  },
];
