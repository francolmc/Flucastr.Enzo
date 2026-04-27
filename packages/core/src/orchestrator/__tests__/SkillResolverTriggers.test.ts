import { SkillRegistry } from '../../skills/SkillRegistry.js';
import { SkillResolver } from '../SkillResolver.js';
import type { LoadedSkill } from '../../skills/SkillLoader.js';
import type { MemoryService } from '../../memory/MemoryService.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

const memoryMock = {
  getSkillConfig: () => null,
  saveSkillConfig: () => {
    return;
  },
} as unknown as MemoryService;

function baseLoadedSkill(partial: Partial<LoadedSkill> & Pick<LoadedSkill, 'id' | 'metadata' | 'content'>): LoadedSkill {
  return {
    path: `/tmp/${partial.id}/SKILL.md`,
    enabled: true,
    ...partial,
  };
}

async function runTests(): Promise<void> {
  console.log('SkillResolver triggers tests...\n');
  const registry = new SkillRegistry(undefined, memoryMock);
  const ideaSkill = baseLoadedSkill({
    id: 'idea-capture',
    metadata: {
      name: 'Idea Capture',
      description: 'Help capture and organize ideas',
      triggers: ['capturar', 'anotar'],
    },
    content: '- ejemplo capturar nota\n',
  });
  const tildeSkill = baseLoadedSkill({
    id: 'tilde-trigger',
    metadata: {
      name: 'Tilde Trigger Skill',
      description: 'Uses accented trigger phrase',
      triggers: ['anótate'],
    },
    content: 'Minimal body',
  });
  const noiseSkill = baseLoadedSkill({
    id: 'warehouse-docs',
    metadata: {
      name: 'Warehouse Documentation',
      description: 'inventory pallet shipping receiving documentation report analysis summary',
    },
    content: 'inventory pallet shipping receiving documentation report analysis',
  });

  registry.register(ideaSkill);
  registry.register(tildeSkill);
  registry.register(noiseSkill);

  const resolver = new SkillResolver();

  console.log('Test: trigger phrase in message yields max score');
  {
    const out = await resolver.resolveRelevantSkills('quiero capturar una idea', registry);
    const hit = out.find((s) => s.id === 'idea-capture');
    assert(!!hit, 'expected idea-capture in results');
    assert(hit!.relevanceScore === 1, `expected score 1.0, got ${hit!.relevanceScore}`);
    console.log('✓ Pass\n');
  }

  console.log('Test: no trigger phrase uses token scoring (not max)');
  {
    // Overlaps name/description tokens ("capture", "ideas", "organize") but not triggers capturar/anotar.
    const out = await resolver.resolveRelevantSkills(
      'help me capture and organize my ideas in one place',
      registry
    );
    const hit = out.find((s) => s.id === 'idea-capture');
    assert(!!hit, 'expected idea-capture in fallback or ranked list');
    assert(hit!.relevanceScore < 1, `expected score < 1.0, got ${hit!.relevanceScore}`);
    console.log('✓ Pass\n');
  }

  console.log('Test: trigger with tilde matches message without tilde');
  {
    const out = await resolver.resolveRelevantSkills('anotate algo importante', registry);
    const hit = out.find((s) => s.id === 'tilde-trigger');
    assert(!!hit, 'expected tilde-trigger in results');
    assert(hit!.relevanceScore === 1, `expected score 1.0, got ${hit!.relevanceScore}`);
    console.log('✓ Pass\n');
  }

  console.log('Test: long noisy message vs short subtask-style description');
  {
    const noiseBlock = Array(40).fill('inventory pallet documentation report analysis summary').join(' ');
    const longMessage = `${noiseBlock}\n\nStep context logs receiving shipping`;
    const shortDescription = 'User wants to capturar feedback from the meeting';

    const longOut = await resolver.resolveRelevantSkills(longMessage, registry);
    const shortOut = await resolver.resolveRelevantSkills(shortDescription, registry);

    const noiseTopLong = longOut[0];
    assert(noiseTopLong?.id === 'warehouse-docs', `long message: expected warehouse-docs first, got ${noiseTopLong?.id}`);

    const shortTop = shortOut[0];
    assert(shortTop?.id === 'idea-capture', `short description: expected idea-capture first, got ${shortTop?.id}`);
    assert(shortTop?.relevanceScore === 1, `short description: expected max score on idea-capture`);

    console.log('✓ Pass\n');
  }

  console.log('SkillResolver triggers tests passed.');
}

void runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
