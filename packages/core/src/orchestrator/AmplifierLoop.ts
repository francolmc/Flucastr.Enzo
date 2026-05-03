import { Message, LLMProvider } from '../providers/types.js';
import { AmplifierInput, AmplifierResult, Step, AvailableCapabilities, ComplexityLevel, InjectedSkillUsage } from './types.js';
import { CapabilityResolver } from './CapabilityResolver.js';
import { ContextSynthesizer } from './ContextSynthesizer.js';
import { EscalationManager } from './EscalationManager.js';
import { IntentAnalyzer } from './IntentAnalyzer.js';
import { ExecutableTool } from '../tools/types.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { MCPRegistry } from '../mcp/index.js';
import { mergeResolvedSkills, resolveMaxSkillsInjection, SkillResolver, RelevantSkill } from './SkillResolver.js';
import { totalToolActsForMultiStepPlan } from './SkillAlgorithmProgress.js';
import { Decomposer, Subtask } from './Decomposer.js';
import { extractFilePath, extractTargetDir } from '../utils/PathExtractor.js';
import { extractToolOutput } from '../utils/ToolOutputExtractor.js';
import { FileOrganizationService } from '../services/FileOrganizationService.js';
import path from 'path';
import { parseFirstJsonObject, repairJsonString } from '../utils/StructuredJson.js';
import { normalizeError } from './NormalizedError.js';
import type { AmplifierLoopLog } from './amplifier/AmplifierLoopLog.js';
import { createDefaultAmplifierLoopLog } from './amplifier/AmplifierLoopLog.js';
import { initStageMetrics, recordStageMetric } from './amplifier/AmplifierLoopMetrics.js';
import { buildAssistantIdentityPrompt } from './amplifier/AmplifierLoopPromptHelpers.js';
import {
  normalizeFastPathToolCall,
  shouldReturnRawToolOutput,
  shellOutputIndicatesFailure,
  textContainsPlaceholderPath,
  validateToolInput,
} from './amplifier/AmplifierLoopFastPathTools.js';
import { runSimpleModerateFastPath } from './amplifier/AmplifierSimplePath.js';
import { runThinkPhase } from './amplifier/AmplifierThinkPhase.js';
import { runActPhase, type AmplifierLoopPhaseDeps } from './amplifier/AmplifierActPhase.js';
import { runObservePhase } from './amplifier/AmplifierObservePhase.js';
import type { AgentRouterContract, DelegationRequest, DelegationResult } from './AgentRouter.js';
import { DELEGATION_NOT_CONFIGURED } from './AgentRouter.js';
import { isAnthropicDelegationAuthErrorMessage } from '../agents/anthropicDelegationUtils.js';
import { runSynthesizePhase } from './amplifier/AmplifierSynthesizePhase.js';
import { runVerifyBeforeSynthesizeIfEnabled } from './amplifier/AmplifierVerifyPhase.js';
import {
  plannedToolSuccessfulInSteps,
  subtaskRequiresExecutablePlanTool,
} from './amplifier/SubtaskExecutionTrace.js';
import { impliesMultiToolWorkflow } from './taskRoutingHints.js';
import {
  messageIndicatesPersistedWriteToAbsolutePath,
  resolveCalendarListFastPathIntent,
  resolveCalendarScheduleFastPathIntent,
} from './Classifier.js';
import {
  mailboxUnreadSummaryLockCorpus,
  messageLooksLikeMailboxUnreadStatsQuery,
  messageLooksLikeMailboxUnreadSummaryQuery,
} from './mailboxUnreadIntent.js';
import { resolveTopSkillDeclarativeExecutable } from './skillFastPathLock.js';

function amplifierImpliesMultiToolLexicalFallbackEnabled(): boolean {
  return process.env.ENZO_AMPLIFIER_IMPLIES_MULTI_TOOL_LEXICAL === 'true';
}
import type { MemoryService } from '../memory/MemoryService.js';
import { MemoryLessonExtractor } from '../memory/MemoryLessonExtractor.js';

export type AmplifierLoopOptions = {
  maxIterations?: number;
  skillRegistry?: SkillRegistry;
  mcpRegistry?: MCPRegistry;
  log?: AmplifierLoopLog;
  /** false disables file-organization subtask path */
  fileOrganization?: boolean;
  /** When true (or env ENZO_VERIFY_BEFORE_SYNTHESIS=true), run a short verification pass before final synthesis. */
  verifyBeforeSynthesize?: boolean;
  /** When set, THINK may emit `delegate` and the loop will run specialized agents. */
  agentRouter?: AgentRouterContract;
  /** When set, delegation outcomes are written to long-term memory after each agent result. */
  memoryService?: MemoryService;
};

export class AmplifierLoop {
  private log: AmplifierLoopLog;
  private baseProvider: LLMProvider;
  private capabilityResolver: CapabilityResolver;
  private contextSynthesizer: ContextSynthesizer;
  private escalationManager: EscalationManager;
  private intentAnalyzer: IntentAnalyzer;
  private skillResolver: SkillResolver;
  private decomposer: Decomposer;
  private fileOrgService: FileOrganizationService | null;
  private maxIterations: number;
  private executableTools: ExecutableTool[];
  private skillRegistry?: SkillRegistry;
  private mcpRegistry?: MCPRegistry;
  private verifyBeforeSynthesize: boolean;
  private agentRouter?: AgentRouterContract;
  private memoryService?: MemoryService;

