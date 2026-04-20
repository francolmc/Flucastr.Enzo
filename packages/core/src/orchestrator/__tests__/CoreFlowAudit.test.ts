import { mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { Orchestrator } from '../Orchestrator.js';
import { ComplexityLevel } from '../types.js';
import { OllamaProvider } from '../../providers/OllamaProvider.js';
import { CompletionRequest, CompletionResponse } from '../../providers/types.js';
import { MemoryService } from '../../memory/MemoryService.js';
import { DatabaseManager } from '../../memory/Database.js';
import { ToolRegistry } from '../../tools/ToolRegistry.js';
import { ExecutableTool, ToolResult } from '../../tools/types.js';

class MockOllamaProvider extends OllamaProvider {
  requests: CompletionRequest[] = [];
  correctionRequests = 0;

  constructor() {
    super('http://mock.local', 'mock-audit-model');
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);

    const systemPrompt = request.messages[0]?.content ?? '';
    const userMessage = request.messages[request.messages.length - 1]?.content ?? '';

    if (systemPrompt.includes('task complexity classifier')) {
      const lower = userMessage.toLowerCase();
      if (lower.includes('ram')) {
        return this.response('{"level":"MODERATE","reason":"system state query"}');
      }
      if (lower.includes('busca') && lower.includes('guarda')) {
        return this.response('{"level":"COMPLEX","reason":"chained actions"}');
      }
      if (lower.includes('archivo roto')) {
        return this.response('{"level":"MODERATE","reason":"file read via tool"}');
      }
      return this.response('{"level":"SIMPLE","reason":"default simple"}');
    }

    if (systemPrompt.includes('You are a task decomposer')) {
      return this.response(
        JSON.stringify({
          steps: [
            {
              id: 1,
              description: 'Search TypeScript updates',
              tool: 'web_search',
              input: 'TypeScript latest release notes',
              dependsOn: null,
            },
            {
              id: 2,
              description: 'Create summary file',
              tool: 'write_file',
              input: 'Use web results to create summary file',
              dependsOn: 1,
            },
          ],
        })
      );
    }

    if (systemPrompt.includes('Based on the following information, write a concise markdown summary.')) {
      return this.response('## Resumen\n\n- TypeScript sigue evolucionando con mejoras en tooling.');
    }

    if (systemPrompt.includes('Write a response to the user:')) {
      return this.response('Listo, preparé y guardé el resumen en /tmp/resumen.md.');
    }

    if (systemPrompt.includes('You produced an invalid tool call.')) {
      this.correctionRequests += 1;
      return this.response('{"action":"tool","tool":"read_file","input":{"path":"/missing.txt"}}');
    }

    if (systemPrompt.includes('To use a tool, respond ONLY with JSON')) {
      const lower = userMessage.toLowerCase();
      if (lower.includes('ram')) {
        return this.response('{"action":"tool","tool":"execute_command","input":{"command":"vm_stat"}}');
      }
      if (lower.includes('archivo roto')) {
        // Force correction flow by sending invalid input first.
        return this.response('{"action":"tool","tool":"read_file","input":{}}');
      }
      return this.response('Hola, ¿en qué te ayudo?');
    }

    if (systemPrompt.includes('You executed a tool and got this result:')) {
      return this.response('Resultado confirmado con datos reales de la herramienta.');
    }

    return this.response('{"action":"none"}');
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private response(content: string): CompletionResponse {
    return {
      content,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: this.model,
      provider: this.name,
    };
  }
}

class MockExecuteCommandTool implements ExecutableTool {
  name = 'execute_command';
  description = 'Mock shell command';
  parameters = {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
  };

  async execute(input: any): Promise<ToolResult> {
    const command = input?.command ?? '';
    if (command === 'vm_stat') {
      return {
        success: true,
        data: {
          stdout: 'Mach Virtual Memory Statistics: Pages free: 12345.',
          stderr: '',
        },
      };
    }

    return { success: false, error: `Unknown command: ${command}` };
  }
}

class MockWebSearchTool implements ExecutableTool {
  name = 'web_search';
  description = 'Mock web search';
  parameters = {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  };

  async execute(input: any): Promise<ToolResult> {
    return {
      success: true,
      data: {
        answer: 'TypeScript released updates recently.',
        results: [
          {
            title: 'TypeScript release',
            url: 'https://example.com/ts',
            snippet: `Query: ${input?.query ?? 'N/A'}`,
          },
        ],
      },
    };
  }
}

class MockReadFileTool implements ExecutableTool {
  name = 'read_file';
  description = 'Mock file reader';
  parameters = {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  };

  async execute(input: any): Promise<ToolResult> {
    if (input?.path === '/missing.txt') {
      return { success: false, error: 'ENOENT: file not found' };
    }
    return { success: true, data: 'Contenido de prueba' };
  }
}

class MockWriteFileTool implements ExecutableTool {
  name = 'write_file';
  description = 'Mock file writer';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  };

  writes: Array<{ path: string; content: string }> = [];

  async execute(input: any): Promise<ToolResult> {
    this.writes.push({ path: input?.path, content: input?.content });
    return { success: true, data: `File created successfully at ${input?.path}` };
  }
}

