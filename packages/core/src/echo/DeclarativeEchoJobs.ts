import { z } from 'zod';
import { ComplexityLevel, type OrchestratorInput } from '../orchestrator/types.js';
import type { MemoryService } from '../memory/MemoryService.js';
import type { NotificationGateway } from './NotificationGateway.js';
import type { EchoOrchestratorBinding } from './EchoOrchestrationBinding.js';
import type { EchoResult } from './EchoEngine.js';

export const RESERVED_BUILTIN_ECHO_IDS = new Set([
  'morning-briefing',
  'context-refresh',
  'night-summary',
]);

const ComplexityLevelSchema = z.nativeEnum(ComplexityLevel);

const orchestratorPayloadSchema = z.object({
  message: z.string().trim().min(1).max(32_000),
  userId: z.string().trim().min(1).optional(),
  conversationId: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1).optional(),
  userLanguage: z.string().trim().min(2).max(12).optional(),
  classifiedLevel: ComplexityLevelSchema.optional(),
  maxRetries: z.number().int().min(0).max(5).optional().default(2),
  notifyOnResult: z.boolean().optional().default(false),
  notificationPreviewChars: z.number().int().min(80).max(4000).optional().default(800),
});

export const declarativeJobSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase slug (a-z0-9-)'),
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.literal('orchestrator_message'),
  enabled: z.boolean().optional(),
  schedule: z.string().trim().min(1),
  payload: orchestratorPayloadSchema,
});

export type DeclarativeEchoJob = z.infer<typeof declarativeJobSchema>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveConversationIdForJob(
  memoryService: MemoryService,
  userId: string,
  jobId: string,
  explicit?: string
): Promise<string> {
  if (explicit) {
    return explicit;
  }
  const memKey = `echo_conv_${jobId}`;
  const rows = await memoryService.recall(userId, memKey);
  const existing = rows[0]?.value?.trim();
  if (existing) {
    return existing;
  }
  const convId = await memoryService.createConversation(userId);
  await memoryService.remember(userId, memKey, convId);
  return convId;
}

export function createDeclarativeOrchestratorAction(
  job: DeclarativeEchoJob,
  ctx: EchoOrchestratorBinding
): () => Promise<EchoResult> {
  return async () => {
    const processOrch = ctx.process;
    if (!processOrch) {
      return {
        success: false,
        error:
          'Orchestrator no enlazado: las tareas declarativas orchestrator_message solo corren donde la API enlazó el motor (pnpm en API / Telegram después del Orchestrator).',
      };
    }
    if (!ctx.memoryService) {
      return {
        success: false,
        error: 'MemoryService no enlazado para la tarea Echo declarativa.',
      };
    }

    const resolveUserId = ctx.resolveEchoUserId;
    const cfgUserId = job.payload.userId?.trim();
    const userId = cfgUserId || (await resolveUserId?.());
    if (!userId) {
      return {
        success: false,
        error:
          'Sin userId para la tarea: definí payload.userId o telegramAgentOwnerUserId / telegramAllowedUsers en configuración.',
      };
    }

    const memoryService = ctx.memoryService;
    const conversationId = await resolveConversationIdForJob(
      memoryService,
      userId,
      job.id,
      job.payload.conversationId?.trim()
    );

    const maxRetries = job.payload.maxRetries ?? 2;
    const hints = typeof ctx.buildRuntimeHints === 'function' ? ctx.buildRuntimeHints() : undefined;

    let lastError = 'Orchestrator no devolvió resultado';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const baseInput: OrchestratorInput = {
          message: job.payload.message,
          originalMessage: job.payload.message,
          conversationId,
          userId,
          source: 'echo',
          requestId: `echo-job-${job.id}-${Date.now()}`,
          classifiedLevel: job.payload.classifiedLevel,
          agentId: job.payload.agentId,
          userLanguage: job.payload.userLanguage,
          ...(hints ? { runtimeHints: hints as OrchestratorInput['runtimeHints'] } : {}),
        };
        const response = await processOrch(baseInput);

        const body = response.content?.trim() || '';
        if (job.payload.notifyOnResult && ctx.notificationGateway && body.length > 0) {
          const cap = job.payload.notificationPreviewChars ?? 800;
          const slice = body.length > cap ? `${body.slice(0, cap)}\n…` : body;
          await ctx.notificationGateway.notify(userId, `[Echo job: ${job.name ?? job.id}]\n\n${slice}`, {
            priority: 'NORMAL',
            deduplicationKey: `declarative-echo-${job.id}-${conversationId}-${new Date().toISOString().slice(0, 13)}`,
          });
          return {
            success: true,
            notified: true,
            message: `Orchestrator ok (${response.durationMs}ms); resumen por Telegram.`,
          };
        }

        return {
          success: true,
          notified: Boolean(job.payload.notifyOnResult && ctx.notificationGateway),
          message: `Orchestrator ok (${response.durationMs}ms, ${response.complexityUsed}).`,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt >= maxRetries) {
          break;
        }
        await sleep(750 * Math.pow(2, attempt));
      }
    }

    return { success: false, error: `${lastError} (tras ${maxRetries + 1} intentos)` };
  };
}
