import { EchoEngine } from '@enzo/core';

let sharedEchoEngine: EchoEngine | null = null;

export function getEchoEngine(): EchoEngine {
  if (!sharedEchoEngine) {
    sharedEchoEngine = new EchoEngine();
    sharedEchoEngine.registerTask({
      id: 'morning-briefing',
      name: 'Morning Briefing',
      schedule: '0 7 * * *',
      enabled: true,
      action: async () => ({ success: true, message: 'No-op morning briefing task' }),
    });
    sharedEchoEngine.registerTask({
      id: 'context-refresh',
      name: 'Context Refresh',
      schedule: 'interval:120min',
      enabled: true,
      action: async () => ({ success: true, message: 'No-op context refresh task' }),
    });
    sharedEchoEngine.registerTask({
      id: 'night-summary',
      name: 'Night Summary',
      schedule: '30 22 * * *',
      enabled: true,
      action: async () => ({ success: true, message: 'No-op night summary task' }),
    });
  }
  return sharedEchoEngine;
}
