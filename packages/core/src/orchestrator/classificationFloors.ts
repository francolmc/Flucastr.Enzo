import { ComplexityLevel, type AgentConfig, type ClassificationResult, type DelegationHint } from './types.js';

/**
 * When an image is attached for this turn, never stay on SIMPLE (fast path would drop pixels).
 * Ensures a {@link DelegationHint} exists so {@link AmplifierLoop} skips SIMPLE/MODERATE fast path.
 */
export function defaultDelegationHintForImage(agents: AgentConfig[]): DelegationHint {
  const anthropic = agents.find((a) => (a.provider || '').toLowerCase() === 'anthropic');
  if (anthropic) {
    return {
      agentId: anthropic.id,
      reason:
        'Image bytes are attached for this turn; prefer this Anthropic-backed preset for multimodal analysis.',
    };
  }
  return {
    agentId: 'vision_agent',
    reason: 'Image bytes are attached for this turn; built-in vision specialist.',
  };
}

export function applyClassificationFloors(
  r: ClassificationResult,
  opts: { hasImageContext: boolean; availableAgents: AgentConfig[] }
): ClassificationResult {
  if (!opts.hasImageContext) {
    return r;
  }

  let out: ClassificationResult = { ...r };
  if (out.level === ComplexityLevel.SIMPLE) {
    out = {
      ...out,
      level: ComplexityLevel.MODERATE,
      reason: `${out.reason} (image attached)`,
      classifierBranch: `${out.classifierBranch ?? 'unset'}_image_floor`,
    };
  }
  if (!out.delegationHint) {
    out = {
      ...out,
      delegationHint: defaultDelegationHintForImage(opts.availableAgents),
    };
  }
  return out;
}
