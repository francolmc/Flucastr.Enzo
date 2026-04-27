import { CapabilityResolver } from '../CapabilityResolver.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

const tools = [
  {
    name: 'execute_command',
    triggers: undefined,
  },
  {
    name: 'recall',
    triggers: ['qué tengo pendiente', 'mis tareas', 'recordás'] as const,
  },
];

console.log('CapabilityResolver.resolveByTrigger tests...\n');

const resolver = new CapabilityResolver();

console.log('Test: matches canonical phrase');
{
  const m = resolver.resolveByTrigger('¿qué tengo pendiente de Dash?', tools);
  assert(m !== null, 'expected a match');
  assert(m!.toolName === 'recall', `expected recall, got ${m!.toolName}`);
  assert(m!.matched === 'qué tengo pendiente', `expected matched phrase, got ${m!.matched}`);
  console.log('✓ Pass\n');
}

console.log('Test: case-insensitive');
{
  const m = resolver.resolveByTrigger('Mis Tareas para mañana', tools);
  assert(m !== null && m.toolName === 'recall', 'expected case-insensitive match');
  console.log('✓ Pass\n');
}

console.log('Test: diacritic-insensitive');
{
  const m = resolver.resolveByTrigger('¿Que tengo pendiente?', tools);
  assert(m !== null && m.toolName === 'recall', 'expected match without tilde');
  console.log('✓ Pass\n');
}

console.log('Test: trigger phrase with diacritic in tool list still matches plain text');
{
  const m = resolver.resolveByTrigger('recordas que dijimos algo', tools);
  assert(m !== null && m.toolName === 'recall', 'expected to match recordás without tilde in input');
  console.log('✓ Pass\n');
}

console.log('Test: returns null when no trigger matches');
{
  const m = resolver.resolveByTrigger('Buscá novedades de IA en internet', tools);
  assert(m === null, 'expected no match');
  console.log('✓ Pass\n');
}

console.log('Test: returns null when no tools declare triggers');
{
  const noTriggers = [{ name: 'execute_command' }, { name: 'web_search' }];
  const m = resolver.resolveByTrigger('¿qué tengo pendiente?', noTriggers);
  assert(m === null, 'expected no match when no triggers configured');
  console.log('✓ Pass\n');
}

console.log('Test: returns null for empty message');
{
  const m = resolver.resolveByTrigger('', tools);
  assert(m === null, 'expected no match for empty message');
  console.log('✓ Pass\n');
}

console.log('CapabilityResolverTriggers tests passed.');
process.exit(0);
