import { OllamaProvider } from '../providers/OllamaProvider.js';
import { AnthropicProvider } from '../providers/AnthropicProvider.js';
import { OpenAIProvider } from '../providers/OpenAIProvider.js';
import { GeminiProvider } from '../providers/GeminiProvider.js';
import { Message, Tool, LLMProvider } from '../providers/types.js';
import { Classifier } from './Classifier.js';
import { AmplifierLoop } from './AmplifierLoop.js';
import { MemoryService } from '../memory/MemoryService.js';
import { MemoryExtractor } from '../memory/MemoryExtractor.js';
import { ToolRegistry, ExecutableTool, createDefaultToolRegistry } from '../tools/index.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { MCPRegistry } from '../mcp/index.js';
import { ConfigService, AssistantProfile, UserProfile } from '../config/ConfigService.js';
import { UsageStat, AssistantMessageMetadata } from '../memory/types.js';
import {
  ComplexityLevel,
  OrchestratorInput,
  OrchestratorResponse,
  AVAILABLE_TOOLS,
  AmplifierResult,
  Skill,
  AgentConfig,
} from './types.js';
import { v4 as uuidv4 } from 'uuid';
import { estimateCostUsd } from './CostEstimator.js';
import { parseFirstJsonObject } from '../utils/StructuredJson.js';

export class Orchestrator {
  private classifier: Classifier;
  private baseProvider: LLMProvider;
  private ollamaProvider: OllamaProvider;
  private memoryService: MemoryService;
  private memoryExtractor: MemoryExtractor;
  private toolRegistry: ToolRegistry;
  private skillRegistry?: SkillRegistry;
  private configService?: ConfigService;
  private mcpRegistry: MCPRegistry;
  private providerCache: Map<string, LLMProvider>;
  private agentConfig: Map<string, any>;
  private availableSkills: Skill[];
  private availableAgents: AgentConfig[];

  constructor(
    ollamaProvider: OllamaProvider,
    anthropicProvider?: AnthropicProvider,
    memoryService?: MemoryService,
    options?: { toolRegistry?: ToolRegistry; agentConfig?: Map<string, any>; skillRegistry?: SkillRegistry; configService?: ConfigService },
  ) {
    this.baseProvider = ollamaProvider;
    this.ollamaProvider = ollamaProvider;
    this.providerCache = new Map();
    this.agentConfig = options?.agentConfig || new Map();
    this.availableSkills = [];
    this.availableAgents = [];
    this.skillRegistry = options?.skillRegistry;
    this.configService = options?.configService;

    // Initialize memory service if not provided
    if (!memoryService) {
      memoryService = new MemoryService();
    }
    this.memoryService = memoryService;

    // Initialize tool registry if not provided
    let toolRegistry = options?.toolRegistry;
    if (!toolRegistry) {
      toolRegistry = createDefaultToolRegistry(this.memoryService, undefined, this.configService);
    }
    this.toolRegistry = toolRegistry;

    // Initialize MCP Registry
    this.mcpRegistry = new MCPRegistry(this.memoryService);

    this.memoryExtractor = new MemoryExtractor(this.baseProvider, this.memoryService);
    
    this.classifier = new Classifier(this.baseProvider);

    // Load MCP servers if auto-connect is enabled
    console.log(`[Orchestrator] MCP_AUTO_CONNECT: ${process.env.MCP_AUTO_CONNECT}`);
    if (process.env.MCP_AUTO_CONNECT === 'true') {
      console.log('[Orchestrator] Auto-loading MCP servers from persistence...');
      this.mcpRegistry.loadServersFromMemory().catch(err => {
        console.error('[Orchestrator] Failed to auto-load MCP servers:', err);
      });
    } else {
      console.log('[Orchestrator] MCP auto-load disabled. Enable with MCP_AUTO_CONNECT=true');
    }
  }

  setAvailableSkills(skills: Skill[]): void {
    this.availableSkills = skills;
  }

  setAvailableAgents(agents: AgentConfig[]): void {
    this.availableAgents = agents;
  }

  getMCPRegistry(): MCPRegistry {
    return this.mcpRegistry;
  }

  getBaseProvider(): LLMProvider {
    return this.baseProvider;
  }

  getMemoryExtractor(): MemoryExtractor {
    return this.memoryExtractor;
  }

