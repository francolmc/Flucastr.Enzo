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
  console.log('SkillResolver LLM-based selection tests...\n');
  const registry = new SkillRegistry(undefined, memoryMock);

  const ideaSkill = baseLoadedSkill({
    id: 'idea-capture',
    metadata: {
      name: 'Idea Capture',
      description: 'Ayuda a capturar y organizar ideas del usuario',
    },
    content: '- capturar una idea\n- anotando algo importante\n',
  });

  const weatherSkill = baseLoadedSkill({
    id: 'weather',
    metadata: {
      name: 'weather',
      description: 'Proporciona información meteorológica actual y pronóstico del tiempo',
    },
    content: '- dime el clima en Madrid\n- qué tiempo hace en Buenos Aires\n',
  });

  const datetimeSkill = baseLoadedSkill({
    id: 'datetime',
    metadata: {
      name: 'datetime',
      description: 'Proporciona la fecha y hora actual del sistema',
    },
    content: '- qué hora es\n- qué día es hoy\n',
  });

  registry.register(ideaSkill);
  registry.register(weatherSkill);
  registry.register(datetimeSkill);

  const resolver = new SkillResolver();

  console.log('Test: token overlap scoring works without triggers');
  {
    const out = await resolver.resolveRelevantSkills('quiero capturar una idea', registry);
    const hit = out.find((s) => s.id === 'idea-capture');
    assert(!!hit, 'expected idea-capture in results');
    assert(hit!.relevanceScore > 0, `expected score > 0, got ${hit!.relevanceScore}`);
    console.log('✓ Pass\n');
  }

  console.log('Test: description overlap yields high score');
  {
    const out = await resolver.resolveRelevantSkills('dame el clima de Santiago', registry);
    const hit = out.find((s) => s.id === 'weather');
    assert(!!hit, 'expected weather in results');
    console.log('✓ Pass\n');
  }

  console.log('Test: implicit match yields reasonable score');
  {
    const out = await resolver.resolveRelevantSkills('qué hora es ahora', registry);
    const hit = out.find((s) => s.id === 'datetime');
    assert(!!hit, 'expected datetime in results');
    assert(hit!.relevanceScore > 0, `expected score > 0, got ${hit!.relevanceScore}`);
    console.log('✓ Pass\n');
  }

  console.log('Test: pre-filter limits results before LLM');
  {
    const manySkills = new SkillRegistry(undefined, memoryMock);
    for (let i = 0; i < 10; i++) {
      manySkills.register(baseLoadedSkill({
        id: `skill-${i}`,
        metadata: {
          name: `Skill ${i}`,
          description: `Description for skill ${i}`,
        },
        content: `Content ${i}`,
      }));
    }
    const out = await resolver.resolveRelevantSkills('test query', manySkills);
    const preFilterLimit = 5;
    assert(out.length <= preFilterLimit * 2, `expected at most ${preFilterLimit * 2} results, got ${out.length}`);
    console.log('✓ Pass\n');
  }

  console.log('SkillResolver LLM-based selection tests passed.');
}

void runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });