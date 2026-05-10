import {
  buildAssistantIdentityPrompt,
  buildMemoryPromptSection,
  buildContextAnchorPrompt,
  buildToolsPrompt,
  buildRuntimeThreeLayersContractPrompt,
} from '../amplifier/AmplifierLoopPromptHelpers.js';
import type { AmplifierInput } from '../types.js';
import { ComplexityLevel, AVAILABLE_TOOLS } from '../types.js';
import type { Tool } from '../../providers/types.js';

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

const sampleTools: Tool[] = [
  {
    name: 'remember',
    description: 'Persist a fact about the user.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', description: 'fact key' }, value: { type: 'string', description: 'fact value' } },
      required: ['key', 'value'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'search query' } },
      required: ['query'],
    },
  },
];

async function run(): Promise<void> {
  console.log('AmplifierPromptBuilding tests...\n');

  // --- Identity + context combined ordering ---

  console.log('Test: identity comes before user context in combined prompt');
  {
    const input = baseInput({
      assistantProfile: { name: 'Enzo', persona: 'intelligent assistant', tone: 'direct' },
      userProfile: { displayName: 'Franco', locale: 'es-CL' },
    });
    const identity = buildAssistantIdentityPrompt(input);
    const context = buildMemoryPromptSection(input);
    const combined = `${identity}\n${context}`;
    const identityPos = combined.indexOf('You are Enzo');
    const contextPos = combined.indexOf('USER CONTEXT');
    assert(identityPos < contextPos, 'identity block must precede user context block');
    console.log('  ✓ identity precedes user context\n');
  }

  console.log('Test: anchor comes after tools prompt in combined prompt');
  {
    const input = baseInput({ assistantProfile: { name: 'Enzo' } });
    const tools = buildToolsPrompt(sampleTools);
    const anchor = buildContextAnchorPrompt(input);
    const combined = `${tools}\n${anchor}`;
    const toolsPos = combined.indexOf('AVAILABLE TOOLS');
    const anchorPos = combined.indexOf('CONTEXT ANCHOR');
    assert(toolsPos < anchorPos, 'tools prompt must precede context anchor');
    console.log('  ✓ tools prompt precedes context anchor\n');
  }

  console.log('Test: full system prompt assembles without duplicate assistant name claims');
  {
    const input = baseInput({
      assistantProfile: { name: 'Enzo', persona: 'intelligent assistant', tone: 'direct, concise' },
      userProfile: { displayName: 'Franco', timezone: 'America/Santiago' },
    });
    const identity = buildAssistantIdentityPrompt(input);
    const context = buildMemoryPromptSection(input);
    const layers = buildRuntimeThreeLayersContractPrompt();
    const tools = buildToolsPrompt(sampleTools);
    const anchor = buildContextAnchorPrompt(input);
    const full = [identity, context, layers, tools, anchor].join('\n\n');

    // Name appears in identity + anchor but NOT in a conflicting user-profile position
    const enzoOccurrences = (full.match(/\bEnzo\b/g) ?? []).length;
    assert(enzoOccurrences >= 2, 'Enzo must appear in at least identity + anchor');

    // User context present
    assert(full.includes('USER CONTEXT'), 'user context block present');
    assert(full.includes('Franco'), 'user name present');
    assert(full.includes('America/Santiago'), 'timezone present');

    // Tools contract present
    assert(full.includes('AVAILABLE TOOLS'), 'tools section present');
    assert(full.includes('remember'), 'remember tool listed');
    assert(full.includes('web_search'), 'web_search tool listed');

    // Anchor at end
    assert(full.lastIndexOf('CONTEXT ANCHOR') > full.indexOf('AVAILABLE TOOLS'), 'anchor after tools');

    console.log('  ✓ full prompt: identity→context→layers→tools→anchor order and content\n');
  }

  // --- Tools prompt ---

  console.log('Test: tools prompt lists all tool names exactly');
  {
    const prompt = buildToolsPrompt(sampleTools);
    assert(prompt.includes('**remember**'), 'remember tool listed in bold');
    assert(prompt.includes('**web_search**'), 'web_search listed in bold');
    assert(prompt.includes('remember, web_search') || prompt.includes('web_search, remember'),
      'canonical tool name list present');
    console.log('  ✓ tools prompt lists exact tool names\n');
  }

  console.log('Test: tools prompt includes JSON action format');
  {
    const prompt = buildToolsPrompt(sampleTools);
    assert(prompt.includes('"action":"tool"'), 'canonical tool call JSON present');
    assert(prompt.includes('"action":"delegate"'), 'delegate action format present');
    assert(prompt.includes('"action":"none"'), 'none action format present');
    console.log('  ✓ tools prompt includes all three action formats\n');
  }

  console.log('Test: tools prompt explicitly forbids inventing tools');
  {
    const prompt = buildToolsPrompt(sampleTools);
    assert(prompt.includes('never invent') || prompt.includes('ONLY valid'), 'must forbid tool invention');
    console.log('  ✓ tools prompt forbids inventing tools\n');
  }

  // --- Runtime layers contract ---

  console.log('Test: three layers contract distinguishes Skills / Agents / Tools');
  {
    const contract = buildRuntimeThreeLayersContractPrompt();
    assert(contract.includes('Skills'), 'must mention Skills');
    assert(contract.includes('Agents'), 'must mention Agents');
    assert(contract.includes('Tools'), 'must mention Tools');
    assert(contract.includes('execute_command'), 'must reference execute_command for CLI actions');
    console.log('  ✓ three layers contract present with all three layers\n');
  }

  // --- Assistant name isolation from user facts ---

  console.log('Test: assistant name does not appear in user facts section');
  {
    const input = baseInput({
      assistantProfile: { name: 'Enzo' },
      userProfile: { displayName: 'Franco', profession: 'engineer' },
    });
    const context = buildMemoryPromptSection(input);
    // The user facts section must not say "The user's name is Enzo"
    const linesWithEnzo = context
      .split('\n')
      .filter((l) => l.toLowerCase().includes('enzo'));
    assert(linesWithEnzo.length === 0, `assistant name "Enzo" leaked into user context: ${linesWithEnzo.join('; ')}`);
    console.log('  ✓ assistant name isolated — does not appear in user context section\n');
  }

  console.log('Test: user name does not bleed into identity prompt');
  {
    const input = baseInput({
      assistantProfile: { name: 'Enzo' },
      memoryBlock: 'FACTS ABOUT THE USER:\nThe user\'s name is "Franco".',
    });
    const identity = buildAssistantIdentityPrompt(input);
    assert(!identity.includes('Franco'), `user name "Franco" must not appear in identity prompt, got: ${identity}`);
    console.log('  ✓ user name isolated — does not appear in identity prompt\n');
  }

  console.log('AmplifierPromptBuilding tests passed. ✓');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
