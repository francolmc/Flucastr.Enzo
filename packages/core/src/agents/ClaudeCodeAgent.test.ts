import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ConfigService } from '../config/ConfigService.js';
import { ClaudeCodeAgent } from './ClaudeCodeAgent.js';
import type { DelegationRequest } from './AgentRouter.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function baseRequest(overrides: Partial<DelegationRequest> = {}): DelegationRequest {
  return {
    agent: 'claude_code',
    task: 'Do something',
    reason: 'test',
    context: {
      userId: 'u1',
      memories: [],
      conversationSummary: 'summary',
      ...overrides.context,
    },
    ...overrides,
  };
}

async function testNoApiKey() {
  const config: Pick<ConfigService, 'getProviderApiKey'> = {
    getProviderApiKey: () => null,
  };
  const agent = new ClaudeCodeAgent(config as ConfigService);
  const r = await agent.execute(baseRequest());
  assert(r.success === false && Boolean(r.error && r.error.length > 0), 'expected error result');
}

async function testWithFileTagWritesFile() {
  const ws = join(tmpdir(), `enzo-ws-claude-${Date.now()}`);
  await mkdir(ws, { recursive: true });
  const target = join(ws, 'out.md');
  const config: Pick<ConfigService, 'getProviderApiKey'> = {
    getProviderApiKey: () => 'test-key',
  };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        content: [{ type: 'text', text: `Hello\n<file path="${target}"># Hi</file>\n` }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;

  try {
    const agent = new ClaudeCodeAgent(config as ConfigService, ws);
    const r = await agent.execute(baseRequest());
    assert(r.success === true, `expected success, got ${r.error}`);
    assert(r.filesCreated?.length === 1, 'one file');
    assert(!r.output?.includes('<file'), 'output stripped of file tags');
    const { readFile } = await import('fs/promises');
    const disk = await readFile(target, 'utf-8');
    assert(disk.includes('# Hi'), 'file on disk');
  } finally {
    globalThis.fetch = prevFetch;
    await rm(ws, { recursive: true, force: true });
  }
}

async function testNoFileTag() {
  const config: Pick<ConfigService, 'getProviderApiKey'> = {
    getProviderApiKey: () => 'k',
  };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'Just prose without tags.' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
  try {
    const agent = new ClaudeCodeAgent(config as ConfigService);
    const r = await agent.execute(baseRequest());
    assert(r.success && r.output === 'Just prose without tags.', 'clean output');
    assert(r.filesCreated === undefined || r.filesCreated.length === 0, 'no files');
  } finally {
    globalThis.fetch = prevFetch;
  }
}

async function testNetworkError() {
  const config: Pick<ConfigService, 'getProviderApiKey'> = {
    getProviderApiKey: () => 'k',
  };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  try {
    const agent = new ClaudeCodeAgent(config as ConfigService);
    const r = await agent.execute(baseRequest());
    assert(r.success === false && Boolean(r.error?.includes('network down')), r.error ?? '');
  } finally {
    globalThis.fetch = prevFetch;
  }
}

async function testHttpError() {
  const config: Pick<ConfigService, 'getProviderApiKey'> = {
    getProviderApiKey: () => 'k',
  };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: 'bad', type: 'api_error' } }), {
      status: 400,
    })) as typeof fetch;
  try {
    const agent = new ClaudeCodeAgent(config as ConfigService);
    const r = await agent.execute(baseRequest());
    assert(r.success === false && Boolean(r.error?.includes('bad')), r.error ?? '');
  } finally {
    globalThis.fetch = prevFetch;
  }
}

async function runTests() {
  console.log('ClaudeCodeAgent tests\n');
  await testNoApiKey();
  await testWithFileTagWritesFile();
  await testNoFileTag();
  await testNetworkError();
  await testHttpError();
  console.log('\nAll ClaudeCodeAgent tests passed.');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
