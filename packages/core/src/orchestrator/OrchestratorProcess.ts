import { Classifier } from './Classifier.js';
import { AmplifierLoop } from './AmplifierLoop.js';
import { CircuitOpenError } from '../providers/circuitBreaker.js';
import type { Message, Tool, LLMProvider } from '../providers/types.js';
import type { AssistantMessageMetadata, UsageStat } from '../memory/types.js';
import type { ConfigService, AssistantProfile, UserProfile } from '../config/ConfigService.js';
import type { SkillRegistry } from '../skills/SkillRegistry.js';
import type { Skill, AgentConfig, OrchestratorInput, OrchestratorResponse, AmplifierResult, ComplexityLevel } from './types.js';
import { ComplexityLevel as CL } from './types.js';
import { v4 as uuidv4 } from 'uuid';
import { estimateCostUsd } from './CostEstimator.js';
import { appendMcpToolsToToolList, resolveSkillsForOrchestrator } from './OrchestratorCapabilities.js';

/** Bound callbacks from Orchestrator — keeps process pipeline out of the class body. */
export type OrchestratorProcessBindings = {
  syncBaseProviderFromConfig(): void;
  loadHistory(conversationId: string): Promise<Message[]>;
  resolveSelectedAgent(agentId: string): Promise<AgentConfig | undefined>;
  resolveRuntimeProvider(selectedAgent?: AgentConfig): Promise<{ provider: LLMProvider; warning?: string }>;
  resolveAssistantProfile(
    configProfile: AssistantProfile | undefined,
    selectedAgent: AgentConfig | undefined
  ): AssistantProfile;
  buildUserProfileBlock(userId: string, profile: UserProfile): string;
  sanitizeMemoryBlock(memoryBlock: string, assistantName: string): string;
  getMemoryExtractor(): { buildMemoryBlock(userId: string): Promise<string> };
  getConfigService(): ConfigService | undefined;
  getToolRegistry(): { getToolDefinitions(): Tool[] };
  getMcpRegistry(): { getMCPToolsForOrchestrator(): Tool[] };
  getSkillRegistry(): SkillRegistry | undefined;
  getAvailableSkills(): Skill[];
  getAvailableAgents(): AgentConfig[];
  createAmplifierLoop(provider: LLMProvider): AmplifierLoop;
  getBaseProvider(): LLMProvider;
  resolveProvider(modelUsed: string): string;
  ensureConversation(conversationId: string, userId: string): Promise<void>;
  saveToMemory(
    conversationId: string,
    message: Message,
    modelUsed?: string,
    assistantMeta?: AssistantMessageMetadata
  ): Promise<void>;
  saveStats(stats: UsageStat): Promise<void>;
};

