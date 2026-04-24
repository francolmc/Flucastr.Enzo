import assert from 'node:assert/strict';
import { impliesMultiToolWorkflow } from '../taskRoutingHints.js';

function runTests(): void {
  assert.equal(impliesMultiToolWorkflow('search for TypeScript news and save a summary to out.md'), true);
  assert.equal(impliesMultiToolWorkflow('read the changelog and summarize it into notes.md'), true);
  assert.equal(impliesMultiToolWorkflow('hola'), false);
  assert.equal(impliesMultiToolWorkflow('list my Downloads folder'), false);
  assert.equal(impliesMultiToolWorkflow('search for weather in Santiago'), false);
  console.log('TaskRoutingHints tests passed');
}

runTests();
