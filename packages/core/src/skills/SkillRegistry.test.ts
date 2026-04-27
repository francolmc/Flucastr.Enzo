import { join } from 'path';
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

  console.log('Test: find by trigger');
  const byTrigger = registry
    .getAll()
    .find((s) => s.metadata.triggers?.includes('enzo_test_trigger_alpha'));
  assert(!!byTrigger && byTrigger.id === 'test-skill', 'expected trigger to resolve to test-skill');
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