  async classify(message: string, userId: string): Promise<ComplexityLevel> {
    this.syncBaseProviderFromConfig();
    const history = await this.loadHistory(`telegram_${userId}`);
    const classification = await this.classifier.classify(message, history);
    console.log(`[Orchestrator] classify() - Message classified as: ${classification.level}`);
    return classification.level;
  }

  async process(input: OrchestratorInput): Promise<OrchestratorResponse> {
    const startTime = Date.now();

    try {
      this.syncBaseProviderFromConfig();

      // Step 1: Load history from memory
      const history = await this.loadHistory(input.conversationId);

      const configAssistantProfile = this.configService?.getAssistantProfile();
      const configUserProfile = this.configService?.getUserProfile();
      const selectedAgent = input.agentId
        ? await this.resolveSelectedAgent(input.agentId)
        : undefined;
      const { provider: runtimeProvider, warning: providerWarning } = await this.resolveRuntimeProvider(selectedAgent);
      const assistantProfile = this.resolveAssistantProfile(configAssistantProfile, selectedAgent);
      const userProfile = configUserProfile ?? {};

      // Step 1.5: Build memory block for user context and inject into history
      const rawMemoryBlock = await this.memoryExtractor.buildMemoryBlock(input.userId);
      const memoryBlock = this.sanitizeMemoryBlock(rawMemoryBlock, assistantProfile.name);
      const profileBlock = this.buildUserProfileBlock(input.userId, userProfile);
      const systemBlocks = [profileBlock, memoryBlock].filter(Boolean) as string[];
      const historyWithMemory = systemBlocks.length > 0
        ? [{ role: 'system' as const, content: systemBlocks.join('\n\n') }, ...history]
        : history;
      
      if (memoryBlock) {
        console.log(`[Orchestrator] Injecting memory block for user ${input.userId}`);
      }

      // Step 2: Classify the message complexity (use historyWithMemory so memory context is visible)
      const classification = input.classifiedLevel
        ? { level: input.classifiedLevel, reason: 'pre-classified' }
        : await new Classifier(runtimeProvider).classify(input.message, historyWithMemory);
      console.log(`[Orchestrator] Message classified as: ${classification.level}`);

      // Step 3: Resolve available capabilities
      const tools: Tool[] = AVAILABLE_TOOLS;
      
      // Add MCP tools to the available tools
      const mcpTools = this.mcpRegistry.getMCPToolsForOrchestrator();
      if (mcpTools.length > 0) {
        console.log(
          `[Orchestrator] Adding ${mcpTools.length} MCP tool(s) to available tools: ${mcpTools
            .map((tool) => tool.name)
            .join(', ')}`
        );
        tools.push(...mcpTools);
      }
      
      // Prefer enabled skills from SkillRegistry so all channels use the same source of truth.
      const allowAllSkillsFallback = (process.env.ENZO_SKILLS_FALLBACK_ALL_WHEN_NONE_ENABLED ?? 'true').toLowerCase() !== 'false';
      const registrySkillsRaw = this.skillRegistry
        ? this.skillRegistry.getEnabled()
        : [];
      const skillsSource = this.skillRegistry
        ? (registrySkillsRaw.length > 0
            ? registrySkillsRaw
            : (allowAllSkillsFallback ? this.skillRegistry.getAll() : []))
        : [];
      const registrySkills: Skill[] = skillsSource
        .map((skill) => ({
            id: skill.id,
            name: skill.metadata.name,
            description: skill.metadata.description,
          }));
      const skills = registrySkills.length > 0 ? registrySkills : this.availableSkills;
      const agents = this.availableAgents;

      // Step 4: Run AmplifierLoop with all capabilities and classified level
      let amplifierResult: AmplifierResult;
      const runtimeAmplifierLoop = this.createAmplifierLoop(runtimeProvider);
      try {
        amplifierResult = await runtimeAmplifierLoop.amplify({
          message: input.message,
          originalMessage: input.originalMessage,
          conversationId: input.conversationId,
          userId: input.userId,
          history: historyWithMemory,
          memoryBlock, // Still passed for backward compatibility, but not needed in messages
          availableTools: tools,
          availableSkills: skills,
          availableAgents: agents,
          selectedAgent,
          assistantProfile,
          userProfile,
          classifiedLevel: classification.level,
          userLanguage: input.userLanguage ?? 'es',
          onProgress: input.onProgress,
        });
      } catch (amplifierError) {
        console.error('[Orchestrator] AmplifierLoop error:', amplifierError);
        // Return a user-friendly error message
        const errorMsg = amplifierError instanceof Error ? amplifierError.message : String(amplifierError);
        return {
          content: `Tuve un problema procesando tu solicitud: ${errorMsg}. ¿Puedes intentarlo de nuevo?`,
          complexityUsed: ComplexityLevel.SIMPLE,
          providerUsed: 'fallback',
          modelUsed: 'none',
          injectedSkills: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          durationMs: Date.now() - startTime,
        };
      }

      // Step 5: Save to memory
      const assistantContent = providerWarning
        ? `${providerWarning}\n\n${amplifierResult.content}`
        : amplifierResult.content;
      const durationMs = Date.now() - startTime;
      const complexityUsed = (amplifierResult.complexityUsed as ComplexityLevel) || ComplexityLevel.MODERATE;
      const modelUsed = amplifierResult.modelsUsed[0] || runtimeProvider.model;

      const assistantMeta: AssistantMessageMetadata = {
        modelUsed,
        complexityUsed,
        durationMs,
        injectedSkills: amplifierResult.injectedSkills,
      };

      // Ensure the conversation row exists before inserting messages that reference it.
      await this.memoryService.ensureConversation(input.conversationId, input.userId);

      await this.saveToMemory(input.conversationId, {
        role: 'user',
        content: input.message,
      });
      await this.saveToMemory(input.conversationId, {
        role: 'assistant',
        content: assistantContent,
      }, modelUsed, assistantMeta);

      // Step 6: Save usage statistics
      const providerUsed = runtimeProvider.name || this.resolveProvider(modelUsed);
      const source = input.source || 'unknown';
      
      // Calculate tokens (approximate: 1 token per 4 characters)
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
        // Persist injected skills as synthetic usage keys so Insights can surface them.
        statsToolsUsed.add(`skill:${skill.name}`);
      }
      
      const stats: UsageStat = {
        id: uuidv4(),
        conversationId: input.conversationId,
        userId: input.userId,
        source,
        provider: providerUsed,
        model: modelUsed,
        inputTokens,
        outputTokens,
        estimatedCostUsd,
        durationMs,
        toolsUsed: Array.from(statsToolsUsed),
        complexityLevel: complexityUsed,
        createdAt: Date.now(),
      };
      await this.memoryService.saveStats(stats);

      // Step 7: Return orchestrated response
      return {
        content: assistantContent,
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
    } catch (error) {
      console.error('[Orchestrator] process() error:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Return a fallback error response
      return {
        content: `Tuve un problema procesando tu solicitud: ${errorMsg}. ¿Puedes intentarlo de nuevo?`,
        complexityUsed: ComplexityLevel.SIMPLE,
        providerUsed: 'fallback',
        modelUsed: 'none',
        injectedSkills: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        durationMs: Date.now() - startTime,
      };
    }
  }

  private async loadHistory(conversationId: string): Promise<Message[]> {
    if (!this.memoryService) {
      return [];
    }

    try {
      return await this.memoryService.getHistory(conversationId);
    } catch (error) {
      console.warn('[Orchestrator] Failed to load history:', error);
      return [];
    }
  }

  private async saveToMemory(
    conversationId: string,
    message: Message,
    modelUsed?: string,
    assistantMeta?: AssistantMessageMetadata
  ): Promise<void> {
    if (!this.memoryService) {
      return;
    }

    try {
      await this.memoryService.saveMessage(conversationId, message, modelUsed, assistantMeta);
    } catch (error) {
      console.warn('[Orchestrator] Failed to save to memory:', error);
    }
  }

  private resolveAssistantProfile(
    configProfile: AssistantProfile | undefined,
    selectedAgent: AgentConfig | undefined
  ): AssistantProfile {
    const fallbackProfile: AssistantProfile = {
      name: 'Enzo',
      persona: 'Intelligent personal assistant',
      tone: 'direct, concise, and friendly',
      styleGuidelines: '',
    };

    const baseProfile = configProfile ?? fallbackProfile;
    const styleSegments = [
      baseProfile.styleGuidelines,
      selectedAgent?.systemPrompt,
    ].filter((segment): segment is string => !!segment && segment.trim().length > 0);

    return {
      ...fallbackProfile,
      ...baseProfile,
      name: selectedAgent?.assistantNameOverride || baseProfile.name || fallbackProfile.name,
      persona: selectedAgent?.personaOverride || baseProfile.persona || fallbackProfile.persona,
      tone: selectedAgent?.toneOverride || baseProfile.tone || fallbackProfile.tone,
      styleGuidelines: styleSegments.join('\n\n'),
    };
  }

  private buildUserProfileBlock(userId: string, profile: UserProfile): string {
    const profileLines: string[] = [];
    if (profile.displayName) {
      profileLines.push(`Display name: ${profile.displayName}`);
    }
    if (profile.importantInfo) {
      profileLines.push(`Important info: ${profile.importantInfo}`);
    }
    if (profile.preferences) {
      profileLines.push(`Preferences: ${profile.preferences}`);
    }
    if (profile.locale) {
      profileLines.push(`Locale: ${profile.locale}`);
    }
    if (profile.timezone) {
      profileLines.push(`Timezone: ${profile.timezone}`);
    }

    if (profileLines.length === 0) {
      return '';
    }

    return `[IMPORTANT - USER PROFILE SETTINGS FOR ${userId}]
${profileLines.join('\n')}
Use this profile information to personalize responses while respecting user requests.`;
  }

  private async resolveSelectedAgent(agentId: string): Promise<AgentConfig | undefined> {
    const availableAgent = this.availableAgents.find((agent) => agent.id === agentId);
    if (availableAgent) {
      return availableAgent;
    }

    try {
      const persistedAgent = await (this.memoryService as any).getAgent(agentId);
      return persistedAgent || undefined;
    } catch (error) {
      console.warn(`[Orchestrator] Failed to load agent "${agentId}" from memory:`, error);
      return undefined;
    }
  }

  async routeAgentForMessage(message: string, userId: string): Promise<AgentConfig | undefined> {
    this.syncBaseProviderFromConfig();
    const trimmedMessage = (message || '').trim();
    if (!trimmedMessage) {
      return undefined;
    }

    const agents = await this.listAgentsForUser(userId);
    if (agents.length === 0) {
      return undefined;
    }

    const lowerMessage = trimmedMessage.toLowerCase();
    const nameMatched = agents.find((agent) => lowerMessage.includes(agent.name.toLowerCase()));
    if (nameMatched) {
      return nameMatched;
    }

    const providerList = agents
      .map((agent) => `- id: ${agent.id}; name: ${agent.name}; description: ${agent.description || 'N/A'}`)
      .join('\n');

    const routingPrompt = `You are an agent router. Choose the best agent for the user message.
Return ONLY JSON:
{"agentId":"<id>"} or {"agentId":"none"}

Rules:
- Choose "none" when no agent is clearly relevant.
- Prefer exact semantic match with agent name/description.
- Never invent ids.

Available agents:
${providerList}`;

    try {
      const routingResponse = await this.baseProvider.complete({
        messages: [
          { role: 'system', content: routingPrompt },
          { role: 'user', content: trimmedMessage },
        ],
        temperature: 0,
        maxTokens: 128,
      });
      const parsed = parseFirstJsonObject<{ agentId?: string }>(routingResponse.content || '', { tryRepair: true });
      const selectedId = parsed?.value?.agentId;
      if (!selectedId || selectedId === 'none') {
        return undefined;
      }
      return agents.find((agent) => agent.id === selectedId);
    } catch (error) {
      console.warn('[Orchestrator] routeAgentForMessage failed, continuing without routed agent:', error);
      return undefined;
    }
  }

  private createAmplifierLoop(provider: LLMProvider): AmplifierLoop {
    return new AmplifierLoop(provider, this.toolRegistry.getAll(), {
      maxIterations: 8,
      skillRegistry: this.skillRegistry,
      mcpRegistry: this.mcpRegistry,
    });
  }

  private async listAgentsForUser(userId: string): Promise<AgentConfig[]> {
    const mapAgentRecord = (agent: any): AgentConfig => ({
      id: agent.id,
      name: agent.name,
      description: agent.description || '',
      provider: agent.provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      assistantNameOverride: agent.assistantNameOverride,
      personaOverride: agent.personaOverride,
      toneOverride: agent.toneOverride,
    });

    try {
      const byUser = await this.memoryService.getAgents(userId);
      if (byUser.length > 0) {
        return byUser.map(mapAgentRecord);
      }

      const ownerUserId = process.env.TELEGRAM_AGENT_OWNER_USER_ID?.trim();
      if (ownerUserId && ownerUserId !== userId) {
        const byOwner = await this.memoryService.getAgents(ownerUserId);
        if (byOwner.length > 0) {
          return byOwner.map(mapAgentRecord);
        }
      }

      const globalAgents = await this.memoryService.getAllAgents();
      if (globalAgents.length > 0) {
        return globalAgents.map(mapAgentRecord);
      }
    } catch (error) {
      console.warn(`[Orchestrator] Failed to load agents for user "${userId}":`, error);
    }

    return this.availableAgents;
  }

  private async resolveRuntimeProvider(selectedAgent?: AgentConfig): Promise<{ provider: LLMProvider; warning?: string }> {
    if (!selectedAgent) {
      return { provider: this.baseProvider };
    }

    const providerName = (selectedAgent.provider || '').toLowerCase();
    const modelName = (selectedAgent.model || '').trim();
    if (!providerName || !modelName) {
      return { provider: this.baseProvider };
    }

    const cacheKey = `${providerName}:${modelName}`;
    const cachedProvider = providerName === 'ollama' ? this.providerCache.get(cacheKey) : undefined;
    if (cachedProvider) {
      return { provider: cachedProvider };
    }

    try {
      let provider: LLMProvider | undefined;
      if (providerName === 'ollama') {
        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        provider = new OllamaProvider(ollamaBaseUrl, modelName);
      } else if (providerName === 'anthropic') {
        const apiKey = this.configService?.getProviderApiKey('anthropic') || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          throw new Error('Anthropic API key is not configured');
        }
        provider = new AnthropicProvider(apiKey, modelName || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5');
      } else if (providerName === 'openai') {
        const apiKey = this.configService?.getProviderApiKey('openai') || process.env.OPENAI_API_KEY;
        if (!apiKey) {
          throw new Error('OpenAI API key is not configured');
        }
        provider = new OpenAIProvider(apiKey, modelName || 'gpt-4o-mini');
      } else if (providerName === 'gemini') {
        const apiKey = this.configService?.getProviderApiKey('gemini') || process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('Gemini API key is not configured');
        }
        provider = new GeminiProvider(apiKey, modelName || 'gemini-1.5-flash');
      } else {
        throw new Error(`Provider "${selectedAgent.provider}" is not supported`);
      }

      const isAvailable = await provider.isAvailable();
      if (!isAvailable) {
        throw new Error(`Provider "${providerName}" is not available`);
      }

      if (providerName === 'ollama') {
        this.providerCache.set(cacheKey, provider);
      }
      return { provider };
    } catch (error) {
      const fallbackMessage = `Nota: el agente "${selectedAgent.name}" no pudo usar ${selectedAgent.provider}/${selectedAgent.model}. Continuo con el modelo principal "${this.baseProvider.model}".`;
      console.warn('[Orchestrator] Falling back to base provider:', error);
      return { provider: this.baseProvider, warning: fallbackMessage };
    }
  }