  constructor(
    baseProvider: LLMProvider,
    executableTools: ExecutableTool[] = [],
    options?: AmplifierLoopOptions
  ) {
    this.log = options?.log ?? createDefaultAmplifierLoopLog();
    this.baseProvider = baseProvider;
    this.executableTools = executableTools;
    this.maxIterations = options?.maxIterations ?? 8;
    this.skillRegistry = options?.skillRegistry;
    this.mcpRegistry = options?.mcpRegistry;
    this.verifyBeforeSynthesize =
      options?.verifyBeforeSynthesize ?? process.env.ENZO_VERIFY_BEFORE_SYNTHESIS === 'true';
    this.agentRouter = options?.agentRouter;
    this.memoryService = options?.memoryService;
    this.capabilityResolver = new CapabilityResolver();
    this.intentAnalyzer = new IntentAnalyzer(baseProvider);
    this.contextSynthesizer = new ContextSynthesizer();
    this.escalationManager = new EscalationManager();
    this.skillResolver = new SkillResolver();
    this.decomposer = new Decomposer(baseProvider);
    this.fileOrgService =
      options?.fileOrganization === false
        ? null
        : new FileOrganizationService(baseProvider, this.withTimeout.bind(this));
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`LLM timeout after ${ms}ms (${label})`)), ms)
      ),
    ]);
  }

  private static formatDelegationObserve(agent: string, result: DelegationResult): string {
    if (result.success) {
      let text = `Agent ${agent} completed: ${result.output}`;
      if (result.filesCreated?.length) {
        text += `\n\nFiles: ${result.filesCreated.join(', ')}`;
      }
      return text;
    }
    return `Agent ${agent} failed: ${result.error?.trim() || 'Unknown error'}`;
  }

  /**
   * After THINK+resolve yield `delegate`, run the external agent and build trace + observe steps.
   */
  /**
   * When Telegram (or host) attaches pixels, local THINK models often emit prose instead of
   * `{"action":"delegate",...}` — {@link CapabilityResolver} then yields `none` and the user
   * sees "describe the image yourself". If the classifier already picked a delegation target and
   * we have not run delegate yet, force one delegate with a concrete task.
   */
  private buildVisionDelegationCoercionTask(input: AmplifierInput): string {
    const msg = input.message;
    const cap = msg.match(/Instrucción del usuario \(caption\):\s*([\s\S]+?)$/im);
    if (cap?.[1]?.trim()) {
      return `Answer the user's question about the attached image: ${cap[1].trim().trimEnd()}`;
    }
    const singleLine = msg.replace(/\s+/g, ' ').trim();
    if (singleLine.length > 0 && singleLine.length <= 2000) {
      return `Use the attached image bytes. Fulfill every instruction in this host message:\n${msg}`;
    }
    return `Describe the attached image in detail (content, text/code if any, structure of diagrams).`;
  }

  private async processDelegationInLoop(
    d: { agent: string; task: string; reason: string },
    iteration: number,
    requestId: string | undefined,
    input: Pick<AmplifierInput, 'userId' | 'userMemories' | 'message' | 'imageContext'>,
    options: { conversationSummary: string; previousStepResults?: string }
  ): Promise<{ actTrace: Step; observe: Step }> {
    const actTrace: Step = {
      iteration,
      type: 'act',
      requestId,
      action: 'delegate',
      target: d.agent,
      input: JSON.stringify({ task: d.task, reason: d.reason }),
      output: 'Delegation request processed',
      durationMs: 0,
      status: 'ok',
      modelUsed: this.baseProvider.model,
    };

    const routerStart = Date.now();
    if (!this.agentRouter) {
      const routerMs = Date.now() - routerStart;
      const observeOutput = `Agent ${d.agent} completed the task: ${DELEGATION_NOT_CONFIGURED}`;
      return {
        actTrace,
        observe: {
          iteration,
          type: 'observe',
          requestId,
          output: observeOutput,
          durationMs: routerMs,
          status: 'ok',
          modelUsed: this.baseProvider.model,
        },
      };
    }

    const delegationRequest: DelegationRequest = {
      agent: d.agent,
      task: d.task,
      reason: d.reason,
      context: {
        userId: input.userId,
        memories: input.userMemories ?? [],
        conversationSummary: options.conversationSummary,
        previousStepResults: options.previousStepResults,
        imageBase64: input.imageContext?.base64,
        imageMimeType: input.imageContext?.mimeType,
      },
    };

    const result = await this.agentRouter.delegate(delegationRequest);
    const routerMs = Date.now() - routerStart;

    if (this.memoryService) {
      try {
        const userId = input.userId;
        await this.memoryService.remember(
          userId,
          'other',
          `Delegated to ${result.agent} on ${new Date().toLocaleDateString()}: ${d.task.substring(0, 100)}. Result: ${result.output.substring(0, 200)}`
        );
        if (result.filesCreated?.length) {
          await this.memoryService.remember(
            userId,
            'other',
            `Files created by ${result.agent}: ${result.filesCreated.join(', ')}`
          );
        }
      } catch (err) {
        this.log.warn('[AmplifierLoop] Failed to persist delegation memory:', err);
      }
    }

    const observeOutput = AmplifierLoop.formatDelegationObserve(d.agent, result);
    return {
      actTrace,
      observe: {
        iteration,
        type: 'observe',
        requestId,
        output: observeOutput,
        durationMs: routerMs,
        status: result.success ? 'ok' : 'error',
        modelUsed: this.baseProvider.model,
      },
    };
  }

  private async requestToolInputCorrection(
    userMessage: string,
    toolName: string,
    input: any,
    errorDetail: string
  ): Promise<{ toolName: string; toolInput: any } | null> {
    const correctionPrompt = `You produced an invalid tool call.
Return ONLY one valid JSON object in this format:
{"action":"tool","tool":"${toolName}","input":{...}}

Validation error: ${errorDetail}
Previous input: ${JSON.stringify(input ?? {})}

Do not change the tool name. Only fix missing/invalid input fields.
No markdown. No prose.`;

    const response = await this.withTimeout(
      this.baseProvider.complete({
        messages: [
          { role: 'system', content: correctionPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0,
        maxTokens: 256,
      }),
      60_000,
      'tool input correction'
    );

    const parsed = parseFirstJsonObject<any>(response.content ?? '', { tryRepair: true });
    if (!parsed) return null;
    return normalizeFastPathToolCall(parsed.value, this.executableTools);
  }

  async amplify(input: AmplifierInput): Promise<AmplifierResult> {
    const startTime = Date.now();
    const steps: Step[] = [];
    const requestId = input.requestId;
    const stageMetrics = initStageMetrics();
    const modelsUsed = new Set<string>();
    const toolsUsed = new Set<string>();

    let currentContext = '';
    let iteration = 0;
    let hasEnoughInfo = false;

    modelsUsed.add(this.baseProvider.model);
    const skillResolveOpts = {
      llm: this.baseProvider,
      withTimeout: this.withTimeout.bind(this),
    };
    const preResolvedSkills = this.skillRegistry
      ? await this.skillResolver.resolveRelevantSkills(input.message, this.skillRegistry, skillResolveOpts)
      : [];
    if (preResolvedSkills.length > 0) {
      this.log.info(
        `[AmplifierLoop] Relevant skills pre-resolved: ${preResolvedSkills
          .map((skill) => `${skill.name}(${Math.round(skill.relevanceScore * 100)}%)`)
          .join(', ')}`
      );
    }
    const injectedSkills = new Map<string, InjectedSkillUsage>();
    const rememberInjectedSkills = (skills: RelevantSkill[]): void => {
      for (const skill of skills) {
        const existing = injectedSkills.get(skill.id);
        if (!existing || skill.relevanceScore > existing.relevanceScore) {
          injectedSkills.set(skill.id, {
            id: skill.id,
            name: skill.name,
            relevanceScore: skill.relevanceScore,
          });
        }
      }
    };
    rememberInjectedSkills(preResolvedSkills);

    const skillDeclarativeExecutable = resolveTopSkillDeclarativeExecutable(
      preResolvedSkills,
      this.executableTools
    );
    const skillSingleStepBypassMultiTool = skillDeclarativeExecutable != null;

    const minRequiredSteps = totalToolActsForMultiStepPlan(preResolvedSkills);

    const hasMultiStepSkillRequirement = minRequiredSteps >= 2;
    if (hasMultiStepSkillRequirement) {
      this.log.info(`[AmplifierLoop] Multi-step skill detected: minRequiredSteps=${minRequiredSteps}`);
    }

    const skipFastPathForMultiTool =
      Boolean(input.suppressSimpleModerateFastPath) ||
      (!skillSingleStepBypassMultiTool &&
        amplifierImpliesMultiToolLexicalFallbackEnabled() &&
        impliesMultiToolWorkflow(input.message));

    if (skipFastPathForMultiTool) {
      console.log(
        JSON.stringify({
          event: 'EnzoRouting',
          phase: 'amplifier_before_fast_path',
          fastPathSkippedReason: input.suppressSimpleModerateFastPath
            ? 'classifier_suppress_simple_moderate_fast_path'
            : 'implies_multi_tool_workflow',
          classifiedLevel: input.classifiedLevel,
        })
      );
    }

    const calendarRoutingInput = {
      message: input.message,
      originalMessage: input.originalMessage,
      suggestedTool: input.suggestedTool,
      calendarIntent: input.calendarIntent,
      prefersHostTools: input.prefersHostTools,
    };
    const scheduleIntentForCalendar = resolveCalendarScheduleFastPathIntent(calendarRoutingInput);
    const calendarListClassifierIntent =
      this.executableTools.some((t) => t.name === 'calendar') &&
      resolveCalendarListFastPathIntent(calendarRoutingInput) &&
      !scheduleIntentForCalendar;

    let fastPathLevel = input.classifiedLevel;
    if (fastPathLevel === ComplexityLevel.SIMPLE && calendarListClassifierIntent) {
      fastPathLevel = ComplexityLevel.MODERATE;
      this.log.info(
        '[AmplifierLoop] Reclassified SIMPLE → MODERATE (Enzo persisted agenda list — calendar classifier hint)'
      );
      console.log(
        JSON.stringify({
          event: 'EnzoRouting',
          phase: 'amplifier_before_fast_path',
          reclassifiedTo: 'MODERATE',
          reason: 'calendar_list_classifier_hint',
          priorLevel: input.classifiedLevel,
        })
      );
    }

    const mailboxUnreadCorpus = [input.originalMessage, input.message].filter(Boolean).join('\n');
    const mailboxUnreadStatsIntentHint =
      this.executableTools.some((t) => t.name === 'email_unread_count') &&
      (input.mailboxIntent === 'unread_stats' || messageLooksLikeMailboxUnreadStatsQuery(mailboxUnreadCorpus));
    if (fastPathLevel === ComplexityLevel.SIMPLE && mailboxUnreadStatsIntentHint) {
      fastPathLevel = ComplexityLevel.MODERATE;
      this.log.info('[AmplifierLoop] Reclassified SIMPLE → MODERATE (mailbox unread counts)');
      console.log(
        JSON.stringify({
          event: 'EnzoRouting',
          phase: 'amplifier_before_fast_path',
          reclassifiedTo: 'MODERATE',
          reason: 'mailbox_unread_stats',
          priorLevel: input.classifiedLevel,
        })
      );
    }

    const mailboxUnreadSummarizeCorpus = mailboxUnreadSummaryLockCorpus({
      message: input.message,
      originalMessage: input.originalMessage,
      conversation: input.conversation,
    });
    const mailboxUnreadSummarizeHint =
      this.executableTools.some((t) => t.name === 'read_email') &&
      (input.mailboxIntent === 'unread_summarize' ||
        messageLooksLikeMailboxUnreadSummaryQuery(mailboxUnreadSummarizeCorpus));
    if (fastPathLevel === ComplexityLevel.SIMPLE && mailboxUnreadSummarizeHint) {
      fastPathLevel = ComplexityLevel.MODERATE;
      this.log.info('[AmplifierLoop] Reclassified SIMPLE → MODERATE (mailbox unread list/summary)');
      console.log(
        JSON.stringify({
          event: 'EnzoRouting',
          phase: 'amplifier_before_fast_path',
          reclassifiedTo: 'MODERATE',
          reason: 'mailbox_unread_summarize',
          priorLevel: input.classifiedLevel,
        })
      );
    }

    const calendarListBypassesMultiStepBlock = calendarListClassifierIntent;

    if (
      fastPathLevel === ComplexityLevel.SIMPLE &&
      messageIndicatesPersistedWriteToAbsolutePath(input.message)
    ) {
      fastPathLevel = ComplexityLevel.MODERATE;
      this.log.info(
        '[AmplifierLoop] Reclassified SIMPLE → MODERATE (persist-to-disk lexical hint; write_file expected)'
      );
      console.log(
        JSON.stringify({
          event: 'EnzoRouting',
          phase: 'amplifier_before_fast_path',
          reclassifiedTo: 'MODERATE',
          reason: 'write_file_lexical_hint',
          priorLevel: input.classifiedLevel,
        })
      );
    }

    if (fastPathLevel === ComplexityLevel.SIMPLE && skillSingleStepBypassMultiTool) {
      fastPathLevel = ComplexityLevel.MODERATE;
      this.log.info(
        '[AmplifierLoop] Reclassified SIMPLE → MODERATE (YAML declarative single-tool skill)'
      );
      console.log(
        JSON.stringify({
          event: 'EnzoRouting',
          phase: 'amplifier_before_fast_path',
          reclassifiedTo: 'MODERATE',
          reason: 'declarative_skill_single_tool_step',
          priorLevel: input.classifiedLevel,
        })
      );
    }

    if (calendarListBypassesMultiStepBlock && hasMultiStepSkillRequirement) {
      this.log.info(
        '[AmplifierLoop] Calendar list query: staying on SIMPLE/MODERATE fast path (calendar list locked prompt) despite multi-step skill plan'
      );
      console.log(
        JSON.stringify({
          event: 'EnzoRouting',
          phase: 'amplifier_fast_path',
          calendarListBypassMultiStepSkill: true,
        })
      );
    }

    if (skillSingleStepBypassMultiTool && hasMultiStepSkillRequirement) {
      this.log.info(
        '[AmplifierLoop] Declarative single-tool skill: staying on SIMPLE/MODERATE fast path despite multi-step text in other skills'
      );
      console.log(
        JSON.stringify({
          event: 'EnzoRouting',
          phase: 'amplifier_fast_path',
          skillDeclarativeSingleToolBypassMultiStepSkill: true,
        })
      );
    }

    if (
      (fastPathLevel === ComplexityLevel.SIMPLE || fastPathLevel === ComplexityLevel.MODERATE) &&
      (!hasMultiStepSkillRequirement ||
        calendarListBypassesMultiStepBlock ||
        skillSingleStepBypassMultiTool) &&
      (!skipFastPathForMultiTool ||
        calendarListBypassesMultiStepBlock ||
        skillSingleStepBypassMultiTool) &&
      !input.imageContext &&
      !input.delegationHint
    ) {
      return runSimpleModerateFastPath({
        input,
        classifiedLevel: fastPathLevel,
        stageMetrics,
        modelsUsed,
        toolsUsed,
        injectedSkills,
        preResolvedSkills,
        startTime,
        requestId,
        steps,
        baseProvider: this.baseProvider,
        withTimeout: this.withTimeout.bind(this),
        executableTools: this.executableTools,
        mcpRegistry: this.mcpRegistry,
        skillRegistry: this.skillRegistry,
        log: this.log,
        requestToolInputCorrection: this.requestToolInputCorrection.bind(this),
        verifyBeforeSynthesize: this.verifyBeforeSynthesize,
        capabilityResolver: this.capabilityResolver,
      });
    }

    if (skipFastPathForMultiTool && (input.classifiedLevel === ComplexityLevel.SIMPLE || input.classifiedLevel === ComplexityLevel.MODERATE)) {
      this.log.info(
        '[AmplifierLoop] Fast-path disabled: classifier suppressSimpleModerateFastPath and/or lexical multi-tool fallback (ENZO_AMPLIFIER_IMPLIES_MULTI_TOOL_LEXICAL)'
      );
    }

    if (hasMultiStepSkillRequirement && (input.classifiedLevel === ComplexityLevel.SIMPLE || input.classifiedLevel === ComplexityLevel.MODERATE)) {
      this.log.info('[AmplifierLoop] Fast-path disabled due to multi-step skill requirement');
    }

    // DECOMPOSE: Si la tarea es COMPLEX, dividir en subtareas antes del loop
    let subtasks: Subtask[] = [];
    /** Non-empty decomposition from this request (survives for verify after COMPLEX fallback to ReAct when steps=[]). */
    let complexPlanForVerify: Subtask[] | undefined;
    let accumulatedContext = '';

    if (input.classifiedLevel === ComplexityLevel.COMPLEX) {
      this.log.info('[AmplifierLoop] COMPLEX task — decomposing into subtasks');
      
      // Include all available capabilities (including MCP-prefixed tools) in decomposition.
      const toolNames = input.availableTools.map((tool) => tool.name);
      const dialogueForDecompose =
        input.conversation != null
          ? input.conversation.recentTurns
          : input.history.filter((m) => m.role === 'user' || m.role === 'assistant');
      const decomposition = await this.decomposer.decompose(input.message, toolNames, dialogueForDecompose);
      subtasks = decomposition.steps;
      complexPlanForVerify = decomposition.steps.length > 0 ? decomposition.steps : undefined;

      this.log.info(`[AmplifierLoop] Executing ${subtasks.length} subtask(s) sequentially`);

      if (subtasks.length === 0) {
        this.log.warn(
          '[AmplifierLoop] COMPLEX decomposition returned no steps — falling back to full ReAct loop'
        );
      } else {
      // Ejecutar cada subtarea secuencialmente
      for (const subtask of subtasks) {
        const stepsBeforeSubtask = steps.length;
        this.log.info(`[AmplifierLoop] Subtask ${subtask.id}/${subtasks.length}: ${subtask.tool} — ${subtask.description}`);

        // DIRECT EXECUTION: Si la subtarea tiene dependencia Y una tool definida por el Decomposer,
        // ejecutar directamente sin loop ReAct — el modelo solo genera el contenido.
        // write_file con dependsOn: null no entra aquí: el bucle ReAct de más abajo ejecuta la tool en contexto.
        if (subtask.dependsOn !== null && subtask.tool !== 'none' && accumulatedContext) {
          const tool = this.executableTools.find(t => t.name === subtask.tool);

          if (tool) {
            this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Direct execution of "${subtask.tool}"`);

            // Para write_file (tras otro paso): el modelo genera el contenido, nosotros ejecutamos la tool
            if (subtask.tool === 'write_file') {
              const originalMsg = input.originalMessage ?? input.message;
              let filePath = extractFilePath(originalMsg) ?? 'output.md';
              const ext = path.extname(filePath).toLowerCase();
              const textLikeExtensions = new Set(['.txt', '.md', '.json', '.csv', '.log', '.ts', '.js', '.py']);
              if (ext && !textLikeExtensions.has(ext)) {
                const parsed = path.parse(filePath);
                filePath = path.join(parsed.dir || '.', `${parsed.name}_summary.md`);
                this.log.warn(
                  `[AmplifierLoop] write_file target "${parsed.base}" is not text-friendly. Redirecting summary output to "${filePath}"`
                );
              }

              this.log.info(`[AmplifierLoop] Target file path: ${filePath}`);

              // Pedir al modelo que genere SOLO el contenido del archivo
              const contentPrompt = `Based on the following information, write a concise markdown summary.
Output ONLY the markdown content — no explanations, no preamble, no code blocks.
Start directly with the content.

INFORMATION:
${accumulatedContext}`;

              let fileContent = '';
              try {
                const contentResponse = await this.withTimeout(
                  this.baseProvider.complete({
                    messages: [
                      { role: 'system', content: contentPrompt },
                      { role: 'user', content: `Write the content for ${filePath}` },
                    ],
                    temperature: 0.5,
                    maxTokens: 1024,
                  }),
                  180_000,
                  'write_file content generation'
                );
                fileContent = contentResponse.content?.trim() ?? '';
              } catch (err) {
                this.log.error('[AmplifierLoop] Failed to generate file content:', err);
                fileContent = accumulatedContext; // Fallback: usar contexto crudo
              }

              // Ejecutar write_file directamente
              try {
                const directInput = { path: filePath, content: fileContent };
                const validationError = validateToolInput('write_file', directInput, this.executableTools, this.mcpRegistry);
                if (validationError) {
                  throw new Error(validationError);
                }
                const result = await tool.execute(directInput);
                const output = result.success
                  ? `File created successfully at ${filePath}`
                  : `Error: ${result.error}`;

                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - write_file result:`, output);
                toolsUsed.add('write_file');
                accumulatedContext += `\n\nStep ${subtask.id} (write_file): ${output}\nFile path: ${filePath}`;

                steps.push({
                  iteration,
                  type: 'act',
                  requestId,
                  action: 'tool',
                  target: 'write_file',
                  input: JSON.stringify({ path: filePath }),
                  output,
                  status: output.toLowerCase().includes('error') ? 'error' : 'ok',
                  modelUsed: this.baseProvider.model,
                });
              } catch (err) {
                this.log.error('[AmplifierLoop] write_file execution failed:', err);
              }

              continue; // Siguiente subtarea
            }

            // Para execute_command con dependencia: varios modos según lo que pidió el usuario
            else if (subtask.tool === 'execute_command') {
              const originalMsg = input.originalMessage ?? input.message;

              // FAST PATH: si el Decomposer generó un comando shell concreto (mv, mkdir, cp...)
              // simplemente ejecutarlo — no pasar por FileOrganizationService
              const concreteShellPattern = /^(mv|mkdir|cp|rsync|ln|rm)\s/i;
              if (concreteShellPattern.test(subtask.input.trim())) {
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Concrete shell command, running directly`);
                let output = '';
                try {
                  const directInput = { command: subtask.input.trim() };
                  const validationError = validateToolInput('execute_command', directInput, this.executableTools, this.mcpRegistry);
                  if (validationError) {
                    throw new Error(validationError);
                  }
                  const result = await tool.execute(directInput);
                  const stdout = result.output ?? '';
                  // For mv/mkdir commands stdout is empty on success — build a meaningful message
                  if (result.success) {
                    output = stdout.trim() || `success`;
                  } else {
                    output = `Error: ${result.error}`;
                  }
                } catch (err) {
                  output = `Error: ${err}`;
                }
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - result:`, output.substring(0, 200));
                toolsUsed.add('execute_command');
                accumulatedContext += `\n\nStep ${subtask.id} (execute_command): ${output}`;
                steps.push({
                  iteration,
                  type: 'act',
                  requestId,
                  action: 'tool',
                  target: 'execute_command',
                  input: JSON.stringify({ command: subtask.input.trim() }),
                  output,
                  status: output.toLowerCase().includes('error') ? 'error' : 'ok',
                  modelUsed: this.baseProvider.model,
                });
                continue;
              }

              // ORGANIZE PATH: FileOrganizationService
              // Guard: skip if step 1 failed or returned no usable file list
              const lsOutputLooksValid = accumulatedContext.trim().length > 0 &&
                !accumulatedContext.toLowerCase().includes('no such file or directory') &&
                !accumulatedContext.toLowerCase().startsWith('error:');

              if (!lsOutputLooksValid) {
                this.log.warn(`[AmplifierLoop] Subtask ${subtask.id} - Skipping: step 1 produced no valid ls output`);
                continue;
              }

              if (!this.fileOrgService) {
                this.log.warn(
                  `[AmplifierLoop] Subtask ${subtask.id} - Skipping organize path (file organization disabled)`
                );
                continue;
              }

              // Extract SOURCE directory from step 1's ls command, NOT from user message.
              // The user message may contain the destination path, which would be wrong as source.
              const step1 = subtasks.find(s => s.id === subtask.dependsOn);
              const lsMatch = step1?.input?.match(/ls\s+"?(\/[^\s"]+)"?/);
              const sourceDir = lsMatch?.[1] ?? extractTargetDir(originalMsg, input.history);

              if (!sourceDir) {
                this.log.warn(`[AmplifierLoop] Subtask ${subtask.id} - Could not extract source directory`);
                continue;
              }

              const files = this.fileOrgService.extractFilenames(accumulatedContext);

              if (files.length === 0) {
                this.log.warn(`[AmplifierLoop] Subtask ${subtask.id} - No files to organize`);
                continue;
              }

              const namedFolder = this.fileOrgService.detectNamedFolder(originalMsg);

              // Detect targeted move: message contains an explicit destination path that is different
              // from the source (e.g., "move files from /Downloads to /Downloads/Clases")
              const allPaths = (originalMsg.match(/(\/[^\s'"(),]+)/g) ?? [])
                .map(p => p.replace(/[?!,;:.]+$/, '').replace(/\/$/, ''));
              const destPath = allPaths
                .filter(p => p !== sourceDir)
                .sort((a, b) => b.length - a.length)[0] ?? null;
              const isTargetedMove = destPath !== null && destPath.startsWith('/') && destPath !== sourceDir;

              let shellCommand: string;
              let output: string;
              let groups: Record<string, string[]> = {};

              if (namedFolder) {
                // MODE 1: move everything into a single named folder within sourceDir
                const destFolder = `${sourceDir}/${namedFolder}`;
                shellCommand = this.fileOrgService.buildNamedFolderCommand(files, sourceDir, namedFolder);
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Move-to-named-folder: ${files.length} items → "${destFolder}"`);
                try {
                  const validationError = validateToolInput('execute_command', { command: shellCommand }, this.executableTools, this.mcpRegistry);
                  if (validationError) {
                    throw new Error(validationError);
                  }
                  const result = await tool.execute({ command: shellCommand });
                  output = result.success
                    ? `Moved ${files.filter(f => f !== namedFolder).length} item(s) to ${destFolder}`
                    : `Error: ${result.error}`;
                } catch (err) {
                  output = `Error: ${err}`;
                }
              } else if (isTargetedMove && destPath) {
                // MODE 2: targeted move — user specified an explicit destination directory
                // Move only the files that exist in the ls output (skip existing subdirs matching destPath basename)
                const destBasename = destPath.split('/').pop() ?? '';
                const filesToMove = files
                  .filter(f => f !== destBasename) // don't move the destination folder itself
                  .map(f => `"${sourceDir}/${f.replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`)
                  .join(' ');
                shellCommand = filesToMove.length > 0
                  ? `mkdir -p "${destPath}" && mv ${filesToMove} "${destPath}/"`
                  : `mkdir -p "${destPath}"`;
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Targeted move: ${files.length} items → "${destPath}"`);
                try {
                  const validationError = validateToolInput('execute_command', { command: shellCommand }, this.executableTools, this.mcpRegistry);
                  if (validationError) {
                    throw new Error(validationError);
                  }
                  const result = await tool.execute({ command: shellCommand });
                  output = result.success
                    ? `Moved ${files.filter(f => f !== destBasename).length} item(s) to ${destPath}`
                    : `Error: ${result.error}`;
                } catch (err) {
                  output = `Error: ${err}`;
                }
              } else {
                // MODE 3: semantic categorization via LLM
                const mapping = await this.fileOrgService.categorizeFiles(files);
                const built = this.fileOrgService.buildSemanticOrganizeCommand(mapping, sourceDir);
                shellCommand = built.command;
                groups = built.groups;
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Organize (${files.length} files → ${Object.keys(groups).length} folders):`, shellCommand.substring(0, 400));
                try {
                  const validationError = validateToolInput('execute_command', { command: shellCommand }, this.executableTools, this.mcpRegistry);
                  if (validationError) {
                    throw new Error(validationError);
                  }
                  const result = await tool.execute({ command: shellCommand });
                  const folderList = Object.keys(groups).join(', ');
                  output = result.success
                    ? `Organized ${files.length} items into ${Object.keys(groups).length} folders: ${folderList}`
                    : `Error: ${result.error}`;
                } catch (err) {
                  output = `Error: ${err}`;
                }
              }

              this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - result:`, output);
              toolsUsed.add('execute_command');
              accumulatedContext += `\n\nStep ${subtask.id} (execute_command): ${output}`;
              steps.push({
                iteration,
                type: 'act',
                requestId,
                action: 'tool',
                target: 'execute_command',
                input: JSON.stringify({ command: shellCommand }),
                output,
                status: output.toLowerCase().includes('error') ? 'error' : 'ok',
                modelUsed: this.baseProvider.model,
              });

              continue; // Siguiente subtarea
            }
          }
        }

        // DIRECT EXECUTION for execute_command without dependsOn:
        // Use the command from Decomposer directly — avoids ReAct loop hallucinating wrong paths
        // Note: use == null (not ===) to catch both null and undefined (Decomposer may omit the field)
        if (subtask.dependsOn == null && subtask.tool === 'execute_command') {
          const ecTool = this.executableTools.find(t => t.name === 'execute_command');
          if (ecTool && subtask.input) {
            // Guard: si el Decomposer puso solo una ruta como input (en vez de un comando),
            // convertirlo automáticamente a "ls /ruta"
            let command = subtask.input.trim();
            if (command.startsWith('/') && !command.includes(' ')) {
              this.log.warn(`[AmplifierLoop] Subtask ${subtask.id} - input looks like a path, converting to "ls ${command}"`);
              command = `ls "${command}"`;
            }
            this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Direct execute_command: ${command}`);
            try {
              const directInput = { command };
              const validationError = validateToolInput('execute_command', directInput, this.executableTools, this.mcpRegistry);
              if (validationError) {
                throw new Error(validationError);
              }
              const result = await ecTool.execute(directInput);
              const output = result.success ? result.output : `Error: ${result.error}`;

              toolsUsed.add('execute_command');
              // Append to accumulatedContext (don't overwrite — previous steps may have context)
              accumulatedContext += (accumulatedContext ? '\n\n' : '') + output;
              steps.push({
                iteration,
                type: 'act',
                requestId,
                action: 'tool',
                target: 'execute_command',
                input: JSON.stringify({ command: subtask.input }),
                output,
                status: output.toLowerCase().includes('error') ? 'error' : 'ok',
                modelUsed: this.baseProvider.model,
              });
              this.log.info(`[AmplifierLoop] Subtask ${subtask.id} completed (direct). ls output: ${output.substring(0, 200)}`);
            } catch (err) {
              this.log.error('[AmplifierLoop] Direct execute_command failed:', err);
            }
            continue; // Skip ReAct loop
          }
        }

        // Direct execution for web_search without dependsOn — avoids ReAct overhead
        if (subtask.dependsOn == null && subtask.tool === 'web_search') {
          const wsTool = this.executableTools.find(t => t.name === 'web_search');
          if (wsTool && subtask.input) {
            this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Direct web_search: "${subtask.input}"`);
            try {
              const directInput = { query: subtask.input };
              const validationError = validateToolInput('web_search', directInput, this.executableTools, this.mcpRegistry);
              if (validationError) {
                throw new Error(validationError);
              }
              const result = await wsTool.execute(directInput);
              if (result.success) {
                const wsOutput = result.output;
                toolsUsed.add('web_search');
                accumulatedContext += (accumulatedContext ? '\n\n' : '') + wsOutput;
                steps.push({
                  iteration,
                  type: 'act',
                  requestId,
                  action: 'tool',
                  target: 'web_search',
                  input: JSON.stringify({ query: subtask.input }),
                  output: wsOutput,
                  status: 'ok',
                  modelUsed: this.baseProvider.model,
                });
                this.log.info(`[AmplifierLoop] Subtask ${subtask.id} completed (direct web_search)`);
              } else {
                this.log.error('[AmplifierLoop] Direct web_search failed:', result.error);
              }
            } catch (err) {
              this.log.error('[AmplifierLoop] Direct web_search threw:', err);
            }
            continue; // Skip ReAct loop
          }
        }

        // REACT LOOP: Para subtareas sin dependencia o sin tool definida
        // Construir el mensaje para esta subtarea específica
        let subtaskMessage: string;

        if (subtask.dependsOn !== null && accumulatedContext) {
          // Esta subtarea depende de una anterior — incluir resultado previo explícitamente
          subtaskMessage = `TASK: ${subtask.description}

IMPORTANT: Use the following information from the previous step as the content:
---
${accumulatedContext}
---

Your job is ONLY to execute this task using the information above.
Do NOT search for more information. Use what is provided.`;
        } else {
          subtaskMessage = subtask.description;
        }

        const baseSubtaskUserMessage = subtaskMessage;
        let subtaskMandatoryRetries = 0;

        const forcedTool = subtask.tool && subtask.tool !== 'none'
          ? input.availableTools.find((tool) => tool.name === subtask.tool)
          : undefined;

        // Crear un input modificado para esta subtarea
        const subtaskInput: AmplifierInput = {
          ...input,
          message: baseSubtaskUserMessage,
          availableTools: forcedTool ? [forcedTool] : input.availableTools,
          // When decomposition already selected a concrete tool, avoid skill/agent drift in the sub-loop.
          availableSkills: forcedTool ? [] : input.availableSkills,
          availableAgents: forcedTool ? [] : input.availableAgents,
          classifiedLevel: ComplexityLevel.MODERATE, // Cada subtarea es MODERATE
        };

        // Ejecutar el loop de ReAct para esta subtarea (máximo 4 iteraciones por subtarea)
        let subtaskIteration = 0;
        const subtaskMaxIterations = 4;
        let subtaskDone = false;
        let subtaskResult = '';

        while (subtaskIteration < subtaskMaxIterations && !subtaskDone) {
          subtaskIteration++;
          const skillQueryMessage = (subtask.description ?? subtask.input ?? '').trim();
          const subtaskRaw =
            forcedTool || !this.skillRegistry
              ? []
              : await this.skillResolver.resolveRelevantSkills(
                  skillQueryMessage,
                  this.skillRegistry,
                  skillResolveOpts
                );
          const subtaskResolvedSkills = forcedTool
            ? []
            : mergeResolvedSkills(preResolvedSkills, subtaskRaw, resolveMaxSkillsInjection());
          rememberInjectedSkills(subtaskResolvedSkills);
          subtaskInput.resolvedSkills = subtaskResolvedSkills;

          const subThinkStart = Date.now();
          const thinkStep = await runThinkPhase(this.phaseDeps(), {
            input: subtaskInput,
            context: accumulatedContext,
            iteration: subtaskIteration,
            modelsUsed,
            previousSteps: steps,
            resolvedSkills: subtaskResolvedSkills,
          });
          recordStageMetric(stageMetrics, 'think', Date.now() - subThinkStart, true);
          steps.push(thinkStep);
          input.onProgress?.(thinkStep);

          this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Think:`, thinkStep.output?.substring(0, 150));

          const capabilities: AvailableCapabilities = {
            tools: subtaskInput.availableTools,
            skills: subtaskInput.availableSkills,
            agents: subtaskInput.availableAgents,
          };

          const resolvedAction = await this.capabilityResolver.resolve(
            thinkStep.output ?? '',
            capabilities
          );

          this.log.info(`[AmplifierLoop] Subtask ${subtask.id} - Action:`, resolvedAction.type, resolvedAction.target);

          if (resolvedAction.type === 'none') {
            if (forcedTool && subtaskMandatoryRetries < 1) {
              subtaskMandatoryRetries++;
              subtaskInput.message = `${baseSubtaskUserMessage}\n\n[System] Mandatory: invoke the only allowed tool (${subtask.tool}) for this subtask when feasible; do not conclude without invoking it unless prerequisites are objectively impossible — then state briefly why.`;
              this.log.warn(
                `[AmplifierLoop] Subtask ${subtask.id} — think produced no actionable tool while '${subtask.tool}' is mandatory; injecting one corrective instruction pass`
              );
              continue;
            }
            subtaskDone = true;
            subtaskResult = thinkStep.output ?? '';
            break;
          }

          const subActStart = Date.now();
          const actResult = await runActPhase(
            this.phaseDeps(),
            resolvedAction,
            subtaskIteration,
            modelsUsed,
            toolsUsed,
            input.userId,
            requestId,
            input.runtimeHints
              ? {
                  timeZone: input.runtimeHints.timeZone,
                  timeLocale: input.runtimeHints.timeLocale,
                }
              : undefined
          );
          if (actResult.kind === 'delegate') {
            recordStageMetric(stageMetrics, 'act', Date.now() - subActStart, true);
            const subStepSummary = this.contextSynthesizer.compress(steps);
            const conversationSummary = [
              `Subtask [${subtask.id}] (tool: ${subtask.tool}): ${subtaskInput.message}`,
              `Compressed step trace:\n${subStepSummary}`,
            ]
              .filter((s) => s && s.trim().length > 0)
              .join('\n\n');
            const previousStepResults = accumulatedContext.trim() ? accumulatedContext : undefined;
            const { actTrace, observe: observeStep } = await this.processDelegationInLoop(
              {
                agent: actResult.agent,
                task: actResult.task,
                reason: actResult.reason,
              },
              subtaskIteration,
              requestId,
              input,
              { conversationSummary, previousStepResults }
            );
            recordStageMetric(
              stageMetrics,
              'observe',
              observeStep.durationMs ?? 0,
              !observeStep.output?.toLowerCase().includes('error')
            );
            steps.push(actTrace, observeStep);
            input.onProgress?.(actTrace);
            input.onProgress?.(observeStep);
            subtaskResult = observeStep.output ?? '';
            subtaskDone = true;
            break;
          }
          const actStep = actResult.step;
          recordStageMetric(stageMetrics, 'act', Date.now() - subActStart, !(actStep.output || '').toLowerCase().includes('error'));
          steps.push(actStep);
          input.onProgress?.(actStep);

          const subObserveStart = Date.now();
          const observeStep = runObservePhase(actStep, subtaskIteration, requestId, this.baseProvider.model);
          recordStageMetric(stageMetrics, 'observe', Date.now() - subObserveStart, true);
          steps.push(observeStep);
          input.onProgress?.(observeStep);

          subtaskResult = observeStep.output ?? '';

          // Si la tool se ejecutó exitosamente, la subtarea está completa
          if (actStep.output && !actStep.output.includes('failed') && !actStep.output.includes('Error')) {
            subtaskDone = true;
          }
        }

        // Acumular resultado de esta subtarea para la siguiente
        if (subtaskResult) {
          accumulatedContext += `\n\nStep ${subtask.id} (${subtask.tool}): ${subtaskResult}`;
          this.log.info(`[AmplifierLoop] Subtask ${subtask.id} completed. Context size: ${accumulatedContext.length} chars`);
        }

        if (subtaskRequiresExecutablePlanTool(subtask)) {
          const subtaskStepsSlice = steps.slice(stepsBeforeSubtask);
          if (!plannedToolSuccessfulInSteps(subtask.tool, subtaskStepsSlice)) {
            this.log.warn(
              `[AmplifierLoop] SubtaskGuard: planned tool '${subtask.tool}' (subtask ${subtask.id}) has no matching successful invoke in act traces`
            );
            accumulatedContext += `\n\n(SubtaskGuard) Subtask ${subtask.id}: planned tool '${subtask.tool}' was not invoked successfully in orchestrator traces. Treat this planned step as not completed; inform the user honestly and do not claim it was executed.`;
          }
        }
      }

      // Sintetizar todos los resultados acumulados
      this.log.info('[AmplifierLoop] All subtasks completed — synthesizing final response');

      // Skip LLM synthesis when only execute_command was used:
      // small models hallucinate "I can't manipulate files" even when commands succeeded.
      // Instead, extract the last step result from accumulatedContext and return it directly.
      const onlyExecuteCommands = toolsUsed.size > 0 && [...toolsUsed].every(t => t === 'execute_command');
      if (onlyExecuteCommands) {
        // Extract the last Step N output from accumulatedContext
        const stepLines = accumulatedContext.match(/Step \d+ \(execute_command\): ([\s\S]*?)(?=\n\nStep \d+|$)/g) ?? [];
        const lastStepOutput = stepLines.length > 0
          ? (stepLines[stepLines.length - 1].replace(/^Step \d+ \(execute_command\): /, '').trim())
          : accumulatedContext.trim();
        const hasError =
          shellOutputIndicatesFailure(lastStepOutput) || shellOutputIndicatesFailure(accumulatedContext);
        const hasPlaceholder =
          textContainsPlaceholderPath(lastStepOutput) || textContainsPlaceholderPath(accumulatedContext);
        const lang = input.userLanguage ?? 'en';
        const shouldReturnRaw = shouldReturnRawToolOutput('execute_command', input.message, lastStepOutput);
        if (!hasError && !hasPlaceholder) {
          const verbatimLead =
            shouldReturnRaw && lang === 'es'
              ? 'Salida del sistema (texto exacto):\n\n'
              : shouldReturnRaw
                ? 'System output (verbatim):\n\n'
                : '';
          const directContent = shouldReturnRaw
            ? verbatimLead + lastStepOutput
            : lang === 'es'
              ? `Listo, operación completada.`
              : `Done, operation completed.`;
          this.log.info('[AmplifierLoop] Skipping synthesis (execute_command only) — direct response');
          return {
            content: AmplifierLoop.wrapUserFacingAmplifierBody(directContent, input, steps),
            requestId,
            stepsUsed: steps,
            modelsUsed: Array.from(modelsUsed),
            toolsUsed: Array.from(toolsUsed),
            injectedSkills: Array.from(injectedSkills.values()),
            durationMs: Date.now() - startTime,
            stageMetrics,
            complexityUsed: ComplexityLevel.COMPLEX,
          };
        }
        this.log.info(
          '[AmplifierLoop] execute_command-only path had failure or placeholder — synthesizing user-facing explanation'
        );
      }

      const verifyComplexStart = Date.now();
      const verifiedComplex = await runVerifyBeforeSynthesizeIfEnabled(
        { baseProvider: this.baseProvider, withTimeout: this.withTimeout.bind(this) },
        input,
        accumulatedContext,
        iteration,
        modelsUsed,
        this.verifyBeforeSynthesize,
        complexPlanForVerify?.length ? { plannedSubtasks: complexPlanForVerify, orchestratorSteps: steps } : undefined
      );
      if (verifiedComplex.step) {
        steps.push(verifiedComplex.step);
        recordStageMetric(stageMetrics, 'verify', Date.now() - verifyComplexStart, true);
      }

      const complexSynthStart = Date.now();
      const complexSynthContext = this.maybeAugmentSynthesizeContextForVisionAuthFailure(
        input,
        steps,
        verifiedComplex.context
      );
      const synthesizeStep = await runSynthesizePhase(
        { baseProvider: this.baseProvider, withTimeout: this.withTimeout.bind(this) },
        input,
        complexSynthContext,
        iteration,
        modelsUsed,
        preResolvedSkills
      );
      recordStageMetric(stageMetrics, 'synthesize', Date.now() - complexSynthStart, true);
      steps.push(synthesizeStep);

      return {
        content: AmplifierLoop.wrapUserFacingAmplifierBody(
          synthesizeStep.output ?? complexSynthContext,
          input,
          steps
        ),
        requestId,
        stepsUsed: steps,
        modelsUsed: Array.from(modelsUsed),
        toolsUsed: Array.from(toolsUsed),
        injectedSkills: Array.from(injectedSkills.values()),
        durationMs: Date.now() - startTime,
        stageMetrics,
        complexityUsed: ComplexityLevel.COMPLEX,
      };
      }
    }

    let forcedToolRetryCount = 0;
    let consecutiveAlgorithmToolErrors = 0;
    while (iteration < this.maxIterations && !hasEnoughInfo) {
      iteration++;

      // THINK: modelo base analiza qué necesita
      const thinkStart = Date.now();
      const thinkStep = await runThinkPhase(this.phaseDeps(), {
        input: { ...input, resolvedSkills: preResolvedSkills },
        context: currentContext,
        iteration,
        modelsUsed,
        previousSteps: steps,
        resolvedSkills: preResolvedSkills,
      });
      recordStageMetric(stageMetrics, 'think', Date.now() - thinkStart, true);
      steps.push(thinkStep);
      input.onProgress?.(thinkStep);

      this.log.info(`[AmplifierLoop] Iteration ${iteration} - Think output:`, thinkStep.output?.substring(0, 200));

      // ACT: ejecuta lo que necesita
      const capabilities: AvailableCapabilities = {
        tools: input.availableTools,
        skills: input.availableSkills,
        agents: input.availableAgents,
      };

      let resolvedAction = await this.capabilityResolver.resolve(
        thinkStep.output || '',
        capabilities
      );

      this.log.info(`[AmplifierLoop] Iteration ${iteration} - Resolved action:`, {
        type: resolvedAction.type,
        target: resolvedAction.target,
        reason: resolvedAction.reason
      });

      const hasImagePayloadCoerce =
        Boolean(input.imageContext?.base64?.trim()) &&
        Boolean(String(input.imageContext?.mimeType ?? '').trim());
      const alreadyHadDelegateAct = steps.some((s) => s.type === 'act' && s.action === 'delegate');
      const hintAgentId = input.delegationHint?.agentId?.trim();
      if (
        resolvedAction.type === 'none' &&
        hasImagePayloadCoerce &&
        this.agentRouter &&
        !alreadyHadDelegateAct
      ) {
        const agentTarget = hintAgentId && hintAgentId.length > 0 ? hintAgentId : 'vision_agent';
        const task = this.buildVisionDelegationCoercionTask(input);
        const reasonHint =
          input.delegationHint?.reason?.trim() ||
          'Image bytes attached; host requires delegation to vision-capable agent.';
        resolvedAction = {
          type: 'delegate',
          target: agentTarget,
          reason: reasonHint,
          input: { task },
        };
        console.log(
          JSON.stringify({
            event: 'EnzoRouting',
            phase: 'amplifier_coerce_image_delegate',
            agentId: agentTarget,
            triggeredBy: 'think_none_or_non_json_with_image_payload',
          })
        );
        this.log.info(
          `[AmplifierLoop] Iteration ${iteration} - Coerced THINK → delegate("${agentTarget}") — local model emitted no usable delegate JSON despite imageContext`
        );
      }

      // Bloquear "none" mientras no se hayan completado todos los pasos requeridos por el skill.
      // Contamos solo acciones de tipo tool; ejecutar una "skill" no equivale a completar un paso.
      const stepsExecutedCount = steps.filter(s => s.type === 'act' && s.action === 'tool').length;
      const mustUseToolNow = hasMultiStepSkillRequirement && stepsExecutedCount < minRequiredSteps;
      if (resolvedAction.type === 'none' && mustUseToolNow) {
        this.log.warn(
          `[AmplifierLoop] Iteration ${iteration} - resolvedAction=none but only ${stepsExecutedCount}/${minRequiredSteps} steps done; retrying THINK`
        );

        const fallbackAction = await this.capabilityResolver.resolve(input.message, capabilities);
        const isKnownTool = fallbackAction.type === 'tool'
          && capabilities.tools.some((tool) => tool.name === fallbackAction.target);
        if (isKnownTool) {
          resolvedAction = fallbackAction;
          this.log.info(`[AmplifierLoop] Iteration ${iteration} - fallback action selected:`, {
            type: resolvedAction.type,
            target: resolvedAction.target,
            reason: resolvedAction.reason,
          });
        } else if (forcedToolRetryCount < 2) {
          forcedToolRetryCount++;
          currentContext = [
            currentContext,
            'Previous THINK result was invalid for this request because it returned no action.',
            `This request requires a multi-step skill (${stepsExecutedCount}/${minRequiredSteps} completed).`,
            'You MUST return a valid JSON tool call in the next iteration.',
            'Do NOT return {"action":"none"} before all required tool steps are completed.',
            'Do NOT return {"action":"skill"} in this stage.',
          ]
            .filter(Boolean)
            .join('\n');
          this.log.warn('[AmplifierLoop] Forcing one additional THINK retry with stricter context');
          continue;
        } else {
          this.log.warn('[AmplifierLoop] Unable to force valid tool call after retries; ending loop to avoid timeout');
        }
      }

      if (mustUseToolNow && resolvedAction.type !== 'tool') {
        if (forcedToolRetryCount < 2) {
          forcedToolRetryCount++;
          currentContext = [
            currentContext,
            `Invalid action type "${resolvedAction.type}" for multi-step execution (${stepsExecutedCount}/${minRequiredSteps}).`,
            'Only tool actions are valid while the algorithm is in progress.',
            'Return ONLY {"action":"tool","tool":"...","input":{...}}.',
          ]
            .filter(Boolean)
            .join('\n');
          this.log.warn(`[AmplifierLoop] Iteration ${iteration} - non-tool action during multi-step; retrying THINK`);
          continue;
        }
        this.log.warn('[AmplifierLoop] Repeated non-tool actions during multi-step; ending loop to avoid timeout');
        hasEnoughInfo = true;
        break;
      }

      if (resolvedAction.type === 'none') {
        hasEnoughInfo = true;
        break;
      }

      const actStart = Date.now();
      const actResult = await runActPhase(
        this.phaseDeps(),
        resolvedAction,
        iteration,
        modelsUsed,
        toolsUsed,
        input.userId,
        requestId,
        input.runtimeHints
          ? {
              timeZone: input.runtimeHints.timeZone,
              timeLocale: input.runtimeHints.timeLocale,
            }
          : undefined
      );
      if (actResult.kind === 'delegate') {
        recordStageMetric(stageMetrics, 'act', Date.now() - actStart, true);
        const stepSummary = this.contextSynthesizer.compress(steps);
        const conversationSummary = [
          `User message: ${input.message}`,
          currentContext && `Context prior to this iteration:\n${currentContext}`,
          `Compressed step trace:\n${stepSummary}`,
        ]
          .filter((s) => s && s.trim().length > 0)
          .join('\n\n');
        const { actTrace, observe: observeStep } = await this.processDelegationInLoop(
          {
            agent: actResult.agent,
            task: actResult.task,
            reason: actResult.reason,
          },
          iteration,
          requestId,
          input,
          { conversationSummary, previousStepResults: undefined }
        );
        recordStageMetric(
          stageMetrics,
          'observe',
          observeStep.durationMs ?? 0,
          !observeStep.output?.toLowerCase().includes('error')
        );
        steps.push(actTrace, observeStep);
        input.onProgress?.(actTrace);
        input.onProgress?.(observeStep);
        this.log.info(
          `[AmplifierLoop] Iteration ${iteration} - Observe (delegate):`,
          observeStep.output?.substring(0, 200)
        );
        currentContext = this.contextSynthesizer.compress(steps);
        if (iteration >= this.maxIterations) {
          hasEnoughInfo = true;
        }
        continue;
      }
      const actStep = actResult.step;
      recordStageMetric(stageMetrics, 'act', Date.now() - actStart, !(actStep.output || '').toLowerCase().includes('error'));
      steps.push(actStep);
      input.onProgress?.(actStep);

      // OBSERVE: integra el resultado al contexto
      const observeStart = Date.now();
      const observeStep = runObservePhase(actStep, iteration, requestId, this.baseProvider.model);
      recordStageMetric(stageMetrics, 'observe', Date.now() - observeStart, true);
      steps.push(observeStep);
      this.log.info(`[AmplifierLoop] Iteration ${iteration} - Observe output:`, observeStep.output?.substring(0, 200));

      if (hasMultiStepSkillRequirement && actStep.action === 'tool') {
        const observeText = (observeStep.output ?? '').toLowerCase();
        const hasToolFailure =
          observeText.includes('tool execution failed') ||
          observeText.includes('"error":true') ||
          observeText.includes('tool not found') ||
          observeText.includes('invalid string value') ||
          observeText.includes('cannot initialize float') ||
          observeText.includes('no value found');
        const hasUnresolvedPlaceholder =
          observeText.includes('latitude_placeholder') ||
          observeText.includes('longitude_placeholder') ||
          observeText.includes('latitude_from_step_1') ||
          observeText.includes('longitude_from_step_1');

        if (hasToolFailure || hasUnresolvedPlaceholder) {
          consecutiveAlgorithmToolErrors++;
          this.log.warn(
            `[AmplifierLoop] Algorithm tool error ${consecutiveAlgorithmToolErrors}/2 at iteration ${iteration}`
          );
          if (consecutiveAlgorithmToolErrors >= 2) {
            currentContext =
              this.contextSynthesizer.compress(steps) +
              '\n\nAlgorithm terminated early due to repeated tool errors. ' +
              'Do not continue looping. Report failure and ask user to retry with city/country.';
            if (process.env.ENZO_MEMORY_LESSONS_ON_TOOL_FAILURE === 'true' && this.memoryService) {
              const lessonExtractor = new MemoryLessonExtractor(this.baseProvider, this.memoryService);
              void lessonExtractor
                .extractAndSaveFromAlgorithmFailure({
                  userId: input.userId,
                  conversationId: input.conversationId,
                  requestId: input.requestId,
                  userMessage: input.message,
                  observeSnippet: observeStep.output ?? '',
                  stepsCompressed: this.contextSynthesizer.compress(steps),
                })
                .catch((err: unknown) =>
                  this.log.warn('[AmplifierLoop] lesson persistence failed:', err)
                );
            }
            hasEnoughInfo = true;
            break;
          }
        } else {
          consecutiveAlgorithmToolErrors = 0;
        }
      }

      currentContext = this.contextSynthesizer.compress(steps);

      // Fine-tuning: once a multi-step skill completed all required tool steps successfully,
      // stop iterating and move directly to final synthesis.
      if (hasMultiStepSkillRequirement) {
        const executedToolSteps = steps.filter((s) => s.type === 'act' && s.action === 'tool').length;
        if (executedToolSteps >= minRequiredSteps && consecutiveAlgorithmToolErrors === 0) {
          this.log.info(
            `[AmplifierLoop] Multi-step execution complete (${executedToolSteps}/${minRequiredSteps}). Finalizing without extra THINK iteration`
          );
          hasEnoughInfo = true;
          break;
        }
      }

      if (iteration >= this.maxIterations) {
        this.log.warn(
          `[AmplifierLoop] Reached max iterations (${this.maxIterations}), forcing synthesis`
        );
        hasEnoughInfo = true;
      }
    }

    const verifyMainStart = Date.now();
    const verifiedMain = await runVerifyBeforeSynthesizeIfEnabled(
      { baseProvider: this.baseProvider, withTimeout: this.withTimeout.bind(this) },
      input,
      currentContext,
      iteration + 1,
      modelsUsed,
      this.verifyBeforeSynthesize,
      complexPlanForVerify?.length
        ? { plannedSubtasks: complexPlanForVerify, orchestratorSteps: steps }
        : undefined
    );
    if (verifiedMain.step) {
      steps.push(verifiedMain.step);
      recordStageMetric(stageMetrics, 'verify', Date.now() - verifyMainStart, true);
    }

    // SYNTHESIZE: modelo base narra la respuesta final
    const finalSynthStart = Date.now();
    const synthContext = this.maybeAugmentSynthesizeContextForVisionAuthFailure(
      input,
      steps,
      verifiedMain.context
    );

    const synthesizeStep = await runSynthesizePhase(
      { baseProvider: this.baseProvider, withTimeout: this.withTimeout.bind(this) },
      input,
      synthContext,
      iteration + 1,
      modelsUsed,
      preResolvedSkills
    );
    recordStageMetric(stageMetrics, 'synthesize', Date.now() - finalSynthStart, true);
    steps.push(synthesizeStep);
    input.onProgress?.(synthesizeStep);

    return {
      content: AmplifierLoop.wrapUserFacingAmplifierBody(
        synthesizeStep.output || synthContext,
        input,
        steps
      ),
      requestId,
      stepsUsed: steps,
      modelsUsed: Array.from(modelsUsed),
      toolsUsed: Array.from(toolsUsed),
      injectedSkills: Array.from(injectedSkills.values()),
      durationMs: Date.now() - startTime,
      stageMetrics,
      complexityUsed: input.classifiedLevel,
    };
  }

  /**
   * Prefer showing the delegated agent’s real output (vision) before synthesis: small base models
   * often ignore compressed observe context and invent tool plans.
   */
  private static wrapUserFacingAmplifierBody(body: string, input: AmplifierInput, steps: Step[]): string {
    const withDelegation = AmplifierLoop.prependSuccessfulImageDelegationBlock(input, steps, body);
    return AmplifierLoop.prependAnthropicApiKeyBannerToBody(withDelegation, input, steps);
  }

  private static hasAttachedImageInput(input: AmplifierInput): boolean {
    return Boolean(input.imageContext?.base64?.trim() && input.imageContext?.mimeType?.trim());
  }

  private static extractSuccessfulDelegationObserve(
    steps: Step[]
  ): { agentId: string; body: string } | undefined {
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      if (s?.type !== 'observe') continue;
      const o = (typeof s.output === 'string' ? s.output : '').trim();
      if (!/^Agent\s+\S+\s+completed:\s*/i.test(o)) continue;
      const m = o.match(/^Agent\s+(\S+)\s+completed:\s*([\s\S]*)$/i);
      if (!m) continue;
      let extracted = (m[2] ?? '').trim();
      const filesIdx = extracted.indexOf('\n\nFiles:');
      if (filesIdx >= 0) extracted = extracted.slice(0, filesIdx).trim();
      if (!extracted) continue;
      return { agentId: m[1]!, body: extracted };
    }
    return undefined;
  }

  private static prependSuccessfulImageDelegationBlock(
    input: AmplifierInput,
    steps: Step[],
    synthesized: string
  ): string {
    if (!AmplifierLoop.hasAttachedImageInput(input)) return synthesized.trim();

    const d = AmplifierLoop.extractSuccessfulDelegationObserve(steps);
    if (!d) return synthesized.trim();

    const lang = (input.userLanguage || 'es').toLowerCase();
    const es = lang.startsWith('es');
    const agentLine = es
      ? `_Se delegó la imagen al agente:_ \`${d.agentId}\``
      : `_Image turn delegated to agent:_ \`${d.agentId}\``;
    const bodyBlock = es ? `**Salida del agente**\n\n${d.body}` : `**Agent output**\n\n${d.body}`;
    const header = `${agentLine}\n\n${bodyBlock}`;
    const rest = synthesized.trim();
    if (!rest.length) return header;
    const caveat = es
      ? '\n\n---\n\n_(Lo que sigue viene del modelo principal del orquestador; si pide que describas la imagen o contradice lo de arriba, priorizá la salida del agente.)_\n\n'
      : '\n\n---\n\n_(Below: primary orchestrator model; if it asks you to describe the image or contradicts the block above, prefer the agent output.)_\n\n';
    return `${header}${caveat}${rest}`.trim();
  }

  private static prependAnthropicApiKeyBannerToBody(body: string, input: AmplifierInput, steps: Step[]): string {
    const failure = AmplifierLoop.findAnthropicAuthFailureObserveOutput(steps);
    if (!failure) return body;
    const tech = AmplifierLoop.extractAnthropicAuthDetailForUi(failure);
    const lang = (input.userLanguage || 'es').toLowerCase();
    const es = lang.startsWith('es');
    const headline = es ? '⚠️ **Clave API de Anthropic**' : '⚠️ **Anthropic API key issue**';
    const detail = es ? `**Detalle (servidor):** \`${tech}\`` : `**Server detail:** \`${tech}\``;
    const help = es
      ? 'Revisá `ANTHROPIC_API_KEY` en el entorno donde corre Enzo (p. ej. systemd) y la clave del proveedor **anthropic** en la configuración local. Sin una clave válida no se puede usar Claude ni los agentes que dependen de Anthropic.'
      : 'Verify `ANTHROPIC_API_KEY` in Enzo\'s runtime (e.g. systemd) and the stored **anthropic** provider key in Enzo\'s settings. Claude and Anthropic-backed agents cannot run until the key is valid.';
    const box = `${headline}\n\n${detail}\n\n${help}`;
    const trimmed = body.trim();
    return trimmed.length ? `${box}\n\n---\n\n${trimmed}` : box;
  }

  private static findAnthropicAuthFailureObserveOutput(steps: Step[]): string | undefined {
    for (const s of steps) {
      if (s.type !== 'observe') continue;
      const o = typeof s.output === 'string' ? s.output.trim() : '';
      if (o.length > 0 && isAnthropicDelegationAuthErrorMessage(o)) return o;
    }
    return undefined;
  }

  private static extractAnthropicAuthDetailForUi(snippet: string): string {
    const oneLine = snippet.replace(/\s+/g, ' ').trim();
    const m = oneLine.match(/Anthropic\s+API\s+error:\s*(.+)$/i);
    let core = (m?.[1] ?? oneLine.replace(/^Agent\s+\S+\s+failed:\s*/i, '')).trim();
    core = core.replace(/`/g, "'");
    if (core.length > 220) core = `${core.slice(0, 220)}…`;
    return core || 'authentication failed';
  }

  /** If Anthropic vision failed on auth with an image attached, steer synthesis away from “describe the image yourself”. */
  private maybeAugmentSynthesizeContextForVisionAuthFailure(
    input: AmplifierInput,
    steps: Step[],
    baseContext: string
  ): string {
    const hasAttachedImageSynth = Boolean(
      input.imageContext?.base64?.trim() && input.imageContext?.mimeType?.trim()
    );
    const visionObserveAuthFail = hasAttachedImageSynth
      ? steps.some(
          (s) =>
            s.type === 'observe' &&
            typeof s.output === 'string' &&
            s.output.includes('Agent ') &&
            s.output.includes('failed') &&
            isAnthropicDelegationAuthErrorMessage(s.output)
        )
      : false;
    if (!visionObserveAuthFail) return baseContext;
    return [
      baseContext,
      '',
      '[HOST DIRECTIVE — API credentials]',
      'A vision delegate failed with Anthropic authentication (e.g. invalid x-api-key).',
      "Reply in the user's language: ask the operator to set ANTHROPIC_API_KEY in the systemd/shell environment and/or fix the stored anthropic key in Enzo.",
      'Do NOT ask the user to describe or type out the image; the bottleneck is remote API configuration.',
    ].join('\n');
  }

  private phaseDeps(): AmplifierLoopPhaseDeps {
    return {
      baseProvider: this.baseProvider,
      withTimeout: this.withTimeout.bind(this),
      maxIterations: this.maxIterations,
      executableTools: this.executableTools,
      mcpRegistry: this.mcpRegistry,
      skillRegistry: this.skillRegistry,
      skillResolver: this.skillResolver,
      log: this.log,
    };
  }

}
