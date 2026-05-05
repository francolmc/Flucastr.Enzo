import type { ConfigService } from '@enzo/core';

export const VOICE_RESPONSE_TRIGGERS: readonly string[] = [];

export function getVoiceTriggers(config: ConfigService): string[] {
  const cfg = config.getSystemConfig() as unknown as Record<string, unknown>;
  const voiceTriggers = cfg['voiceTriggers'];
  return Array.isArray(voiceTriggers) && voiceTriggers.length > 0
    ? [...(voiceTriggers as string[])]
    : [...VOICE_RESPONSE_TRIGGERS];
}

export function requestsVoiceResponse(
  message: string,
  triggers: readonly string[] = VOICE_RESPONSE_TRIGGERS
): boolean {
  const lower = message.toLowerCase();
  return triggers.some((trigger) => lower.includes(trigger.toLowerCase()));
}
