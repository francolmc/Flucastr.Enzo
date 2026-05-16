export const version = "0.1.0";

export interface EnzoConfig {
  ollamaBaseUrl: string;
  primaryModel: string;
  dbPath: string;
}

export function initializeCore(config: EnzoConfig): void {
  console.log(`Enzo Core initialized with model: ${config.primaryModel}`);
}

export * from './adapters/index.js';
export * from './orchestrator/index.js';
export type { VisionService, VisionResult } from './agents/VisionAgent.js';
export * from './echo/index.js';
export * from './memory/index.js';
export * from './tools/index.js';
export * from './providers/index.js';
export * from './skills/index.js';
export * from './mcp/index.js';
export * from './input/InputChunker.js';
export * from './input/ChunkCapture.js';
export * from './config/ConfigService.js';
export * from './config/UserPreferences.js';
export * from './security/EncryptionService.js';
export * from './security/SecretFile.js';
export * from './supervisor/supervisorState.js';
export * from './supervisor/scheduleEnzoSupervisorRestart.js';
export * from './commands/index.js';
export * from './text/index.js';
export * from './logging/DecisionLogger.js';
