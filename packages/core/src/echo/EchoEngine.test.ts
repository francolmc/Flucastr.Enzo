import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { EchoEngine } from './EchoEngine.js';

function assert(cond: boolean, message: string): void {
  if (!cond) {
    throw new Error(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests(): Promise<void> {
  console.log('EchoEngine tests...\n');

  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), 'enzo-echo-test-'));
  const configPath = path.join(tempRoot, 'echo.config.json');
  const engine = new EchoEngine({ configPath, taskTimeoutMs: 1000 });

  try {
    console.log('Test: start and stop run without errors');
    engine.start();
    await sleep(50);
    engine.stop();
    console.log('✓ Pass\n');

    console.log('Test: registerTask appears in status');
    engine.registerTask({
      id: 'status-task',
      name: 'Status Task',
      schedule: 'interval:1min',
      enabled: true,
      action: async () => ({ success: true, message: 'ok' }),
    });
    const statusAfterRegister = engine.getStatus();
    assert(
      statusAfterRegister.tasks.some((task) => task.id === 'status-task'),
      'expected task to be listed in status'
    );
    const statusTask = statusAfterRegister.tasks.find((task) => task.id === 'status-task');
    assert(statusTask?.schedule === 'interval:1min', 'expected status to include effective schedule');
    console.log('✓ Pass\n');

    console.log('Test: runNow executes and returns EchoResult');
    const runResult = await engine.runNow('status-task');
    assert(runResult.success, `expected runNow success, got ${JSON.stringify(runResult)}`);
    assert(runResult.message === 'ok', `expected message "ok", got ${runResult.message}`);
    console.log('✓ Pass\n');

    console.log('Test: failing task does not stop other tasks');
    engine.registerTask({
      id: 'fails',
      name: 'Fails',
      schedule: 'interval:1min',
      enabled: true,
      action: async () => {
        throw new Error('boom');
      },
    });
    engine.registerTask({
      id: 'works',
      name: 'Works',
      schedule: 'interval:1min',
      enabled: true,
      action: async () => ({ success: true, message: 'still-running' }),
    });
    const failResult = await engine.runNow('fails');
    assert(!failResult.success, 'expected failing task to return success=false');
    const successAfterFail = await engine.runNow('works');
    assert(successAfterFail.success, 'expected subsequent task to still run');
    console.log('✓ Pass\n');

    console.log('Test: disableTask and enableTask update status');
    engine.disableTask('works');
    let worksTask = engine.getStatus().tasks.find((task) => task.id === 'works');
    assert(worksTask?.enabled === false, 'expected works task to be disabled');
    engine.enableTask('works');
    worksTask = engine.getStatus().tasks.find((task) => task.id === 'works');
    assert(worksTask?.enabled === true, 'expected works task to be enabled');
    console.log('✓ Pass\n');

    console.log('Test: config template creation and hot-reload toggles task');
    engine.start();
    await sleep(100);
    const configRaw = await fs.readFile(configPath, 'utf-8');
    assert(configRaw.includes('"tasks"'), 'expected template config file to exist');
    const config = JSON.parse(configRaw) as { tasks?: Record<string, { enabled?: boolean; schedule?: string }> };
    const nextConfig = {
      tasks: {
        ...(config.tasks ?? {}),
        works: {
          enabled: false,
          schedule: 'interval:1min',
        },
      },
    };
    await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf-8');
    await sleep(300);
    const worksAfterReload = engine.getStatus().tasks.find((task) => task.id === 'works');
    assert(worksAfterReload?.enabled === false, 'expected hot-reload to disable task from config');
    console.log('✓ Pass\n');

    console.log('EchoEngine tests passed.');
  } finally {
    engine.stop();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