class MockRememberTool implements ExecutableTool {
  name = 'remember';
  description = 'Mock remember';
  parameters = {
    type: 'object',
    properties: {
      key: { type: 'string' },
      value: { type: 'string' },
      userId: { type: 'string' },
    },
    required: ['key', 'value', 'userId'],
  };

  async execute(input: any): Promise<ToolResult> {
    return { success: true, data: `Saved ${input?.key}` };
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  console.log('Running core flow audit E2E tests...\n');

  const dbDir = resolve(process.cwd(), 'tmp');
  mkdirSync(dbDir, { recursive: true });
  const dbPath = resolve(dbDir, 'core-flow-audit.db');
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  try {
    const memoryService = new MemoryService(dbPath);
    const provider = new MockOllamaProvider();
    const toolRegistry = new ToolRegistry();
    const execTool = new MockExecuteCommandTool();
    const webTool = new MockWebSearchTool();
    const readTool = new MockReadFileTool();
    const writeTool = new MockWriteFileTool();
    const rememberTool = new MockRememberTool();
    toolRegistry.register(webTool);
    toolRegistry.register(execTool);
    toolRegistry.register(readTool);
    toolRegistry.register(writeTool);
    toolRegistry.register(rememberTool);

    const orchestrator = new Orchestrator(provider, undefined, memoryService, { toolRegistry });

    // 1) SIMPLE path (trivial greeting)
    const simpleRes = await orchestrator.process({
      message: 'hola',
      conversationId: 'conv-simple',
      userId: 'user-audit',
      source: 'web',
      userLanguage: 'es',
    });
    assert(simpleRes.complexityUsed === ComplexityLevel.SIMPLE, 'Expected SIMPLE for greeting');
    assert(simpleRes.content.length > 0, 'Expected non-empty SIMPLE response');
    console.log('✓ SIMPLE flow works');

    // Add persisted memory and verify it is injected in later requests.
    await memoryService.remember('user-audit', 'city', 'Copiapo');

    // 2) MODERATE path with tool execution
    const moderateRes = await orchestrator.process({
      message: '¿cuánta RAM libre tengo?',
      conversationId: 'conv-moderate',
      userId: 'user-audit',
      source: 'web',
      userLanguage: 'es',
    });
    assert(moderateRes.complexityUsed === ComplexityLevel.MODERATE, 'Expected MODERATE for RAM query');
    assert(
      moderateRes.content.toLowerCase().includes('pages free'),
      'Expected execute_command output in MODERATE response'
    );
    const moderateHistory = await memoryService.getHistory('conv-moderate');
    assert(moderateHistory.length >= 2, 'Expected user+assistant messages persisted for MODERATE flow');
    console.log('✓ MODERATE flow works with tool call and persistence');

    // 3) COMPLEX path with decomposition and sequential tool execution
    const complexRes = await orchestrator.process({
      message: 'busca novedades de TypeScript y guarda un resumen en /tmp/resumen.md',
      originalMessage: 'busca novedades de TypeScript y guarda un resumen en /tmp/resumen.md',
      conversationId: 'conv-complex',
      userId: 'user-audit',
      source: 'web',
      userLanguage: 'es',
    });
    assert(complexRes.complexityUsed === ComplexityLevel.COMPLEX, 'Expected COMPLEX for chained task');
    assert(
      complexRes.content.includes('/tmp/resumen.md'),
      'Expected synthesized COMPLEX response mentioning output path'
    );
    assert(
      writeTool.writes.some((entry) => entry.path === '/tmp/resumen.md'),
      'Expected write_file step to target /tmp/resumen.md'
    );
    console.log('✓ COMPLEX flow works with decomposition and synthesis');

    // 4) Invalid tool input -> correction retry -> tool failure surfaced
    const retryRes = await orchestrator.process({
      message: 'lee archivo roto',
      conversationId: 'conv-retry',
      userId: 'user-audit',
      source: 'web',
      userLanguage: 'es',
    });
    assert(provider.correctionRequests > 0, 'Expected correction retry for invalid tool input');
    assert(
      retryRes.content.toLowerCase().includes('error'),
      'Expected failure message returned when corrected tool execution fails'
    );
    console.log('✓ Retry/correction flow works for invalid tool payloads');

    const memoryInjected = provider.requests.some((request) =>
      request.messages.some((message) => message.content.includes('[IMPORTANT - USER PROFILE:'))
    );
    assert(memoryInjected, 'Expected memory block to be injected into context');
    console.log('✓ Memory block injected into runtime context');

    console.log('\nCore flow audit E2E tests passed.');
  } finally {
    DatabaseManager.getInstance().close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Core flow audit E2E tests failed:', error);
    process.exit(1);
  });
