export const version = "0.1.0";

export interface EnzoConfig {
  ollamaBaseUrl: string;
  primaryModel: string;
  dbPath: string;
}

export function initializeCore(config: EnzoConfig): void {
  console.log(`Enzo Core initialized with model: ${config.primaryModel}`);
}

export * from './orchestrator/index.js';
export * from './echo/index.js';
export * from './memory/index.js';
export * from './calendar/index.js';
export * from './tools/index.js';
export * from './providers/index.js';
export * from './skills/index.js';
export * from './mcp/index.js';
export * from './voice/index.js';
export * from './input/InputChunker.js';
export * from './input/ChunkCapture.js';
export * from './config/ConfigService.js';
export * from './email/index.js';
export * from './security/EncryptionService.js';
export * from './security/SecretFile.js';
export * from './files/index.js';
export * from './vision/index.js';
export * from './supervisor/supervisorState.js';
export * from './supervisor/scheduleEnzoSupervisorRestart.js';
