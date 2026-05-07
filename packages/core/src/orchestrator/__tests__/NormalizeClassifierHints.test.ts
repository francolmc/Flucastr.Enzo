import { normalizeClassifierLlmHints } from '../Classifier.js';
import { ComplexityLevel } from '../types.js';

console.log('Running normalizeClassifierLlmHints tests...\n');

{
  const o = normalizeClassifierLlmHints(
    {
      level: ComplexityLevel.MODERATE,
      prefersHostTools: true,
      reason: 'x',
    } as Record<string, unknown>,
    ComplexityLevel.MODERATE
  );
  if (o.prefersHostTools !== true) {
    throw new Error(`expected prefersHostTools to be true, got ${JSON.stringify(o)}`);
  }
  console.log('ok: prefersHostTools works correctly');
}

{
  const o = normalizeClassifierLlmHints(
    {
      level: ComplexityLevel.SIMPLE,
    } as Record<string, unknown>,
    ComplexityLevel.SIMPLE
  );
  if (o.level !== ComplexityLevel.SIMPLE) {
    throw new Error(`expected level to be SIMPLE, got ${JSON.stringify(o)}`);
  }
  console.log('ok: simple classification works');
}

console.log('\nAll normalizeClassifierLlmHints tests passed.');
