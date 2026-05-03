import { normalizeFastPathToolCall } from '../amplifier/AmplifierLoopFastPathTools.js';
import type { ExecutableTool } from '../../tools/types.js';

function execToolStub(): ExecutableTool {
  return {
    name: 'execute_command',
    description: '',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: 'cmd' } },
      required: ['command'],
    },
    execute: async () => ({ success: true, output: '' }),
  };
}

console.log('EnvelopeShellBinaryCoercion tests...\n');

{
  const tools: ExecutableTool[] = [execToolStub()];
  const r = normalizeFastPathToolCall(
    { action: 'tool', tool: 'gh', input: { command: 'repos' } },
    tools
  );
  if (r.toolName !== 'execute_command' || r.toolInput.command !== 'gh repos') {
    throw new Error(JSON.stringify(r));
  }
  console.log('ok: tool gh + command repos → execute_command gh repos');
}

{
  const tools: ExecutableTool[] = [execToolStub()];
  const r = normalizeFastPathToolCall(
    { action: 'tool', tool: 'git', input: { command: 'status' } },
    tools
  );
  if (r.toolName !== 'execute_command' || r.toolInput.command !== 'git status') {
    throw new Error(JSON.stringify(r));
  }
  console.log('ok: git status merged');
}

{
  const tools: ExecutableTool[] = [execToolStub()];
  const r = normalizeFastPathToolCall(
    { action: 'tool', tool: 'gh', input: { command: 'gh repo list --limit 5' } },
    tools
  );
  if (r.toolInput.command !== 'gh repo list --limit 5') {
    throw new Error(`expected duplicate gh stripped to full line, got ${String(r.toolInput.command)}`);
  }
  console.log('ok: fragment already prefixed with tool token → use fragment');
}

console.log('\nEnvelopeShellBinaryCoercion tests passed.');
