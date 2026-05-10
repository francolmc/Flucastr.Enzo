import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { AudioConverter } from './AudioConverter.js';

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
  console.log('Test: isAvailable retorna boolean sin lanzar excepción');
  {
    const available = await AudioConverter.isAvailable(() => {
      const child = createFakeChild();
      setTimeout(() => child.emit('close', 0), 0);
      return child as any;
    });
    assert(typeof available === 'boolean', 'Expected boolean result');
  }

  console.log('Test: ffmpeg no disponible retorna buffer original');
  {
    const input = Buffer.from('ogg-data');
    const converter = new AudioConverter({
      spawnFn: () => {
        const child = createFakeChild();
        setTimeout(() => child.emit('error', new Error('ffmpeg not found')), 0);
        return child as any;
      },
      timeoutMs: 20,
    });

    const output = await converter.oggToWav(input);
    assert(output === input, 'Expected original buffer when ffmpeg unavailable');
  }

  console.log('Test: timeout excedido retorna buffer original');
  {
    const input = Buffer.from('ogg-data');
    let callCount = 0;
    let killCalled = false;
    const converter = new AudioConverter({
      spawnFn: () => {
        callCount += 1;
        const child = createFakeChild();
        child.kill = () => {
          killCalled = true;
          return true;
        };
        if (callCount === 1) {
          setTimeout(() => child.emit('close', 0), 0);
        }
        return child as any;
      },
      timeoutMs: 20,
    });

    const output = await converter.oggToWav(input);
    assert(output === input, 'Expected original buffer on conversion timeout');
    assert(killCalled, 'Expected ffmpeg process to be killed on timeout');
  }

  console.log('✓ Passed: AudioConverter.test');
}

runTests().catch((error) => {
  console.error('✗ Failed: AudioConverter.test');
  console.error(error);
  process.exit(1);
});
