import fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillRegistry } from './SkillRegistry.js';
import type { MemoryService } from '../memory/MemoryService.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

const memoryMock = {
  getSkillConfig: () => null,
  saveSkillConfig: () => {
    return;
  },
} as unknown as MemoryService;

async function runTests(): Promise<void> {
  console.log('SkillRegistry tests...\n');
  const skillsDir = join(process.cwd(), 'src', 'skills', '__fixtures__');
  const registry = new SkillRegistry(skillsDir, memoryMock);

  console.log('Test: load fixture and register');
  await registry.reload();
  const skill = registry.get('test-skill');
  assert(!!skill, 'expected test-skill to be registered');
  assert(skill!.metadata.name === 'Test Skill Fixture', 'expected fixture name');
  console.log('✓ Passed\n');

  console.log('Test: find by name (no triggers needed)');
  const byName = registry.getAll().find((s) => s.id === 'test-skill');
  assert(!!byName && byName.id === 'test-skill', 'expected test-skill to be found');
  console.log('✓ Passed\n');

  console.log('Test: startWatching when skills directory exists');
  registry.startWatching();
  registry.stopWatching();
  console.log('✓ Passed\n');

  console.log('Test: startWatching when skills directory does not exist (graceful)');
  const emptySkillsRoot = fs.mkdtempSync(join(tmpdir(), 'enzo-skill-watch-'));
  const missingDirRegistry = new SkillRegistry(emptySkillsRoot, memoryMock);
  fs.rmSync(emptySkillsRoot, { recursive: true, force: true });
  missingDirRegistry.startWatching();
  console.log('✓ Passed\n');

  console.log('Test: stopWatching when no watcher is active');
  const fresh = new SkillRegistry(skillsDir, memoryMock);
  fresh.stopWatching();
  console.log('✓ Passed\n');

  console.log('SkillRegistry tests passed.');
}

void runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });