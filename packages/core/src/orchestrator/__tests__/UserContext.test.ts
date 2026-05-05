import {
  buildMemoryPromptSection,
  resolveUserDisplayName,
} from '../amplifier/AmplifierLoopPromptHelpers.js';
import type { AmplifierInput } from '../types.js';
import { ComplexityLevel, AVAILABLE_TOOLS } from '../types.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function baseInput(overrides: Partial<AmplifierInput> = {}): AmplifierInput {
  return {
    message: 'hola',
    conversationId: 'c1',
    userId: 'u1',
    history: [],
    availableTools: [...AVAILABLE_TOOLS],
    availableSkills: [],
    availableAgents: [],
    classifiedLevel: ComplexityLevel.SIMPLE,
    userLanguage: 'es',
    ...overrides,
  };
}

async function run(): Promise<void> {
  console.log('UserContext tests...\n');

  // --- resolveUserDisplayName ---

  console.log('Test: dynamic memory name wins over static displayName');
  {
    const name = resolveUserDisplayName(
      baseInput({
        memoryBlock: 'FACTS ABOUT THE USER:\nThe user\'s name is "Franco".',
        userProfile: { displayName: 'NotFranco' },
      })
    );
    assert(name === 'Franco', `expected "Franco" from memory, got "${name}"`);
    console.log('  ✓ dynamic memory wins\n');
  }

  console.log('Test: static profile used when no dynamic memory');
  {
    const name = resolveUserDisplayName(
      baseInput({ userProfile: { displayName: 'Maria' } })
    );
    assert(name === 'Maria', `expected "Maria" from static profile, got "${name}"`);
    console.log('  ✓ static profile fallback\n');
  }

  console.log('Test: returns undefined when neither source has name');
  {
    const name = resolveUserDisplayName(baseInput());
    assert(name === undefined, `expected undefined, got "${name}"`);
    console.log('  ✓ undefined when no name available\n');
  }

  // --- buildMemoryPromptSection ---

  console.log('Test: empty input → empty string');
  {
    const section = buildMemoryPromptSection(baseInput());
    assert(section === '', `expected empty string, got "${section}"`);
    console.log('  ✓ empty when no profile or memory\n');
  }

  console.log('Test: dynamic memoryBlock is injected with USER CONTEXT wrapper');
  {
    const block = 'FACTS ABOUT THE USER:\nThe user\'s name is "Franco".';
    const section = buildMemoryPromptSection(baseInput({ memoryBlock: block }));
    assert(section.includes('USER CONTEXT'), 'must have USER CONTEXT header');
    assert(section.includes('Franco'), 'must contain memory block content');
    console.log('  ✓ memoryBlock injected inside USER CONTEXT\n');
  }

  console.log('Test: static profile name injected when no dynamic memory');
  {
    const section = buildMemoryPromptSection(
      baseInput({ userProfile: { displayName: 'Ana' } })
    );
    assert(section.includes('Ana'), `must include displayName "Ana", got: ${section}`);
    assert(section.includes('USER CONTEXT'), 'must have wrapper');
    console.log('  ✓ static profile displayName shown when no dynamic memory\n');
  }

  console.log('Test: static profile name suppressed when dynamic memory already has name');
  {
    const section = buildMemoryPromptSection(
      baseInput({
        memoryBlock: 'FACTS ABOUT THE USER:\nThe user\'s name is "Franco".',
        userProfile: { displayName: 'ShouldBeHidden' },
      })
    );
    assert(!section.includes('ShouldBeHidden'), 'static name must be suppressed when dynamic memory has name');
    assert(section.includes('Franco'), 'dynamic name must be present');
    console.log('  ✓ dynamic name suppresses static displayName\n');
  }

  console.log('Test: profession from static profile included when no dynamic profession');
  {
    const section = buildMemoryPromptSection(
      baseInput({ userProfile: { profession: 'Software Engineer' } })
    );
    assert(section.includes('Software Engineer'), `must include profession, got: ${section}`);
    console.log('  ✓ static profession injected\n');
  }

  console.log('Test: static profession suppressed when dynamic memory has profession');
  {
    const section = buildMemoryPromptSection(
      baseInput({
        memoryBlock: 'FACTS ABOUT THE USER:\nThe user\'s profession: DevOps.',
        userProfile: { profession: 'ShouldBeHidden' },
      })
    );
    assert(!section.includes('ShouldBeHidden'), 'static profession suppressed when dynamic has it');
    assert(section.includes('DevOps'), 'dynamic profession must be present');
    console.log('  ✓ dynamic profession suppresses static profession\n');
  }

  console.log('Test: locale and timezone always come from static profile');
  {
    const section = buildMemoryPromptSection(
      baseInput({
        userProfile: { locale: 'es-CL', timezone: 'America/Santiago' },
      })
    );
    assert(section.includes('es-CL'), 'must include locale');
    assert(section.includes('America/Santiago'), 'must include timezone');
    console.log('  ✓ locale and timezone from static profile always present\n');
  }

  console.log('Test: importantInfo and preferences from static profile included');
  {
    const section = buildMemoryPromptSection(
      baseInput({
        userProfile: {
          importantInfo: 'diabetic — avoid sugar recommendations',
          preferences: 'prefers concise bullet-point answers',
        },
      })
    );
    assert(section.includes('diabetic'), 'must include importantInfo');
    assert(section.includes('concise bullet'), 'must include preferences');
    console.log('  ✓ importantInfo and preferences injected\n');
  }

  console.log('Test: userMemories fallback used when memoryBlock is absent');
  {
    const section = buildMemoryPromptSection(
      baseInput({
        userMemories: [
          { key: 'name', value: 'Carlos' },
          { key: 'city', value: 'Buenos Aires' },
        ],
      })
    );
    assert(section.includes('Carlos') || section.includes('name'), 'must contain userMemories data');
    console.log('  ✓ userMemories fallback renders when memoryBlock absent\n');
  }

  console.log('Test: full merge — dynamic memory + static locale/timezone side by side');
  {
    const section = buildMemoryPromptSection(
      baseInput({
        memoryBlock: 'FACTS ABOUT THE USER:\nThe user\'s name is "Franco".\nThe user\'s profession: developer.',
        userProfile: {
          displayName: 'Hidden',
          profession: 'HiddenProfession',
          locale: 'es-CL',
          timezone: 'America/Santiago',
          preferences: 'dark mode',
        },
      })
    );
    assert(section.includes('Franco'), 'dynamic name present');
    assert(!section.includes('Hidden\n') && !section.includes('name: Hidden'), 'static name suppressed');
    assert(!section.includes('HiddenProfession'), 'static profession suppressed');
    assert(section.includes('es-CL'), 'locale present');
    assert(section.includes('America/Santiago'), 'timezone present');
    assert(section.includes('dark mode'), 'preferences present');
    console.log('  ✓ full merge: dynamic wins for name/profession, static authoritative for locale/tz/prefs\n');
  }

  console.log('UserContext tests passed. ✓');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
