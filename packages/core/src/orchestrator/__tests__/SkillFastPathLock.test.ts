import { resolveTopSkillDeclarativeExecutable } from '../skillFastPathLock.js';
import type { RelevantSkill } from '../SkillResolver.js';
import type { ExecutableTool } from '../../tools/types.js';

function mkTool(name: string): ExecutableTool {
  return {
    name,
    description: 'stub',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async () => ({ success: true, output: '' }),
  };
}

console.log('Running SkillFastPathLock tests...\n');

{
  const tools: ExecutableTool[] = [mkTool('execute_command'), mkTool('web_search')];
  const ranked: RelevantSkill[] = [
    {
      id: 'demo',
      name: 'demo skill',
      description: 'A demo skill',
      content: 'Some content.',
      relevanceScore: 0.95,
    },
  ];
  const r = resolveTopSkillDeclarativeExecutable(ranked, tools);
  if (r !== null) {
    throw new Error(`expected null (LLM-driven), got: ${JSON.stringify(r)}`);
  }
  console.log('ok: returns null (LLM-driven skill selection)');
}

{
  const tools: ExecutableTool[] = [mkTool('execute_command')];
  const ranked: RelevantSkill[] = [
    {
      id: 'weather',
      name: 'weather',
      description: 'Provides weather info',
      content: 'Multi-step:.geocoding, forecast',
      relevanceScore: 1,
    },
  ];
  const r = resolveTopSkillDeclarativeExecutable(ranked, tools);
  if (r !== null) {
    throw new Error('expected null for any skill');
  }
  console.log('ok: returns null regardless of content');
}

console.log('\nAll SkillFastPathLock tests passed.');