export async function executeOrchestratorProcess(
  b: OrchestratorProcessBindings,
  input: OrchestratorInput,
  startTime: number,
  requestId: string
): Promise<OrchestratorResponse> {
  b.syncBaseProviderFromConfig();

  const history = await b.loadHistory(input.conversationId);

  const configAssistantProfile = b.getConfigService()?.getAssistantProfile();
  const configUserProfile = b.getConfigService()?.getUserProfile();
  const selectedAgent = input.agentId ? await b.resolveSelectedAgent(input.agentId) : undefined;
  const { provider: runtimeProvider, warning: providerWarning } = await b.resolveRuntimeProvider(selectedAgent);
  const assistantProfile = b.resolveAssistantProfile(configAssistantProfile, selectedAgent);
  const userProfile = configUserProfile ?? {};

  const rawMemoryBlock = await b.getMemoryExtractor().buildMemoryBlock(input.userId);
  const memoryBlock = b.sanitizeMemoryBlock(rawMemoryBlock, assistantProfile.name);
  const profileBlock = b.buildUserProfileBlock(input.userId, userProfile);
  const systemBlocks = [profileBlock, memoryBlock].filter(Boolean) as string[];
  const historyWithMemory =
    systemBlocks.length > 0
      ? [{ role: 'system' as const, content: systemBlocks.join('\n\n') }, ...history]
      : history;

  if (memoryBlock) {
    console.log(`[Orchestrator] Injecting memory block for user ${input.userId}`);
  }

  const classifyStart = Date.now();
  const classification = input.classifiedLevel
    ? { level: input.classifiedLevel, reason: 'pre-classified' }
    : await new Classifier(runtimeProvider).classify(input.message, historyWithMemory);
  const classifyDurationMs = Date.now() - classifyStart;
  console.log(`[Orchestrator] Message classified as: ${classification.level}`);

  const tools: Tool[] = b.getToolRegistry().getToolDefinitions();
  const mcpTools = b.getMcpRegistry().getMCPToolsForOrchestrator();
  if (mcpTools.length > 0) {
    console.log(
      `[Orchestrator] Adding ${mcpTools.length} MCP tool(s) to available tools: ${mcpTools.map((tool) => tool.name).join(', ')}`
    );
  }
  appendMcpToolsToToolList(tools, mcpTools);

  const skills = resolveSkillsForOrchestrator(b.getSkillRegistry(), b.getAvailableSkills());
  const agents = b.getAvailableAgents();

  const defaultRuntimeHints = {
    homeDir: process.env.HOME,
    osLabel: process.platform === 'darwin' ? 'macOS' : process.platform,
    timeLocale: 'es-CL',
    timeZone: 'America/Santiago',
  } as const;
  const runtimeHints = { ...defaultRuntimeHints, ...(input.runtimeHints ?? {}) };

  const toolExecutionContext = {
    userId: input.userId,
    requestId,
    source: input.source,
    conversationId: input.conversationId,
    ...input.toolExecutionContext,
  };

  let amplifierResult: AmplifierResult;
  const runtimeAmplifierLoop = b.createAmplifierLoop(runtimeProvider);
  try {
    amplifierResult = await runtimeAmplifierLoop.amplify({
      requestId,
      message: input.message,
      originalMessage: input.originalMessage,
      conversationId: input.conversationId,
      userId: input.userId,
      history: historyWithMemory,
      memoryBlock,
      availableTools: tools,
      availableSkills: skills,
      availableAgents: agents,
      selectedAgent,
      assistantProfile,
      userProfile,
      classifiedLevel: classification.level,
      userLanguage: input.userLanguage ?? 'es',
      onProgress: input.onProgress,
      runtimeHints,
      toolExecutionContext,
    });
  } catch (amplifierError) {
    console.error('[Orchestrator] AmplifierLoop error:', amplifierError);
    if (amplifierError instanceof CircuitOpenError && runtimeProvider !== b.getBaseProvider()) {
      console.warn(`[Orchestrator] Circuit open for "${runtimeProvider.name}". Retrying with base provider.`);
      const fallbackLoop = b.createAmplifierLoop(b.getBaseProvider());
      amplifierResult = await fallbackLoop.amplify({
        requestId,
        message: input.message,
        originalMessage: input.originalMessage,
        conversationId: input.conversationId,
        userId: input.userId,
        history: historyWithMemory,
        memoryBlock,
        availableTools: tools,
        availableSkills: skills,
        availableAgents: agents,
        selectedAgent,
        assistantProfile,
        userProfile,
        classifiedLevel: classification.level,
        userLanguage: input.userLanguage ?? 'es',
        onProgress: input.onProgress,
        runtimeHints,
        toolExecutionContext,
      });
    } else {
      const errorMsg = amplifierError instanceof Error ? amplifierError.message : String(amplifierError);
      return {
        content: `Tuve un problema procesando tu solicitud: ${errorMsg}. ¿Puedes intentarlo de nuevo?`,
        requestId,
        complexityUsed: CL.SIMPLE,
        providerUsed: 'fallback',
        modelUsed: 'none',
        injectedSkills: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        durationMs: Date.now() - startTime,
      };
    }
  }

  const assistantContent = providerWarning ? `${providerWarning}\n\n${amplifierResult.content}` : amplifierResult.content;
  const durationMs = Date.now() - startTime;
  const complexityUsed = (amplifierResult.complexityUsed as ComplexityLevel) || CL.MODERATE;
  const modelUsed = amplifierResult.modelsUsed[0] || runtimeProvider.model;

  const assistantMeta: AssistantMessageMetadata = {
    modelUsed,
    complexityUsed,
    durationMs,
    injectedSkills: amplifierResult.injectedSkills,
  };

  await b.ensureConversation(input.conversationId, input.userId);

  await b.saveToMemory(input.conversationId, { role: 'user', content: input.message });
  await b.saveToMemory(input.conversationId, { role: 'assistant', content: assistantContent }, modelUsed, assistantMeta);

  const providerUsed = runtimeProvider.name || b.resolveProvider(modelUsed);
  const source = input.source || 'unknown';

  const inputTokens = Math.ceil(input.message.length / 4);
  const outputTokens = Math.ceil(amplifierResult.content.length / 4);
  const estimatedCostUsd = estimateCostUsd({
    provider: providerUsed,
    model: modelUsed,
    inputTokens,
    outputTokens,
  });
  const statsToolsUsed = new Set<string>(amplifierResult.toolsUsed);
  for (const skill of amplifierResult.injectedSkills) {
    statsToolsUsed.add(`skill:${skill.name}`);
  }

  const stats: UsageStat = {
    id: uuidv4(),
    requestId,
    conversationId: input.conversationId,
    userId: input.userId,
    source,
    provider: providerUsed,
    model: modelUsed,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    durationMs,
    stageMetrics: {
      classify: {
        count: 1,
        errorCount: 0,
        totalDurationMs: classifyDurationMs,
        maxDurationMs: classifyDurationMs,
      },
      ...(amplifierResult.stageMetrics || {}),
    },
    toolsUsed: Array.from(statsToolsUsed),
    complexityLevel: complexityUsed,
    createdAt: Date.now(),
  };
  await b.saveStats(stats);

  return {
    content: assistantContent,
    requestId,
    complexityUsed,
    providerUsed,
    modelUsed,
    injectedSkills: amplifierResult.injectedSkills,
    usage: {
      inputTokens,
      outputTokens,
      estimatedCostUsd,
    },
    durationMs,
  };
}
