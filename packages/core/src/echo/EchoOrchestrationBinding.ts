import type { OrchestratorInput, OrchestratorResponse } from '../orchestrator/types.js';
import type { MemoryService } from '../memory/MemoryService.js';
import type { NotificationGateway } from './NotificationGateway.js';

/** Runtime wiring for ejecutar prompts vía Orchestrator desde Echo (solo disponible donde se llame a bind). */
export interface EchoOrchestratorBinding {
  process?: (input: OrchestratorInput) => Promise<OrchestratorResponse>;
  memoryService?: MemoryService;
  resolveEchoUserId?: () => Promise<string | undefined>;
  notificationGateway?: Pick<NotificationGateway, 'notify'>;
  /** Hints opcionales (timezone, locale, HOME, etc.). */
  buildRuntimeHints?: () => Record<string, unknown>;
}
