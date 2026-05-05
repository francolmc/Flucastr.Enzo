import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { EdgeTTSService } from './EdgeTTSService.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

type FakeChildProcess = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal?: string) => boolean;
};

function createFakeChild(): FakeChildProcess {
  const emitter = new EventEmitter() as FakeChildProcess;
  emitter.stdin = new PassThrough();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.kill = () => true;
  return emitter;
}

async function runTests(): Promise<void> {
  console.log('Test: Sintetiza texto en español y retorna audio/ogg');
  {
    const service = new EdgeTTSService({
      ttsFn: async () => Buffer.from('fake-mp3'),
      spawnFn: () => {
        const child = createFakeChild();
        setTimeout(() => {
          child.stdout.emit('data', Buffer.from('OggS'));
          child.emit('close', 0);
        }, 0);
        return child as any;
      },
    });

    const result = await service.synthesize('Hola Franco', 'es');
    assert(result.success === true, 'Expected success=true');
    assert(result.mimeType === 'audio/ogg', 'Expected mimeType=audio/ogg');
    assert(Buffer.isBuffer(result.audioBuffer), 'Expected audioBuffer to be a Buffer');
    assert((result.audioBuffer?.length || 0) > 0, 'Expected non-empty audioBuffer');
  }

  console.log('Test: Texto vacío retorna success:false');
  {
    const service = new EdgeTTSService();
    const result = await service.synthesize('   ', 'es');
    assert(result.success === false, 'Expected success=false for empty text');
    assert(typeof result.error === 'string' && result.error.length > 0, 'Expected populated error');
  }

  console.log('Test: Servicio no disponible retorna error sin lanzar');
  {
    const service = new EdgeTTSService({
      ttsFn: async () => {
        throw new Error('service unavailable');
      },
    });

    const result = await service.synthesize('Hola', 'es');
    assert(result.success === false, 'Expected success=false when provider fails');
    assert(typeof result.error === 'string' && result.error.length > 0, 'Expected populated error');
  }

  console.log('✓ Passed: TTSService.test');
}

runTests().catch((error) => {
  console.error('✗ Failed: TTSService.test');
  console.error(error);
  process.exit(1);
});
