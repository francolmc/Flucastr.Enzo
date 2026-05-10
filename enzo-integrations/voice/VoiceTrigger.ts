import type { ConfigService } from '../config/ConfigService.js';

export const VOICE_RESPONSE_TRIGGERS = [
  'respondeme por voz',
  'en audio',
  'mándame un audio',
  'mandame un audio',
  'responde en audio',
  'en voz',
] as const;

export function getVoiceTriggers(config: ConfigService): string[] {
  const { voiceTriggers } = config.getSystemConfig();
  return Array.isArray(voiceTriggers) && voiceTriggers.length > 0
    ? [...voiceTriggers]
    : [...VOICE_RESPONSE_TRIGGERS];
}

export function requestsVoiceResponse(
  message: string,
  triggers: readonly string[] = VOICE_RESPONSE_TRIGGERS
): boolean {
  const lower = message.toLowerCase();
  return triggers.some((trigger) => lower.includes(trigger.toLowerCase()));
}
