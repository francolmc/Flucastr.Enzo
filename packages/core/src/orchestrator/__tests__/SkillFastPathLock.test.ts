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
      name: 'demo',
      description: 'd',
      content: '',
      relevanceScore: 0.95,
      steps: [
        {
          id: 's1',
          description: 'list',
          tool: 'execute_command',
          commandHint: 'GH_PAGER=cat gh repo list --limit 10',
        },
      ],
    },
  ];
  const r = resolveTopSkillDeclarativeExecutable(ranked, tools);
  if (!r || r.tool !== 'execute_command' || r.commandHint?.includes('gh repo list') !== true) {
    throw new Error(`expected declarative gh lock hint, got: ${JSON.stringify(r)}`);
  }
  console.log('ok: single-step declarative resolves when tool registered');
}

{
  const tools: ExecutableTool[] = [mkTool('web_search')];
  const ranked: RelevantSkill[] = [
    {
      id: 'x',
      name: 'x',
      description: '',
      content: '',
      relevanceScore: 1,
      steps: [{ id: 'a', description: '', tool: 'execute_command' }],
    },
  ];
  const r = resolveTopSkillDeclarativeExecutable(ranked, tools);
  if (r !== null) {
    throw new Error('expected null when execute_command not registered');
  }
  console.log('ok: declarative unresolved when runtime lacks tool');
}

{
  const tools: ExecutableTool[] = [mkTool('execute_command')];
  const ranked: RelevantSkill[] = [
    {
      id: 'y',
      name: 'y',
      description: '',
      content: '',
      relevanceScore: 1,
      steps: [
        { id: 'a', description: '', tool: 'execute_command' },
        { id: 'b', description: '', tool: 'execute_command' },
      ],
    },
  ];
  const r = resolveTopSkillDeclarativeExecutable(ranked, tools);
  if (r !== null) {
    throw new Error('expected null for multi-YAML-step skill');
  }
  console.log('ok: rejects multi-declared YAML steps');
}

console.log('\nAll SkillFastPathLock tests passed.');
