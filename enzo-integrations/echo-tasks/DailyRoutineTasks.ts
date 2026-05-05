import type { EchoTask, EchoResult } from './EchoEngine.js';
import type { EchoOrchestratorBinding } from './EchoOrchestrationBinding.js';
import type { DailyRoutineConfig, DailyRoutineNotification } from '../config/ConfigService.js';
import type { OrchestratorInput } from '../orchestrator/types.js';

const ROUTINE_TO_SKILL_MAP: Record<string, string> = {
  morningBriefing: 'morning-briefing',
  middayCheckin: 'midday-checkin', 
  afternoonPrep: 'afternoon-prep',
  eveningRecap: 'evening-recap',
};

const ROUTINE_NAMES: Record<string, string> = {
  morningBriefing: 'Briefing Matutino',
  middayCheckin: 'Check-in Mediodía',
  afternoonPrep: 'Preparación Tarde',
  eveningRecap: 'Resumen Nocturno',
};

function timeToCronExpression(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time format: ${time}. Expected HH:MM format.`);
  }
  return `${minutes} ${hours} * * *`;
}

function createDailyRoutineOrchestratorAction(
  routineType: string,
  binding: EchoOrchestratorBinding
): () => Promise<EchoResult> {
  return async () => {
    const processOrch = binding.process;
    if (!processOrch) {
      return {
        success: false,
        error: 'Orchestrator no enlazado para tarea de rutina diaria.',
      };
    }

    if (!binding.memoryService) {
      return {
        success: false,
        error: 'MemoryService no enlazado para tarea de rutina diaria.',
      };
    }

    const resolveUserId = binding.resolveEchoUserId;
    const userId = await resolveUserId?.();
    if (!userId) {
      return {
        success: false,
        error: 'Sin userId para la tarea de rutina diaria.',
      };
    }

    const memoryService = binding.memoryService;
    const skillName = ROUTINE_TO_SKILL_MAP[routineType];
    
    // Crear conversación persistente para esta rutina
    const memKey = `daily_routine_${routineType}`;
    const rows = await memoryService.recall(userId, memKey);
    const existingConversationId = rows[0]?.value?.trim();
    
    let conversationId: string;
    if (existingConversationId) {
      conversationId = existingConversationId;
    } else {
      conversationId = await memoryService.createConversation(userId);
      await memoryService.remember(userId, memKey, conversationId);
    }

    const maxRetries = 2;
    const hints = typeof binding.buildRuntimeHints === 'function' ? binding.buildRuntimeHints() : undefined;

    let lastError = 'Orchestrator no devolvió resultado';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const message = `/${skillName}`;
        const baseInput: OrchestratorInput = {
          message,
          originalMessage: message,
          conversationId,
          userId,
          source: 'echo',
          requestId: `daily-routine-${routineType}-${Date.now()}`,
          ...(hints ? { runtimeHints: hints as OrchestratorInput['runtimeHints'] } : {}),
        };

        const response = await processOrch(baseInput);
        const body = response.content?.trim() || '';

        // Enviar notificación por Telegram si hay respuesta
        if (binding.notificationGateway && body.length > 0) {
          const routineName = ROUTINE_NAMES[routineType] || routineType;
          const cap = 800; // caracteres máximos para preview
          const slice = body.length > cap ? `${body.slice(0, cap)}\n…` : body;
          
          await binding.notificationGateway.notify(userId, `[${routineName}]\n\n${slice}`, {
            priority: 'NORMAL',
            deduplicationKey: `daily-routine-${routineType}-${new Date().toISOString().slice(0, 13)}`,
          });

          return {
            success: true,
            notified: true,
            message: `${routineName} ejecutado y notificado (${response.durationMs}ms).`,
          };
        }

        return {
          success: true,
          notified: false,
          message: `Tarea ejecutada (${response.durationMs}ms, ${response.complexityUsed}).`,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt >= maxRetries) {
          break;
        }
        // Esperar antes de reintentar (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 750 * Math.pow(2, attempt)));
      }
    }

    return { 
      success: false, 
      error: `${lastError} (tras ${maxRetries + 1} intentos)` 
    };
  };
}

export function createDailyRoutineTask(
  routineType: string,
  config: DailyRoutineNotification,
  binding: EchoOrchestratorBinding
): EchoTask {
  const skillName = ROUTINE_TO_SKILL_MAP[routineType];
  const routineName = ROUTINE_NAMES[routineType] || routineType;
  
  if (!skillName) {
    throw new Error(`Unknown routine type: ${routineType}`);
  }

  const schedule = timeToCronExpression(config.time);

  return {
    id: `daily-routine-${routineType}`,
    name: routineName,
    schedule,
    enabled: config.enabled,
    taskKind: 'builtin',
    action: createDailyRoutineOrchestratorAction(routineType, binding),
  };
}

export function syncDailyRoutineTasks(
  dailyRoutineConfig: DailyRoutineConfig,
  binding: EchoOrchestratorBinding,
  existingTaskIds: Set<string>
): EchoTask[] {
  const tasks: EchoTask[] = [];
  const newTaskIds = new Set<string>();

  // Crear tareas para cada rutina configurada
  for (const [routineType, config] of Object.entries(dailyRoutineConfig)) {
    if (config.enabled) {
      try {
        const task = createDailyRoutineTask(routineType, config, binding);
        tasks.push(task);
        newTaskIds.add(task.id);
      } catch (error) {
        console.error(`[DailyRoutineTasks] Error creating task for ${routineType}:`, error);
      }
    }
  }

  // Actualizar el conjunto de IDs de tareas de rutina diaria
  existingTaskIds.clear();
  newTaskIds.forEach(id => existingTaskIds.add(id));

  return tasks;
}
