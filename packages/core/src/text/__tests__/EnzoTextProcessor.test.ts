/**
 * Tests for EnzoTextProcessor
 * 
 * These tests verify the text processing interface works correctly.
 * Note: Full integration tests require an Orchestrator instance.
 */

import { EnzoTextProcessor } from '../EnzoTextProcessor.js';
import type { TextInput, TextOutput } from '../types.js';

// Simple assertion helpers
function assertEq<T>(a: T, b: T, message: string): void {
  if (a !== b) {
    throw new Error(`${message} (expected ${b}, got ${a})`);
  }
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// Mock implementations for testing
class MockOrchestrator {
  processCalled = false;
  classifyCalled = false;
  lastInput: any = null;

  async process(input: any) {
    this.processCalled = true;
    this.lastInput = input;
    return {
      content: `Response to: ${input.message}`,
      complexityUsed: 'SIMPLE',
      providerUsed: 'mock',
      modelUsed: 'mock-model',
      injectedSkills: [],
      durationMs: 100,
      usage: { inputTokens: 10, outputTokens: 20 },
    };
  }

  async classifyDetailed(message: string, userId: string, conversationId?: string, source?: string) {
    this.classifyCalled = true;
    return {
      level: 'SIMPLE',
      reason: 'Test classification',
      classifierBranch: 'test',
    };
  }
}

class MockMemoryService {
  createConversationCalled = false;

  async createConversation(userId: string) {
    this.createConversationCalled = true;
    return `conv-${userId}`;
  }
}

async function runTests() {
  console.log('Running EnzoTextProcessor tests...\n');

  const mockOrchestrator = new MockOrchestrator();
  const mockMemoryService = new MockMemoryService();

  const processor = new EnzoTextProcessor(
    {
      orchestrator: mockOrchestrator as any,
      memoryService: mockMemoryService as any,
    },
    { defaultSource: 'telegram' }
  );

  // Test 1: getFeatures
  console.log('Test 1: getFeatures');
  const features = processor.getFeatures();
  assertCondition(features.supportsStreaming, 'Should support streaming');
  assertCondition(features.supportsClassification, 'Should support classification');
  assertCondition(features.supportsTranslation, 'Should support translation');
  assertCondition(features.supportsProgressTracking, 'Should support progress tracking');
  assertEq(features.maxInputLength, 50000, 'Max input length should be 50000');
  assertCondition(features.supportedSources.includes('telegram'), 'Should support telegram');
  assertCondition(features.supportedSources.includes('web'), 'Should support web');
  assertCondition(features.supportedSources.includes('cli'), 'Should support cli');
  console.log('✓ Features reported correctly\n');

  // Test 2: process with minimal input
  console.log('Test 2: process with minimal input');
  const input: TextInput = {
    content: 'Hello',
    userId: '123',
    source: 'telegram',
  };
  const output = await processor.process(input);
  assertCondition(mockOrchestrator.processCalled, 'Orchestrator.process should be called');
  assertEq(output.content, 'Response to: Hello', 'Content should match expected');
  assertEq(output.complexityUsed, 'SIMPLE', 'Complexity should be SIMPLE');
  assertEq(output.providerUsed, 'mock', 'Provider should be mock');
  assertEq(output.wasStreamed, false, 'wasStreamed should be false');
  assertCondition(output.durationMs >= 0, 'Duration should be >= 0');
  console.log('✓ Process works with minimal input\n');

  // Test 3: process with all fields
  console.log('Test 3: process with all fields');
  mockOrchestrator.processCalled = false;
  const fullInput: TextInput = {
    content: 'Test message',
    originalContent: 'Test mensaje',
    userId: '456',
    conversationId: 'conv-456',
    source: 'web',
    language: 'es',
    wasTranslated: true,
    agentId: 'agent-1',
    requestId: 'req-123',
    metadata: { extra: 'data' },
  };
  const fullOutput = await processor.process(fullInput);
  assertCondition(mockOrchestrator.processCalled, 'Orchestrator.process should be called');
  assertEq(mockOrchestrator.lastInput.message, 'Test message', 'Message should be passed');
  assertEq(mockOrchestrator.lastInput.originalMessage, 'Test mensaje', 'Original message should be passed');
  assertEq(mockOrchestrator.lastInput.userId, '456', 'UserId should be passed');
  assertEq(mockOrchestrator.lastInput.conversationId, 'conv-456', 'ConversationId should be passed');
  assertEq(mockOrchestrator.lastInput.source, 'web', 'Source should be passed');
  assertEq(mockOrchestrator.lastInput.userLanguage, 'es', 'Language should be passed');
  assertEq(mockOrchestrator.lastInput.agentId, 'agent-1', 'AgentId should be passed');
  assertEq(mockOrchestrator.lastInput.requestId, 'req-123', 'RequestId should be passed');
  console.log('✓ Process works with all fields\n');

  // Test 4: classify
  console.log('Test 4: classify');
  mockOrchestrator.classifyCalled = false;
  const classification = await processor.classify({
    content: 'Test message',
    userId: '789',
    conversationId: 'conv-789',
    source: 'cli',
  });
  assertCondition(mockOrchestrator.classifyCalled, 'Orchestrator.classifyDetailed should be called');
  assertEq(classification.level, 'SIMPLE', 'Level should be SIMPLE');
  assertEq(classification.reason, 'Test classification', 'Reason should match');
  console.log('✓ Classification works\n');

  // Test 5: classify with default source
  console.log('Test 5: classify with default source');
  mockOrchestrator.classifyCalled = false;
  const defaultClassification = await processor.classify({
    content: 'Another test',
    userId: '999',
  });
  assertCondition(mockOrchestrator.classifyCalled, 'Orchestrator.classifyDetailed should be called');
  console.log('✓ Classification with default source works\n');

  // Test 6: processStream (basic)
  console.log('Test 6: processStream (basic)');
  mockOrchestrator.processCalled = false;
  const streamInput: TextInput = {
    content: 'Stream test',
    userId: 'stream-user',
    source: 'api',
  };
  const events: any[] = [];
  for await (const event of processor.processStream(streamInput)) {
    events.push(event);
  }
  assertCondition(events.length > 0, 'Should receive events');
  assertEq(events[0].type, 'start', 'First event should be start');
  assertCondition(events.some(e => e.type === 'chunk'), 'Should have chunk events');
  assertCondition(events.some(e => e.type === 'complete'), 'Should have complete event');
  console.log('✓ Process stream works\n');

  console.log('All EnzoTextProcessor tests passed! ✓');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
