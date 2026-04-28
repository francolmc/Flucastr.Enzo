import { OllamaVisionService } from './OllamaVisionService.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function createConfigMock(overrides: { primaryModel?: string; ollamaBaseUrl?: string } = {}): any {
  return {
    getPrimaryModel: () => overrides.primaryModel ?? 'llava:latest',
    getSystemConfig: () => ({
      ollamaBaseUrl: overrides.ollamaBaseUrl ?? 'http://localhost:11434',
    }),
  };
}

async function runTests(): Promise<void> {
  console.log('Vision: success returns description');
  {
    const service = new OllamaVisionService(createConfigMock(), {
      fetchImpl: async () =>
        new Response(JSON.stringify({ response: 'A red circle on white.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    const r = await service.analyze(Buffer.from([1, 2, 3]), 'image/jpeg');
    assert(r.success === true && r.description === 'A red circle on white.', `got ${JSON.stringify(r)}`);
  }

  console.log('Vision: model without vision → canRetry true');
  {
    const service = new OllamaVisionService(createConfigMock(), {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: 'llama runner: image input is not supported for this model' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    });
    const r = await service.analyze(Buffer.from('x'), 'image/jpeg');
    assert(
      r.success === false && r.canRetry === true && r.error === 'Model does not support vision',
      `got ${JSON.stringify(r)}`
    );
  }

  console.log('Vision: network error → canRetry false, no throw');
  {
    const service = new OllamaVisionService(createConfigMock(), {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const r = await service.analyze(Buffer.from('x'), 'image/jpeg');
    assert(r.success === false && r.canRetry === false && (r.error ?? '').includes('ECONNREFUSED'), `got ${JSON.stringify(r)}`);
  }

  console.log('Vision: custom prompt forwarded in body');
  {
    let seenPrompt = '';
    const service = new OllamaVisionService(createConfigMock(), {
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string };
        seenPrompt = body.prompt ?? '';
        return new Response(JSON.stringify({ response: 'ok' }), { status: 200 });
      },
    });
    await service.analyze(Buffer.from('img'), 'image/jpeg', 'Only count the objects.');
    assert(seenPrompt === 'Only count the objects.', `prompt was ${JSON.stringify(seenPrompt)}`);
  }

  console.log('VisionService tests passed.');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
