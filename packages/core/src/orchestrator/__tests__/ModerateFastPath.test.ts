import { AmplifierLoop } from '../AmplifierLoop.js';
import {
  ComplexityLevel,
  type AmplifierInput,
  AVAILABLE_TOOLS,
} from '../types.js';
import type { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';
import type { ExecutableTool, ToolResult } from '../../tools/types.js';
import { createDefaultAmplifierLoopLog, type AmplifierLoopLog } from '../amplifier/AmplifierLoopLog.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

class QueueProvider implements LLMProvider {
  name = 'mock';
  model = 'mock-model';
  constructor(private queue: string[]) {}
  async isAvailable(): Promise<boolean> { return true; }
  async complete(_r: CompletionRequest): Promise<CompletionResponse> {
    return {
      content: this.queue.length > 0 ? this.queue.shift()! : '',
      usage: { inputTokens: 10, outputTokens: 10 },
      model: this.model,
      provider: this.name,
    };
  }
}

class MockListDirectoryTool implements ExecutableTool {
  name = 'mcp_filesystem_list_directory';
  description = 'List directory contents';
  parameters = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Directory path' },
    },
    required: ['path'],
  };
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return {
      success: true,
      output: `Contents of ${input.path}:\n- file1.txt\n- file2.txt\n- folder/`,
    };
  }
}

class MockRememberTool implements ExecutableTool {
  name = 'remember';
  description = 'Store information in user memory';
  parameters = {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: 'Information to remember' },
    },
    required: ['content'],
  };
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return {
      success: true,
      output: `Remembered: ${input.content}`,
    };
  }
}

class MockWriteFileTool implements ExecutableTool {
  name = 'write_file';
  description = 'Write content to a file';
  parameters = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path' },
      content: { type: 'string', description: 'Content' },
    },
    required: ['path', 'content'],
  };
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return {
      success: true,
      output: `File written: ${input.path}`,
    };
  }
}

function buildInput(message: string, overrides: Partial<AmplifierInput> = {}): AmplifierInput {
  return {
    message,
    conversationId: 'c1',
    userId: 'u1',
    history: [],
    availableTools: [...AVAILABLE_TOOLS],
    availableSkills: [],
    availableAgents: [],
    userLanguage: 'es',
    ...overrides,
  };
}

class TestLogger implements AmplifierLoopLog {
  public logs: Array<{ level: string; args: any[] }> = [];
  
  debug(...args: any[]): void {
    this.logs.push({ level: 'debug', args });
  }
  
  info(...args: any[]): void {
    this.logs.push({ level: 'info', args });
  }
  
  warn(...args: any[]): void {
    this.logs.push({ level: 'warn', args });
  }
  
  error(...args: any[]): void {
    this.logs.push({ level: 'error', args });
  }
  
  hasLog(pattern: string): boolean {
    return this.logs.some(log => 
      log.args.some(arg => 
        typeof arg === 'string' && arg.includes(pattern)
      )
    );
  }
  
  reset(): void {
    this.logs = [];
  }
}

// ─── Test 1: MODERATE + filesystem operation → fast path ────────────────────

async function testModerateFastPathFilesystem(): Promise<void> {
  console.log('Test 1: MODERATE + filesystem operation → fast path (1 iteration)');
  
  const logger = new TestLogger();
  const toolCallJson = JSON.stringify({
    action: 'tool',
    tool: 'mcp_filesystem_list_directory',
    input: { path: '/Users/franco' },
  });
  const synthesisResponse = 'Aquí está el contenido del directorio.';
  
  const provider = new QueueProvider([toolCallJson, synthesisResponse]);
  const listDirTool = new MockListDirectoryTool();
  
  const loop = new AmplifierLoop(provider, [listDirTool], { log: logger });
  
  const result = await loop.amplify({
    ...buildInput('lista el contenido de /Users/franco'),
    classifiedLevel: ComplexityLevel.MODERATE,
    availableTools: [listDirTool],
  });
  
  // Verify fast path was used
  assert(logger.hasLog('Fast-path MODERATE'), 'Should log "Fast-path MODERATE"');
  assert(!logger.hasLog('MODERATE level - going through full ReAct loop'), 
    'Should NOT log "MODERATE level - going through full ReAct loop"');
  
  // Verify tool was executed in first iteration
  assert(result.toolsUsed?.includes('mcp_filesystem_list_directory'), 
    'Should have used list_directory tool');
  assert(result.stepsUsed && result.stepsUsed.length <= 3, 
    `Should complete in ~3 steps (tool call + synthesis), got ${result.stepsUsed?.length}`);
  
  console.log('  ✓ MODERATE task used fast path with MCP tool\n');
}

// ─── Test 2: MODERATE + remember tool → fast path ───────────────────────────

async function testModerateFastPathRemember(): Promise<void> {
  console.log('Test 2: MODERATE + remember tool → fast path');
  
  const logger = new TestLogger();
  const toolCallJson = JSON.stringify({
    action: 'tool',
    tool: 'remember',
    input: { content: 'Trabajo en NTT Data' },
  });
  const synthesisResponse = 'Perfecto, lo recordaré.';
  
  const provider = new QueueProvider([toolCallJson, synthesisResponse]);
  const rememberTool = new MockRememberTool();
  
  const loop = new AmplifierLoop(provider, [rememberTool], { log: logger });
  
  const result = await loop.amplify({
    ...buildInput('recuerda que trabajo en NTT Data'),
    classifiedLevel: ComplexityLevel.MODERATE,
    availableTools: [rememberTool],
  });
  
  // Verify fast path
  assert(logger.hasLog('Fast-path MODERATE'), 'Should use fast path for remember tool');
  assert(!logger.hasLog('going through full ReAct loop'), 'Should not enter full ReAct loop');
  
  // Verify single tool execution
  assert(result.toolsUsed?.includes('remember'), 'Should use remember tool');
  assert(result.stepsUsed && result.stepsUsed.length <= 3, 
    `Should complete quickly, got ${result.stepsUsed?.length} steps`);
  
  console.log('  ✓ MODERATE "remember" task used fast path\n');
}

