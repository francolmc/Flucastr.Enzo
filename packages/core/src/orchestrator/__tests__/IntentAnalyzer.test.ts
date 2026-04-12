import { IntentAnalyzer } from '../IntentAnalyzer.js';
import { LLMProvider, CompletionRequest, CompletionResponse } from '../../providers/types.js';

// Mock provider for testing
class MockProvider implements LLMProvider {
  model = 'mock-model';
  name = 'mock';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // Simulate different responses based on input
    const input = JSON.stringify(request);
    
    let content = '{"type": "none", "target": "", "reason": "No action needed", "confidence": 0.5}';
    
    if (input.includes('search') || input.includes('web')) {
      content = '{"type": "tool", "target": "web_search", "reason": "User wants to search", "confidence": 0.9}';
    } else if (input.includes('execute') || input.includes('command')) {
      content = '{"type": "tool", "target": "execute_command", "reason": "User wants to execute", "confidence": 0.85}';
    } else if (input.includes('enough') || input.includes('ready')) {
      content = '{"type": "none", "target": "", "reason": "Sufficient information", "confidence": 0.8}';
    }
    
    return {
      content,
      usage: { inputTokens: 10, outputTokens: 10 },
      model: this.model,
      provider: this.name,
    };
  }
}

async function runTests() {
  const assert = (condition: boolean, message: string): void => {
    if (!condition) {
      throw new Error(message);
    }
  };

  const provider = new MockProvider();
  const analyzer = new IntentAnalyzer(provider);

  console.log('Testing IntentAnalyzer...\n');

  // Test 1: Search intent
  console.log('Test 1: Search intent');
  const result1 = await analyzer.analyzeIntent(
    'I need to search for information about TypeScript',
    [],
    [],
    []
  );
  console.log('Result:', result1);
  assert(result1.type === 'tool', 'Should detect tool type');
  assert(result1.target === 'web_search', 'Should target web_search');
  console.log('✓ Passed\n');

  // Test 2: Execute command intent
  console.log('Test 2: Execute command intent');
  const result2 = await analyzer.analyzeIntent(
    'Please execute the ls command to list files',
    [],
    [],
    []
  );
  console.log('Result:', result2);
  assert(result2.type === 'tool', 'Should detect tool type');
  assert(result2.target === 'execute_command', 'Should target execute_command');
  console.log('✓ Passed\n');

  // Test 3: No action needed
  console.log('Test 3: No action needed');
  const result3 = await analyzer.analyzeIntent(
    'I have enough information to answer the question',
    [],
    [],
    []
  );
  console.log('Result:', result3);
  assert(result3.type === 'none', 'Should detect no action needed');
  console.log('✓ Passed\n');

  console.log('All tests passed! ✓');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