  private sanitizeMemoryBlock(memoryBlock: string, assistantName: string): string {
    if (!memoryBlock || !assistantName) {
      return memoryBlock;
    }

    const escapedName = assistantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const conflictingNameFact = new RegExp(`\\bname:\\s*${escapedName}\\b,?\\s*`, 'gi');
    const cleaned = memoryBlock.replace(conflictingNameFact, '');
    return cleaned.replace(/\[\s*,/g, '[').trim();
  }

  private resolveProvider(modelUsed: string): string {
    const normalizedModel = (modelUsed || '').toLowerCase();
    if (normalizedModel.includes('claude')) {
      return 'anthropic';
    }
    if (normalizedModel.includes('gpt')) {
      return 'openai';
    }
    if (normalizedModel.includes('gemini')) {
      return 'gemini';
    }
    return this.ollamaProvider.name;
  }

  private syncBaseProviderFromConfig(): void {
    if (!this.configService) {
      return;
    }
    const systemConfig = this.configService.getSystemConfig();
    if (systemConfig.ollamaBaseUrl) {
      this.ollamaProvider.setBaseUrl(systemConfig.ollamaBaseUrl);
    }
    const configuredModel = this.configService.getPrimaryModel();
    if (configuredModel && configuredModel !== this.ollamaProvider.model) {
      this.ollamaProvider.setModel(configuredModel);
    }
  }
}
