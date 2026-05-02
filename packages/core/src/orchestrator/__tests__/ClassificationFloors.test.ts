import { ComplexityLevel, type AgentConfig, type ClassificationResult } from '../types.js';
import { applyClassificationFloors, defaultDelegationHintForImage } from '../classificationFloors.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const visorAgent: AgentConfig = {
  id: 'visor-uuid',
  name: 'Visor',
  description: 'vision',
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
};

function testDefaultHintPrefersAnthropicPreset(): void {
  const h = defaultDelegationHintForImage([visorAgent]);
  assert(h.agentId === 'visor-uuid', 'anthropic preset preferred');
  assert(h.reason.includes('Anthropic'), 'reason mentions path');
}

function testDefaultHintFallsBackToVisionAgent(): void {
  const h = defaultDelegationHintForImage([
    { id: 'x', name: 'x', description: '', provider: 'ollama', model: 'llama' },
  ]);
  assert(h.agentId === 'vision_agent', 'fallback vision_agent');
}

function testFloorBumpsSimpleToModerateWithHint(): void {
  const raw: ClassificationResult = {
    level: ComplexityLevel.SIMPLE,
    reason: 'casual',
    classifierBranch: 'llm',
  };
  const out = applyClassificationFloors(raw, {
    hasImageContext: true,
    availableAgents: [visorAgent],
  });
  assert(out.level === ComplexityLevel.MODERATE, 'level bumped');
  assert(out.delegationHint?.agentId === 'visor-uuid', 'hint from floor');
  assert(Boolean(out.classifierBranch?.includes('image_floor')), 'branch tagged');
}

function testNoFloorWithoutImage(): void {
  const raw: ClassificationResult = {
    level: ComplexityLevel.SIMPLE,
    reason: 'casual',
    classifierBranch: 'llm',
  };
  const out = applyClassificationFloors(raw, { hasImageContext: false, availableAgents: [visorAgent] });
  assert(out.level === ComplexityLevel.SIMPLE, 'unchanged');
  assert(out.delegationHint === undefined, 'no hint');
}

async function run(): Promise<void> {
  testDefaultHintPrefersAnthropicPreset();
  testDefaultHintFallsBackToVisionAgent();
  testFloorBumpsSimpleToModerateWithHint();
  testNoFloorWithoutImage();
  console.log('ClassificationFloors tests passed.');
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