// ─── Test 3: SIMPLE still works → fast path ─────────────────────────────────

async function testSimpleFastPathStillWorks(): Promise<void> {
  console.log('Test 3: SIMPLE task → fast path (no regression)');
  
  const logger = new TestLogger();
  const proseResponse = 'Hola, ¿cómo puedo ayudarte?';
  
  const provider = new QueueProvider([proseResponse]);
  const loop = new AmplifierLoop(provider, [], { log: logger });
  
  const result = await loop.amplify({
    ...buildInput('hola cómo estás'),
    classifiedLevel: ComplexityLevel.SIMPLE,
    availableTools: [],
  });
  
  // Verify fast path for SIMPLE
  assert(logger.hasLog('Fast-path SIMPLE'), 'SIMPLE should still use fast path');
  assert(result.content.length > 0, 'Should return prose response');
  assert(!result.toolsUsed || result.toolsUsed.length === 0, 'Should not use tools for greeting');
  
  console.log('  ✓ SIMPLE path not affected by MODERATE fix\n');
}

// ─── Test 4: COMPLEX → Decomposer (not fast path) ───────────────────────────

async function testComplexGoesToDecomposer(): Promise<void> {
  console.log('Test 4: COMPLEX task → Decomposer (bypasses fast path)');
  
  const logger = new TestLogger();
  
  // Mock decomposition response (empty plan fallback to ReAct)
  const decompositionResponse = JSON.stringify({ steps: [] });
  const toolCallJson = JSON.stringify({
    action: 'tool',
    tool: 'write_file',
    input: { path: '/tmp/atacama.md', content: '# Atacama' },
  });
  const synthesisResponse = 'Archivo creado con información del Atacama.';
  
  const provider = new QueueProvider([decompositionResponse, toolCallJson, synthesisResponse]);
  const writeTool = new MockWriteFileTool();
  
  const loop = new AmplifierLoop(provider, [writeTool], { log: logger });
  
  const result = await loop.amplify({
    ...buildInput('busca información sobre Atacama y crea /tmp/atacama.md con el resumen'),
    classifiedLevel: ComplexityLevel.COMPLEX,
    availableTools: [writeTool],
  });
  
  // Verify COMPLEX path was used
  assert(logger.hasLog('COMPLEX task'), 'Should log COMPLEX decomposition');
  assert(!logger.hasLog('Fast-path'), 'COMPLEX should NOT use fast path');
  
  console.log('  ✓ COMPLEX task correctly bypasses fast path\n');
}

// ─── Test 5: MODERATE + imageContext → full ReAct (bypassed) ────────────────

async function testModeratePlusImageBypassesFastPath(): Promise<void> {
  console.log('Test 5: MODERATE + imageContext → full ReAct loop (fast path bypassed)');
  
  const logger = new TestLogger();
  const proseResponse = 'Imagen procesada.';
  
  const provider = new QueueProvider([proseResponse]);
  const loop = new AmplifierLoop(provider, [], { log: logger });
  
  const result = await loop.amplify({
    ...buildInput('describe esta imagen'),
    classifiedLevel: ComplexityLevel.MODERATE,
    availableTools: [],
    imageContext: {
      base64: 'mockBase64Data',
      mimeType: 'image/png',
    },
  });
  
  // Verify fast path was bypassed due to imageContext
  assert(!logger.hasLog('Fast-path'), 
    'imageContext should prevent fast path even for MODERATE');
  
  console.log('  ✓ imageContext correctly bypasses MODERATE fast path\n');
}

// ─── Test 6: MODERATE + delegationHint → full ReAct (bypassed) ──────────────

async function testModeratePlusDelegationBypassesFastPath(): Promise<void> {
  console.log('Test 6: MODERATE + delegationHint → bypasses fast path');
  
  const logger = new TestLogger();
  const proseResponse = 'Delegación procesada.';
  
  const provider = new QueueProvider([proseResponse]);
  const loop = new AmplifierLoop(provider, [], { log: logger });
  
  const result = await loop.amplify({
    ...buildInput('ejecuta esta tarea compleja'),
    classifiedLevel: ComplexityLevel.MODERATE,
    availableTools: [],
    delegationHint: {
      agentId: 'vision_agent',
      reason: 'Test delegation',
    },
  });
  
  // Verify fast path was bypassed
  assert(!logger.hasLog('Fast-path'), 
    'delegationHint should prevent fast path');
  
  console.log('  ✓ delegationHint correctly bypasses MODERATE fast path\n');
}

// ─── Run all tests ───────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log('\n═══ MODERATE Fast Path Regression Tests ═══\n');
  
  try {
    await testModerateFastPathFilesystem();
    await testModerateFastPathRemember();
    await testSimpleFastPathStillWorks();
    await testComplexGoesToDecomposer();
    await testModeratePlusImageBypassesFastPath();
    await testModeratePlusDelegationBypassesFastPath();
    
    console.log('═══ All Tests Passed ✓ ═══\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
