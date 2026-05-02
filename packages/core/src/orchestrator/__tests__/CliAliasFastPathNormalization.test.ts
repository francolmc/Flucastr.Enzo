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

function readFileStub(): ExecutableTool {
  return {
    name: 'read_file',
    description: '',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'p' } },
      required: ['path'],
    },
    execute: async () => ({ success: true, output: '' }),
  };
}

console.log('CliAliasFastPathNormalization tests...\n');

{
  const tools: ExecutableTool[] = [execToolStub()];
  const r = normalizeFastPathToolCall(
    { action: 'tool', tool: 'gh', input: { command: 'repo list' } },
    tools
  );
  if (r.toolName !== 'execute_command' || r.toolInput.command !== 'gh repo list') {
    throw new Error(JSON.stringify(r));
  }
  console.log('ok: gh + repo list → execute_command');
}

{
  const tools: ExecutableTool[] = [execToolStub()];
  const r = normalizeFastPathToolCall(
    { action: 'tool', tool: 'gh', input: { command: 'gh repo list --limit 3' } },
    tools
  );
  if (r.toolInput.command !== 'gh repo list --limit 3') {
    throw new Error(`expected noop prefix when gh already leads, got ${String(r.toolInput.command)}`);
  }
  console.log('ok: already-prefixed gh command preserved');
}

{
  const tools: ExecutableTool[] = [execToolStub(), readFileStub()];
  const r = normalizeFastPathToolCall({ action: 'read_file', input: { path: '/tmp/x.txt' } }, tools);
  if (r.toolName !== 'read_file') {
    throw new Error(`legacy envelope action as tool broke: ${JSON.stringify(r)}`);
  }
  console.log('ok: legacy action read_file untouched');
}

console.log('\nCliAliasFastPathNormalization tests passed.');
