import assert from 'node:assert/strict';
import { ToolRegistry } from '../ToolRegistry.js';
import { WebSearchTool } from '../WebSearchTool.js';
import { ExecuteCommandTool } from '../ExecuteCommandTool.js';

function assertDefinitionNamesMatchExecutable(registry: ToolRegistry): void {
  const defs = registry.getToolDefinitions();
  const all = registry.getAll();
  assert.equal(defs.length, all.length, 'getToolDefinitions and getAll must have same length');
  for (let i = 0; i < all.length; i++) {
    assert.equal(defs[i]!.name, all[i]!.name, `name mismatch at index ${i}`);
  }
}

console.log('ToolRegistry: definitions vs executable names');
{
  const registry = new ToolRegistry();
  registry.register(new WebSearchTool(() => null));
  registry.register(new ExecuteCommandTool());
  assertDefinitionNamesMatchExecutable(registry);
}
console.log('ToolRegistry tests passed');
