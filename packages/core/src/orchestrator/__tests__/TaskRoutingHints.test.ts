import assert from 'node:assert/strict';
import { impliesMultiToolWorkflow } from '../taskRoutingHints.js';

function runTests(): void {
  assert.equal(impliesMultiToolWorkflow('search for TypeScript news and then save a summary to out.md'), true);
  assert.equal(impliesMultiToolWorkflow('read the file and then write a summary'), true);
  assert.equal(impliesMultiToolWorkflow('hola'), false);
  assert.equal(impliesMultiToolWorkflow('list my Downloads folder'), false);
  assert.equal(impliesMultiToolWorkflow('busca el clima y luego guárdalo'), false);
  assert.equal(impliesMultiToolWorkflow('search for weather in Santiago'), false);
  assert.equal(impliesMultiToolWorkflow('read the changelog and summarize it into notes.md'), false);
  assert.equal(impliesMultiToolWorkflow('search for TypeScript news and save a summary'), false);
  console.log('TaskRoutingHints tests passed');
}

runTests();
