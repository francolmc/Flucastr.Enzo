import { WhisperTranscriptionService } from './WhisperTranscriptionService.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function createConfigServiceMock(openAiApiKey: string | null, ollamaBaseUrl = 'http://localhost:11434'): any {
  return {
    getSystemConfig() {
      return { ollamaBaseUrl };
    },
    getProviderApiKey(provider: string) {
      if (provider !== 'openai') return null;
      return openAiApiKey;
    },
  };
}

async function runTests(): Promise<void> {
  console.log('Test: Transcripción exitosa retorna success:true');
  {
    const service = new WhisperTranscriptionService(
      createConfigServiceMock(null),
      {
        fetchFn: async (url: RequestInfo | URL) => {
          if (String(url).includes('/api/transcribe')) {
            return new Response(JSON.stringify({ text: 'hola mundo', language: 'es', duration: 3.4 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response('not expected', { status: 500 });
        },
      }
    );

    const result = await service.transcribe(Buffer.from('audio'), 'audio/wav');
    assert(result.success === true, 'Expected success=true');
    assert(result.text === 'hola mundo', 'Expected transcribed text');
    assert(result.language === 'es', 'Expected language=es');
  }

  console.log('Test: Ollama no disponible intenta fallback OpenAI');
  {
    const calledUrls: string[] = [];
    const service = new WhisperTranscriptionService(
      createConfigServiceMock('test-openai-key'),
      {
        fetchFn: async (url: RequestInfo | URL) => {
          const rawUrl = String(url);
          calledUrls.push(rawUrl);
          if (rawUrl.includes('/api/transcribe')) {
            return new Response('model whisper not found', { status: 404 });
          }
          if (rawUrl.includes('api.openai.com')) {
            return new Response(JSON.stringify({ text: 'from openai' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response('not expected', { status: 500 });
        },
      }
    );

    const result = await service.transcribe(Buffer.from('audio'), 'audio/wav');
    assert(result.success === true, 'Expected success=true from OpenAI fallback');
    assert(result.text === 'from openai', 'Expected OpenAI transcribed text');
    assert(calledUrls.some((url) => url.includes('/api/transcribe')), 'Expected Ollama to be attempted');
    assert(calledUrls.some((url) => url.includes('api.openai.com')), 'Expected OpenAI fallback to be attempted');
  }

  console.log('Test: Ningún modelo disponible retorna error sin lanzar');
  {
    const service = new WhisperTranscriptionService(
      createConfigServiceMock(null),
      {
        fetchFn: async () => new Response('model whisper not found', { status: 404 }),
      }
    );

    const result = await service.transcribe(Buffer.from('audio'), 'audio/ogg');
    assert(result.success === false, 'Expected success=false');
    assert(result.error === 'No transcription model available', 'Expected no-model-available error');
  }

  console.log('Test: Error de red retorna success:false sin lanzar');
  {
    const service = new WhisperTranscriptionService(
      createConfigServiceMock(null),
      {
        fetchFn: async () => {
          throw new Error('network down');
        },
      }
    );

    const result = await service.transcribe(Buffer.from('audio'), 'audio/wav');
    assert(result.success === false, 'Expected success=false');
    assert(typeof result.error === 'string' && result.error.length > 0, 'Expected populated error message');
  }

  console.log('✓ Passed: TranscriptionService.test');
}

runTests().catch((error) => {
  console.error('✗ Failed: TranscriptionService.test');
  console.error(error);
  process.exit(1);
});
