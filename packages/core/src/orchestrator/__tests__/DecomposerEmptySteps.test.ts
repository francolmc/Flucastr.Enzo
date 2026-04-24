import assert from 'node:assert/strict';
import { Decomposer } from '../Decomposer.js';
import type { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';

class EmptyStepsProvider implements LLMProvider {
  name = 'mock';
  model = 'mock';

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    return {
      content: '{"steps":[]}',
      usage: { inputTokens: 0, outputTokens: 0 },
      model: this.model,
      provider: this.name,
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

const decomposer = new Decomposer(new EmptyStepsProvider());

const result = await decomposer.decompose('any message', ['web_search', 'write_file']);
assert.equal(Array.isArray(result.steps), true);
assert.equal(result.steps.length, 0);
console.log('DecomposerEmptySteps: empty plan parsed OK');
