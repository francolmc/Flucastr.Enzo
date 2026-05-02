import { normalizeClassifierLlmHints } from '../Classifier.js';
import { ComplexityLevel } from '../types.js';

console.log('Running normalizeClassifierLlmHints tests...\n');

{
  const o = normalizeClassifierLlmHints(
    {
      level: ComplexityLevel.MODERATE,
      suggestedTool: 'web_search',
      prefersHostTools: true,
      reason: 'x',
    } as Record<string, unknown>,
    ComplexityLevel.MODERATE
  );
  if (o.suggestedTool !== undefined || o.prefersHostTools !== true) {
    throw new Error(`expected prefersHostTools to strip web_search, got ${JSON.stringify(o)}`);
  }
  console.log('ok: prefersHostTools drops conflicting web_search');
}

{
  const o = normalizeClassifierLlmHints(
    {
      suggestedTool: 'web_search',
    } as Record<string, unknown>,
    ComplexityLevel.MODERATE
  );
  if (o.suggestedTool !== 'web_search') {
    throw new Error(`expected web_search retained without prefersHostTools, got ${JSON.stringify(o)}`);
  }
  console.log('ok: web_search preserved without prefersHostTools');
}

console.log('\nAll normalizeClassifierLlmHints tests passed.');
