import {
  buildAssistantIdentityPrompt,
  buildContextAnchorPrompt,
  getAssistantIdentityContext,
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
  console.log('AssistantIdentity tests...\n');

  // --- getAssistantIdentityContext ---

  console.log('Test: defaults when no assistantProfile provided');
  {
    const ctx = getAssistantIdentityContext(baseInput());
    assert(ctx.name === 'Enzo', `expected default name Enzo, got "${ctx.name}"`);
    assert(ctx.persona.includes('assistant'), `expected default persona to include "assistant", got "${ctx.persona}"`);
    assert(ctx.tone.includes('direct'), `expected default tone to include "direct", got "${ctx.tone}"`);
    assert(ctx.styleGuidelines === '', `expected empty styleGuidelines, got "${ctx.styleGuidelines}"`);
    console.log('  ✓ defaults are Enzo / intelligent personal assistant / direct, concise, and friendly\n');
  }

  console.log('Test: custom assistantProfile overrides defaults');
  {
    const ctx = getAssistantIdentityContext(
      baseInput({
        assistantProfile: {
          name: 'Luna',
          persona: 'creative writing companion',
          tone: 'warm and poetic',
          styleGuidelines: 'Use metaphors freely.',
        },
      })
    );
    assert(ctx.name === 'Luna', `expected Luna, got "${ctx.name}"`);
    assert(ctx.persona === 'creative writing companion', 'wrong persona');
    assert(ctx.tone === 'warm and poetic', 'wrong tone');
    assert(ctx.styleGuidelines === 'Use metaphors freely.', 'wrong styleGuidelines');
    console.log('  ✓ custom name/persona/tone/styleGuidelines all honoured\n');
  }

  console.log('Test: partial profile fills missing fields from defaults');
  {
    const ctx = getAssistantIdentityContext(
      baseInput({ assistantProfile: { name: 'Atlas' } })
    );
    assert(ctx.name === 'Atlas', 'wrong name');
    assert(ctx.persona.length > 0, 'persona should not be empty');
    assert(ctx.tone.length > 0, 'tone should not be empty');
    console.log('  ✓ partial profile keeps defaults for missing fields\n');
  }

  // --- buildAssistantIdentityPrompt ---

  console.log('Test: identity prompt contains name and persona');
  {
    const prompt = buildAssistantIdentityPrompt(
      baseInput({
        assistantProfile: { name: 'Enzo', persona: 'intelligent personal assistant', tone: 'direct, concise, and friendly' },
      })
    );
    assert(prompt.includes('You are Enzo'), 'prompt must open with "You are Enzo"');
    assert(prompt.includes('intelligent personal assistant'), 'prompt must include persona');
    assert(prompt.includes('direct, concise, and friendly'), 'prompt must include tone');
    console.log('  ✓ prompt includes name, persona and tone\n');
  }

  console.log('Test: identity prompt enforces name lock');
  {
    const prompt = buildAssistantIdentityPrompt(
      baseInput({ assistantProfile: { name: 'Luna' } })
    );
    assert(prompt.includes('strictly "Luna"'), `prompt must include name lock for Luna, got: ${prompt.slice(0, 300)}`);
    assert(prompt.includes('Never claim to be a different assistant'), 'must forbid claiming different identity');
    console.log('  ✓ name lock line present\n');
  }

  console.log('Test: identity confidentiality — no provider disclosure');
  {
    const prompt = buildAssistantIdentityPrompt(baseInput());
    assert(prompt.includes('IDENTITY CONFIDENTIALITY'), 'must have confidentiality block');
    assert(prompt.includes('Google') && prompt.includes('Anthropic') && prompt.includes('OpenAI'),
      'confidentiality block must name forbidden companies');
    assert(prompt.includes('privately configured AI assistant'), 'must use "privately configured AI assistant" phrasing');
    console.log('  ✓ confidentiality block present and names forbidden providers\n');
  }

  console.log('Test: styleGuidelines appended only when non-empty');
  {
    const withGuidelines = buildAssistantIdentityPrompt(
      baseInput({ assistantProfile: { name: 'Enzo', styleGuidelines: 'Always use bullet points.' } })
    );
    assert(withGuidelines.includes('Additional style guidelines: Always use bullet points.'), 'guidelines missing');

    const withoutGuidelines = buildAssistantIdentityPrompt(baseInput());
    assert(!withoutGuidelines.includes('Additional style guidelines'), 'should not add empty guidelines block');
    console.log('  ✓ styleGuidelines appended only when present\n');
  }

  console.log('Test: question routing — user asked about their own name');
  {
    const prompt = buildAssistantIdentityPrompt(baseInput());
    assert(
      prompt.includes('THEIR OWN name') || prompt.includes('personal details'),
      'prompt must redirect user-identity questions to USER CONTEXT section'
    );
    console.log('  ✓ user-identity question redirected to USER CONTEXT\n');
  }

  // --- buildContextAnchorPrompt ---

  console.log('Test: anchor includes assistant name and no-provider rule');
  {
    const anchor = buildContextAnchorPrompt(
      baseInput({ assistantProfile: { name: 'Enzo' } })
    );
    assert(anchor.includes('CONTEXT ANCHOR'), 'must have CONTEXT ANCHOR header');
    assert(anchor.includes('"Enzo"'), 'anchor must repeat name');
    assert(anchor.includes('privately configured AI assistant'), 'anchor must repeat no-provider rule');
    console.log('  ✓ anchor repeats name and provider-confidentiality rule\n');
  }

  console.log('Test: anchor includes user name from dynamic memory (memoryBlock)');
  {
    const anchor = buildContextAnchorPrompt(
      baseInput({
        assistantProfile: { name: 'Enzo' },
        memoryBlock: 'FACTS ABOUT THE USER:\nThe user\'s name is "Franco".',
        userProfile: { displayName: 'Someone Else' },
      })
    );
    assert(anchor.includes('Franco'), `anchor should use dynamic name "Franco", got: ${anchor}`);
    assert(!anchor.includes('Someone Else'), 'dynamic memory must win over static profile');
    console.log('  ✓ anchor: dynamic memory name wins over static profile\n');
  }

  console.log('Test: anchor falls back to static profile name when no dynamic memory');
  {
    const anchor = buildContextAnchorPrompt(
      baseInput({
        assistantProfile: { name: 'Enzo' },
        userProfile: { displayName: 'Maria' },
      })
    );
    assert(anchor.includes('Maria'), `anchor should use static profile name "Maria", got: ${anchor}`);
    console.log('  ✓ anchor falls back to static profile displayName\n');
  }

  console.log('Test: anchor omits user name line when no profile or memory');
  {
    const anchor = buildContextAnchorPrompt(baseInput());
    const lines = anchor.split('\n');
    assert(lines.length === 2, `anchor should have exactly 2 lines when no user name, got ${lines.length}`);
    console.log('  ✓ anchor has no user name line when none available\n');
  }

  console.log('AssistantIdentity tests passed. ✓');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
