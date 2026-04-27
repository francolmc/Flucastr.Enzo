import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ConfigService } from '../config/ConfigService.js';
import { DocAgent } from './DocAgent.js';
import type { DelegationRequest } from './AgentRouter.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function baseRequest(overrides: Partial<DelegationRequest> = {}): DelegationRequest {
  return {
    agent: 'doc_agent',
    task: 'Write a doc',
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
  const agent = new DocAgent(config as ConfigService);
  const r = await agent.execute(baseRequest());
  assert(r.success === false && Boolean(r.error && r.error.length > 0), 'expected error result');
}

async function testWithFileTagWritesFile() {
  const ws = join(tmpdir(), `enzo-ws-doc-${Date.now()}`);
  await mkdir(ws, { recursive: true });
  const target = join(ws, 'doc.md');
  const config: Pick<ConfigService, 'getProviderApiKey'> = {
    getProviderApiKey: () => 'test-key',
  };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        content: [{ type: 'text', text: `Intro\n<file path="${target}"># Doc</file>\n` }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
  try {
    const agent = new DocAgent(config as ConfigService, ws);
    const r = await agent.execute(baseRequest());
    assert(r.success === true, `expected success, got ${r.error}`);
    assert(r.filesCreated?.length === 1, 'one file');
    assert(!r.output?.includes('<file'), 'output stripped of file tags');
    const { readFile } = await import('fs/promises');
    const disk = await readFile(target, 'utf-8');
    assert(disk.includes('# Doc'), 'file on disk');
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
      JSON.stringify({ content: [{ type: 'text', text: 'Document body only.' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
  try {
    const agent = new DocAgent(config as ConfigService);
    const r = await agent.execute(baseRequest());
    assert(r.success && r.output === 'Document body only.', 'clean output');
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
    const agent = new DocAgent(config as ConfigService);
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
    new Response(JSON.stringify({ error: { message: 'rate limit', type: 'api_error' } }), {
      status: 429,
    })) as typeof fetch;
  try {
    const agent = new DocAgent(config as ConfigService);
    const r = await agent.execute(baseRequest());
    assert(r.success === false && Boolean(r.error?.includes('rate limit')), r.error ?? '');
  } finally {
    globalThis.fetch = prevFetch;
  }
}

async function runTests() {
  console.log('DocAgent tests\n');
  await testNoApiKey();
  await testWithFileTagWritesFile();
  await testNoFileTag();
  await testNetworkError();
  await testHttpError();
  console.log('\nAll DocAgent tests passed.');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
