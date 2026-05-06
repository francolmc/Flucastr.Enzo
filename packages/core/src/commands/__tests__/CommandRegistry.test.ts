import { CommandRegistry, resetCommandRegistry, getCommandRegistry } from '../CommandRegistry.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

// Simple assertion helpers following project pattern
function assertEq<T>(a: T, b: T, message: string): void {
  if (a !== b) {
    throw new Error(`${message} (expected ${b}, got ${a})`);
  }
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  console.log('Running CommandRegistry tests...\n');

  // Reset registry before tests
  resetCommandRegistry();
  const registry = getCommandRegistry();

  // Test 1: Register command
  console.log('Test 1: Register command');
  registry.register({
    name: 'test.command',
    description: 'Test command',
    category: 'chat',
    requiresAdmin: false,
    handler: async () => ({ success: true, message: 'OK' }),
  });
  assertCondition(registry.has('test.command'), 'Registry should have test.command');
  assertEq(registry.size, 1, 'Registry size should be 1');
  console.log('✓ Command registered successfully\n');

  // Test 2: Overwrite existing command
  console.log('Test 2: Overwrite existing command');
  registry.register({
    name: 'test.command',
    description: 'Updated description',
    category: 'system',
    requiresAdmin: true,
    handler: async () => ({ success: true, message: 'Updated' }),
  });
  const retrieved = registry.get('test.command');
  assertEq(retrieved?.description, 'Updated description', 'Description should be updated');
  assertEq(retrieved?.requiresAdmin, true, 'requiresAdmin should be true');
  console.log('✓ Command overwritten successfully\n');

  // Test 3: List commands for regular user (should filter admin commands)
  console.log('Test 3: List commands for regular user');
  registry.register({
    name: 'user.command',
    description: 'User command',
    category: 'chat',
    requiresAdmin: false,
    handler: async () => ({ success: true, message: 'OK' }),
  });
  const userCommands = registry.list('user');
  assertEq(userCommands.length, 1, 'User should see only 1 command');
  assertEq(userCommands[0].name, 'user.command', 'User should see user.command');
  console.log('✓ User commands filtered correctly\n');

  // Test 4: List commands for admin (should see all)
  console.log('Test 4: List commands for admin');
  const adminCommands = registry.list('admin');
  assertEq(adminCommands.length, 2, 'Admin should see 2 commands');
  console.log('✓ Admin sees all commands\n');

  // Test 5: Execute command successfully
  console.log('Test 5: Execute command successfully');
  registry.register({
    name: 'greet',
    description: 'Greet user',
    category: 'chat',
    requiresAdmin: false,
    handler: async (ctx: CommandContext): Promise<CommandResult> => ({
      success: true,
      message: `Hello ${ctx.userId}`,
    }),
  });
  const result = await registry.execute('greet', { userId: '123' });
  assertEq(result.success, true, 'Execution should succeed');
  assertEq(result.message, 'Hello 123', 'Message should include userId');
  console.log('✓ Command executed successfully\n');

  // Test 6: Execute non-existent command
  console.log('Test 6: Execute non-existent command');
  const notFoundResult = await registry.execute('nonexistent', { userId: '123' });
  assertEq(notFoundResult.success, false, 'Should return error');
  assertCondition(notFoundResult.message.includes('not found'), 'Error should mention not found');
  console.log('✓ Non-existent command handled correctly\n');

  // Test 7: Deny admin command to regular user
  console.log('Test 7: Deny admin command to regular user');
  registry.register({
    name: 'admin-only',
    description: 'Admin only',
    category: 'system',
    requiresAdmin: true,
    handler: async () => ({ success: true, message: 'OK' }),
  });
  const deniedResult = await registry.execute('admin-only', {
    userId: '123',
    userRole: 'user',
  });
  assertEq(deniedResult.success, false, 'Admin command should be denied to user');
  assertCondition(deniedResult.message.includes('admin'), 'Error should mention admin');
  console.log('✓ Admin command denied to regular user\n');

  // Test 8: Allow admin command to admin user
  console.log('Test 8: Allow admin command to admin user');
  const allowedResult = await registry.execute('admin-only', {
    userId: '123',
    userRole: 'admin',
  });
  assertEq(allowedResult.success, true, 'Admin command should succeed for admin');
  console.log('✓ Admin command allowed to admin user\n');

  // Test 9: Handle handler errors gracefully
  console.log('Test 9: Handle handler errors gracefully');
  registry.register({
    name: 'error-command',
    description: 'Throws error',
    category: 'chat',
    requiresAdmin: false,
    handler: async () => {
      throw new Error('Something went wrong');
    },
  });
  const errorResult = await registry.execute('error-command', { userId: '123' });
  assertEq(errorResult.success, false, 'Error should be caught');
  assertEq(errorResult.message, 'Something went wrong', 'Error message should be preserved');
  console.log('✓ Handler errors handled gracefully\n');

  // Test 10: Unregister command
  console.log('Test 10: Unregister command');
  registry.register({
    name: 'temp.command',
    description: 'Temporary',
    category: 'chat',
    requiresAdmin: false,
    handler: async () => ({ success: true, message: 'OK' }),
  });
  const removed = registry.unregister('temp.command');
  assertEq(removed, true, 'Unregister should return true');
  assertCondition(!registry.has('temp.command'), 'Command should be removed');
  console.log('✓ Command unregistered successfully\n');

  // Test 11: Unregister non-existent command
  console.log('Test 11: Unregister non-existent command');
  const notRemoved = registry.unregister('nonexistent');
  assertEq(notRemoved, false, 'Unregister should return false for non-existent');
  console.log('✓ Non-existent command unregistration handled correctly\n');

  // Test 12: Get non-existent command
  console.log('Test 12: Get non-existent command');
  const undefinedCmd = registry.get('nonexistent');
  assertEq(undefinedCmd, undefined, 'Get should return undefined');
  console.log('✓ Get non-existent command handled correctly\n');

  console.log('All CommandRegistry tests passed! ✓');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
