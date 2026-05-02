import { Message, Tool, LLMProvider } from '../providers/types.js';
import type { Subtask, DecompositionResult } from './Decomposer.js';
import type { AssistantProfile, UserProfile } from '../config/ConfigService.js';
import type { RelevantSkill } from './SkillResolver.js';
import type { ConversationContext } from '../memory/ConversationContext.js';

export type { ConversationContext } from '../memory/ConversationContext.js';

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

export type StepAction = 'tool' | 'skill' | 'mcp' | 'agent' | 'escalate' | 'none' | 'delegate';

/** Built-in specialist ids; THINK may also delegate to user-preset UUIDs resolved by {@link AgentRouter}. */
export const DELEGATION_AGENT_IDS = ['claude_code', 'doc_agent', 'vision_agent'] as const;
export type DelegationAgentId = (typeof DELEGATION_AGENT_IDS)[number];

/**
 * JSON actions the amplifer THINK phase may emit (parsed by CapabilityResolver).
 * The loop may still use `action: "none"` for "enough information" in prompts.
 */
export type AmplifierAction =
  | { action: 'tool'; tool: string; input: Record<string, unknown> }
  | { action: 'delegate'; agent: string; task: string; reason: string }
  | { action: 'respond'; content: string };

export interface Step {
  iteration: number;
  type: 'think' | 'act' | 'observe' | 'synthesize' | 'verify';
  requestId?: string;
  action?: StepAction;
  target?: string;
  input?: string;
  output?: string;
  durationMs?: number;
  status?: 'ok' | 'error';
  modelUsed: string;
}

export interface StageMetricsSnapshot {
  count: number;
  errorCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

export type StageMetrics = Record<'think' | 'act' | 'observe' | 'synthesize' | 'verify', StageMetricsSnapshot>;

export interface AmplifierInput {
  message: string;
  originalMessage?: string; // Original message before any translation or processing
  requestId?: string;
  conversationId: string;
  userId: string;
  history: Message[];
  availableTools: Tool[];
  availableSkills: Skill[];
  /**
   * User-defined conversational presets ({@link AgentConfig}): provider/model and optional persona overrides.
   * Distinct from {@link DELEGATION_AGENT_IDS}: specialists are invoked only via THINK JSON `delegate`.
   * Passed through for components that need the catalog (e.g. intent analysis); {@link CapabilityResolver}
   * does not use this list to validate delegation targets.
   */
  availableAgents: AgentConfig[];
  classifiedLevel?: ComplexityLevel;
  /** User's preferred language (e.g., 'es', 'en'). Defaults to 'es'. */
  userLanguage?: string;
  selectedAgent?: AgentConfig;
  assistantProfile?: AssistantProfile;
  userProfile?: UserProfile;
  memoryBlock?: string;
  /** Structured user memories (from recall) for delegation and prompts. */
  userMemories?: Array<{ key: string; value: string }>;
  onProgress?: (step: Step) => void;
  /**
   * Host context so the model can choose CLI commands/paths for the machine running Enzo
   * (prefer this over branching on OS in application code).
   */
  runtimeHints?: {
    homeDir?: string;
    /** e.g. "Linux", "macOS"; use with hostPlatform */
    osLabel?: string;
    timeLocale?: string;
    timeZone?: string;
    /** Node process.platform where Enzo runs */
    hostPlatform?: NodeJS.Platform;
    /** False on Windows CMD/PowerShell default; affects prompt wording */
    posixShell?: boolean;
    /** e.g. uname release on Unix */
    kernelRelease?: string;
    /** process.arch */
    arch?: string;
  };
  decomposition?: {
    steps: Subtask[];
    originalMessage: string;
  };
  /** When set (e.g. by AmplifierLoop), THINK skips re-resolving skills against `message`. */
  resolvedSkills?: RelevantSkill[];
  /** From classifier: skip fast path and bias THINK toward delegating to this catalog agent when set. */
  delegationHint?: DelegationHint;
  /** Image bytes for vision delegation (e.g. Telegram when local Ollama cannot see). */
  imageContext?: { base64: string; mimeType: string };
  /** Token-budgeted continuity (recent turns + rolling summary + flow hints). */
  conversation?: ConversationContext;
}

export interface AmplifierResult {
  content: string;
  requestId?: string;
  stepsUsed: Step[];
  modelsUsed: string[];
  toolsUsed: string[];
  injectedSkills: InjectedSkillUsage[];
  durationMs: number;
  stageMetrics?: StageMetrics;
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
  /**
   * Mirrors {@link AmplifierInput.availableAgents}. THINK may delegate to built-in ids or user-preset ids;
   * {@link CapabilityResolver} does not validate agent ids (routing is handled in {@link AgentRouter}).
   */
  agents: AgentConfig[];
  powerfulProvider?: LLMProvider;
}

export type ResolvedAction =
  | {
      type: 'delegate';
      /** Agent id to delegate to (e.g. claude_code, doc_agent). */
      target: string;
      reason: string;
      input: { task: string };
    }
  | {
      type: Exclude<StepAction, 'delegate'>;
      target: string;
      reason: string;
      input: any;
    };

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
  requestId?: string;
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

/** Optional classifier hint: a catalog agent may handle the turn better than plain chat (see Classifier LLM JSON). */
export interface DelegationHint {
  /** User-preset id (UUID) or built-in specialist: claude_code | doc_agent | vision_agent */
  agentId?: string;
  reason: string;
}

export interface ClassificationResult {
  level: ComplexityLevel;
  reason: string;
  /** Set when a heuristic or caller hints a primary tool (e.g. web_search for factual fast-path). */
  suggestedTool?: 'web_search' | 'calendar';
  /**
   * When set, {@link AmplifierLoop} skips SIMPLE/MODERATE fast path so THINK can delegate to a catalog agent.
   */
  delegationHint?: DelegationHint;
  /**
   * How complexity was determined: heuristic name, llm, llm_always bypass, fallback, or pre-classified caller.
   * Logged by orchestrator for observability (see ENZO routing plan).
   */
  classifierBranch?: string;
}

export interface OrchestratorInput {
  message: string;
  originalMessage?: string; // Original message before any transformation
  requestId?: string;
  conversationId: string;
  userId: string;
  source?: 'web' | 'telegram' | 'unknown' | 'echo';
  classifiedLevel?: ComplexityLevel;
  userLanguage?: string;
  agentId?: string;
  onProgress?: (step: Step) => void;
  /** Passed through to AmplifierInput when present; else process() supplies env defaults. */
  runtimeHints?: AmplifierInput['runtimeHints'];
  /** Passed through to AmplifierInput for vision_agent delegation. */
  imageContext?: { base64: string; mimeType: string };
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
        userId: { type: 'string', description: 'User id owner of this memory' },
      },
      required: ['key', 'value', 'userId'],
    },
  },
  {
    name: 'recall',
    description: 'Search the user\'s saved memories using a natural-language query. Use when the user asks what they have pending, captured, or said before.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language search query' },
        project: { type: 'string', description: 'Optional project filter (substring match on memory value)' },
        key: { type: 'string', description: 'Optional memory key filter (e.g., "projects", "other")' },
        userId: { type: 'string', description: 'User id owner of the memories' },
      },
      required: ['query', 'userId'],
    },
  },
];
