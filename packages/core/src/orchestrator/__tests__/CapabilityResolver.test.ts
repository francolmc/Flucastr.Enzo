import { CapabilityResolver } from '../CapabilityResolver.js';
import { AvailableCapabilities } from '../types.js';

// Mock tools for testing
const mockTools = [
  {
    name: 'execute_command',
    description: 'Execute shell commands',
    parameters: { type: 'object', properties: { command: { type: 'string' } } },
  },
  {
    name: 'read_file',
    description: 'Read files from filesystem',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
  },
  {
    name: 'web_search',
    description: 'Search the web',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'remember',
    description: 'Save to memory',
    parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } } },
  },
  {
    name: 'slack_post',
    description: 'Post to Slack',
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
  },
];

const mockSkills = [
  {
    name: 'weather_skill',
    description: 'Check weather',
  },
];

const mockAgents = [
  {
    id: 'agent_1',
    name: 'Expert Agent',
    description: 'Expert agent',
    provider: 'anthropic',
    model: 'claude-3-sonnet',
  },
];

async function runTests() {
  const assert = (condition: boolean, message: string): void => {
    if (!condition) {
      throw new Error(message);
    }
  };

  const resolver = new CapabilityResolver();
  const capabilities: AvailableCapabilities = {
    tools: mockTools,
    skills: mockSkills,
    agents: mockAgents,
  };

  console.log('Testing CapabilityResolver normalizeAction...\n');

  // Test 1: Contradictory JSON - explicit tool name should win over inferred params
  console.log('Test 1: Contradictory JSON - should keep explicit read_file');
  const contradictory = {
    action: 'tool',
    tool: 'read_file',
    input: { command: 'ls /tmp' },
  };

  const result1 = await resolver.resolve(JSON.stringify(contradictory), capabilities);
  console.log('Input:', JSON.stringify(contradictory, null, 2));
  console.log('Resolved action:');
  console.log('  - Type:', result1.type);
  console.log('  - Target:', result1.target);
  console.log('  - Reason:', result1.reason);
  console.log('  - Input keys:', Object.keys(result1.input));
  console.log('Expected target: read_file');
  assert(result1.target === 'read_file', `Test 1 failed: expected read_file, got ${result1.target}`);
  console.log('✓ Pass');
  console.log('');

  // Test 2: Contradictory JSON - explicit tool name should win over inferred params
  console.log('Test 2: Contradictory JSON - should keep explicit execute_command');
  const contradictory2 = {
    action: 'tool',
    tool: 'execute_command',
    input: { path: './README.md' },
  };

  const result2 = await resolver.resolve(JSON.stringify(contradictory2), capabilities);
  console.log('Input:', JSON.stringify(contradictory2, null, 2));
  console.log('Resolved action:');
  console.log('  - Type:', result2.type);
  console.log('  - Target:', result2.target);
  console.log('  - Reason:', result2.reason);
  console.log('Expected target: execute_command');
  assert(result2.target === 'execute_command', `Test 2 failed: expected execute_command, got ${result2.target}`);
  console.log('✓ Pass');
  console.log('');

  // Test 3: Normal Format A - no contradiction, should pass through
  console.log('Test 3: Normal Format A - valid read_file with path parameter');
  const normalA = {
    action: 'tool',
    tool: 'read_file',
    input: { path: './config.json' },
  };

  const result3 = await resolver.resolve(JSON.stringify(normalA), capabilities);
  console.log('Input:', JSON.stringify(normalA, null, 2));
  console.log('Resolved action:');
  console.log('  - Type:', result3.type);
  console.log('  - Target:', result3.target);
  console.log('Expected target: read_file (no change)');
  assert(result3.target === 'read_file', `Test 3 failed: expected read_file, got ${result3.target}`);
  console.log('✓ Pass');
  console.log('');

  // Test 4: Format B (shorthand) - action is the tool name
  console.log('Test 4: Format B shorthand - execute_command with command parameter');
  const formatB = {
    action: 'execute_command',
    command: 'pwd',
  };

  const result4 = await resolver.resolve(JSON.stringify(formatB), capabilities);
  console.log('Input:', JSON.stringify(formatB, null, 2));
  console.log('Resolved action:');
  console.log('  - Type:', result4.type);
  console.log('  - Target:', result4.target);
  console.log('  - Input keys:', Object.keys(result4.input));
  console.log('Expected target: execute_command');
  assert(result4.target === 'execute_command', `Test 4 failed: expected execute_command, got ${result4.target}`);
  console.log('✓ Pass');
  console.log('');

  // Test 5: Web search with query parameter but explicit remember tool
  console.log('Test 5: Contradictory JSON - should keep explicit remember');
  const webSearch = {
    action: 'tool',
    tool: 'remember',
    input: { query: 'what is TypeScript' },
  };

  const result5 = await resolver.resolve(JSON.stringify(webSearch), capabilities);
  console.log('Input:', JSON.stringify(webSearch, null, 2));
  console.log('Resolved action:');
  console.log('  - Type:', result5.type);
  console.log('  - Target:', result5.target);
  console.log('Expected target: remember');
  assert(result5.target === 'remember', `Test 5 failed: expected remember, got ${result5.target}`);
  console.log('✓ Pass');
  console.log('');

  // Test 6: Remember params with explicit web_search tool
  console.log('Test 6: Contradictory JSON - should keep explicit web_search');
  const remember = {
    action: 'tool',
    tool: 'web_search',
    input: { key: 'user_preference', value: 'typescript' },
  };

  const result6 = await resolver.resolve(JSON.stringify(remember), capabilities);
  console.log('Input:', JSON.stringify(remember, null, 2));
  console.log('Resolved action:');
  console.log('  - Type:', result6.type);
  console.log('  - Target:', result6.target);
  console.log('Expected target: web_search');
  assert(result6.target === 'web_search', `Test 6 failed: expected web_search, got ${result6.target}`);
  console.log('✓ Pass');
  console.log('');

  // Test 7: Custom host tool — action field is the tool name (Format B)
  console.log('Test 7: Custom tool slack_post via action shorthand');
  const customShorthand = {
    action: 'slack_post',
    text: 'hello team',
  };
  const result7 = await resolver.resolve(JSON.stringify(customShorthand), capabilities);
  assert(result7.type === 'tool', 'Test 7: expected tool');
  assert(result7.target === 'slack_post', `Test 7: expected slack_post, got ${result7.target}`);
  console.log('✓ Pass');
  console.log('');

  // Test 8: Prose response (no JSON) → proseOnly: true
  console.log('Test 8: Prose response — should return proseOnly:true');
  const result8 = await resolver.resolve('I will search the web for that.', capabilities);
  assert(result8.type === 'none', `Test 8: expected none, got ${result8.type}`);
  if (result8.type !== 'none') throw new Error('unreachable');
  assert(result8.proseOnly === true, `Test 8: expected proseOnly=true, got ${String(result8.proseOnly)}`);
  console.log('✓ Pass');
  console.log('');

  // Test 9: Explicit {action:"none"} → proseOnly: false (done signal)
  console.log('Test 9: Explicit action:none — should return proseOnly:false');
  const result9 = await resolver.resolve('{"action":"none"}', capabilities);
  assert(result9.type === 'none', `Test 9: expected none, got ${result9.type}`);
  if (result9.type !== 'none') throw new Error('unreachable');
  assert(result9.proseOnly === false, `Test 9: expected proseOnly=false, got ${String(result9.proseOnly)}`);
  console.log('✓ Pass');
  console.log('');

  // Test 10: Unknown tool name → proseOnly: true (retry needed)
  console.log('Test 10: Unknown tool — should return proseOnly:true');
  const result10 = await resolver.resolve('{"action":"tool","tool":"git_repos","input":{}}', capabilities);
  assert(result10.type === 'none', `Test 10: expected none, got ${result10.type}`);
  if (result10.type !== 'none') throw new Error('unreachable');
  assert(result10.proseOnly === true, `Test 10: expected proseOnly=true, got ${String(result10.proseOnly)}`);
  assert(result10.reason.startsWith('Tool not found:'), `Test 10: expected 'Tool not found:' in reason`);
  console.log('✓ Pass');
  console.log('');

  // Test 11: Malformed JSON with trailing comma — should still parse
  console.log('Test 11: Trailing comma in JSON — should still resolve correctly');
  const result11 = await resolver.resolve('{"action":"tool","tool":"execute_command","input":{"command":"ls"},}', capabilities);
  assert(result11.type === 'tool', `Test 11: expected tool, got ${result11.type}`);
  assert(result11.target === 'execute_command', `Test 11: expected execute_command, got ${result11.target}`);
  console.log('✓ Pass');
  console.log('');

  // Test 12: Prose before JSON — should extract and resolve JSON
  console.log('Test 12: Prose before JSON — should extract and resolve JSON');
  const result12 = await resolver.resolve(
    'Let me search for that. {"action":"tool","tool":"web_search","input":{"query":"test"}}',
    capabilities
  );
  assert(result12.type === 'tool', `Test 12: expected tool, got ${result12.type}`);
  assert(result12.target === 'web_search', `Test 12: expected web_search, got ${result12.target}`);
  console.log('✓ Pass');
  console.log('');

  console.log('All tests completed! ✓');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
