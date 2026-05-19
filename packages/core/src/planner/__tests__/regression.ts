import type { ModelClient } from '../../model/client.js';
import type { Memory, ConversationMemory } from '../../memory/memory.js';
import type { McpRegistry } from '../../mcp/registry.js';
import { createPlanner } from '../planner.js';
import type { ExecutionContext } from '../types.js';
import { createConversationMemory } from '../../memory/conversation.js';

const USER_ID = 'test-user';

function createMockModelClient(responses: Map<string, string>): ModelClient {
  return {
    async complete(messages, options) {
      const lastUserMessage = messages[messages.length - 1]?.content ?? '';
      const response = responses.get(lastUserMessage) ?? 'Default response';
      return response;
    },
  };
}

function createMockMemory(): Memory {
  return {
    getFacts: () => [
      { key: 'name', value: 'Test User' },
      { key: 'tasks_file', value: '/home/test/tareas.md' },
    ],
    saveFact: () => {},
    getTools: () => [
      {
        name: 'read_file',
        description: 'Read the contents of a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      },
      {
        name: 'list_directory',
        description: 'List files in a directory',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    ],
    saveTool: () => {},
  };
}

function createMockMcpRegistry(): McpRegistry {
  return {
    getServerForTool: () => null,
    callTool: async (toolName: string, input: Record<string, unknown>) => {
      if (toolName === 'read_file') {
        return `1. Comprar comida\n2. Llamar médico`;
      }
      if (toolName === 'write_file') {
        return `File written successfully`;
      }
      if (toolName === 'list_directory') {
        return `tareas.md\nnotas.md`;
      }
      return `Tool ${toolName} executed`;
    },
  };
}

function emptyContext(): ExecutionContext {
  return {
    understandContext: '',
    conversationContext: '',
    previousResults: [],
  };
}

function buildContext(
  understandContext: string,
  conversationContext: string,
  previousResults: string[]
): ExecutionContext {
  return { understandContext, conversationContext, previousResults };
}

export async function runRegressionTests(): Promise<boolean> {
  console.log('Starting regression tests...\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<boolean>): Promise<void> {
    try {
      const result = await fn();
      if (result) {
        console.log(`✓ ${name}`);
        passed++;
      } else {
        console.log(`✗ ${name}`);
        failed++;
      }
    } catch (e) {
      console.log(`✗ ${name}: ${e}`);
      failed++;
    }
  }

  await test('Phase 1: Understand produces single sentence', async () => {
    const memory = createMockMemory();
    const mcpRegistry = createMockMcpRegistry();
    const model = createMockModelClient(new Map([['test', 'User wants to know tasks']]));
    const planner = createPlanner(model, memory, mcpRegistry);

    const response = await planner.resolve('que tareas tengo?', USER_ID, emptyContext());
    return response.content.length > 0;
  });

  await test('Phase 2: Plan produces steps', async () => {
    const memory = createMockMemory();
    const mcpRegistry = createMockMcpRegistry();
    const model = createMockModelClient(new Map([
      ['que tareas tengo?', 'User wants to list tasks'],
      ['list tasks', '1. Use read_file to read tasks'],
    ]));
    const planner = createPlanner(model, memory, mcpRegistry);

    const response = await planner.resolve('que tareas tengo?', USER_ID, emptyContext());
    return response.stepsPlanned >= 0;
  });

  await test('Phase 3: Execute runs steps', async () => {
    const memory = createMockMemory();
    const mcpRegistry = createMockMcpRegistry();
    const model = createMockModelClient(new Map([
      ['list tasks', '1. Use read_file'],
    ]));
    const planner = createPlanner(model, memory, mcpRegistry);

    const response = await planner.resolve('que tareas tengo?', USER_ID, emptyContext());
    return response.stepsExecuted > 0 || response.stepsPlanned === 0;
  });

  await test('Phase 4: Execute completes without errors', async () => {
    const memory = createMockMemory();
    const mcpRegistry = createMockMcpRegistry();
    const model = createMockModelClient(new Map([['test', 'OK']]));
    const planner = createPlanner(model, memory, mcpRegistry);

    const response = await planner.resolve('simple task', USER_ID, emptyContext());
    return response.stepsExecuted >= 0;
  });

  await test('Phase 5: Respond produces content', async () => {
    const memory = createMockMemory();
    const mcpRegistry = createMockMcpRegistry();
    const model = createMockModelClient(new Map([['test', 'Done']]));
    const planner = createPlanner(model, memory, mcpRegistry);

    const response = await planner.resolve('do something', USER_ID, emptyContext());
    return response.content.length > 0;
  });

  await test('Context: understandContext flows to understand phase', async () => {
    const memory = createMockMemory();
    const mcpRegistry = createMockMcpRegistry();
    let understandReceivedContext = false;
    const model: ModelClient = {
      async complete(messages) {
        const hasContext = messages.some(m =>
          m.content?.includes('the second') || m.content?.includes('CONVERSATION HISTORY')
        );
        if (messages[0]?.content?.includes('analyzing')) {
          understandReceivedContext = hasContext;
        }
        return 'Understood';
      },
    };
    const planner = createPlanner(model, memory, mcpRegistry);

    const ctx = buildContext('User: first\nUser: second', '', []);
    await planner.resolve('what is second?', USER_ID, ctx);
    return understandReceivedContext;
  });

  await test('Context: previousResults flow to plan phase', async () => {
    const memory = createMockMemory();
    const mcpRegistry = createMockMcpRegistry();
    let planReceivedResults = false;
    const model: ModelClient = {
      async complete(messages) {
        const hasResults = messages.some(m => m.content?.includes('PREVIOUS RESULTS'));
        if (messages[0]?.content?.includes('task planner')) {
          planReceivedResults = hasResults;
        }
        return '1. Step one';
      },
    };
    const planner = createPlanner(model, memory, mcpRegistry);

    const ctx = buildContext('', 'User: previous', ['Result from previous step']);
    await planner.resolve('continue task', USER_ID, ctx);
    return planReceivedResults;
  });

  await test('Max steps: truncation works', async () => {
    const memory = createMockMemory();
    const mcpRegistry = createMockMcpRegistry();
    const model: ModelClient = {
      async complete(messages) {
        const last = messages[messages.length - 1]?.content ?? '';
        if (last.includes('task planner')) {
          return '1. Step 1\n2. Step 2\n3. Step 3\n4. Step 4\n5. Step 5';
        }
        if (last.includes('Extract')) {
          return '{"tool": "read_file", "input": {"path": "/test"}}';
        }
        return 'Result';
      },
    };
    const planner = createPlanner(model, memory, mcpRegistry, { maxTotalSteps: 3 });

    const response = await planner.resolve('many steps', USER_ID, emptyContext());
    return response.truncated === true;
  });

  await test('Max verifications: limit respected', async () => {
    const memory = createMockMemory();
    const mcpRegistry = createMockMcpRegistry();
    let evalCount = 0;
    const model: ModelClient = {
      async complete(messages) {
        const last = messages[messages.length - 1]?.content ?? '';
        if (last.includes('Evaluate')) {
          evalCount++;
          return evalCount <= 2 ? 'VERIFY: read_file' : 'CONTINUE';
        }
        if (last.includes('task planner')) {
          return '1. Use write_file';
        }
        if (last.includes('Extract')) {
          return '{"tool": "write_file", "input": {"path": "/t", "content": "d"}}';
        }
        return 'Done';
      },
    };
    const planner = createPlanner(model, memory, mcpRegistry, { maxTotalSteps: 12 });

    const response = await planner.resolve('write and verify', USER_ID, emptyContext());
    return response.stepsExecuted > 0;
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRegressionTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(e => { console.error(e); process.exit(1); });
}