import readline from 'readline';
import os from 'os';
import { createModelClient } from '../model/client.js';
import { createMemory } from '../memory/memory.js';
import { createPlanner } from '../planner/planner.js';
import { loadConfig } from '../config.js';
import { createMcpRegistry } from '../mcp/registry.js';
import { createConversationMemory } from '../memory/conversation.js';
import type { ExecutionContext } from '../planner/types.js';

const USER_ID = 'franco';

function buildExecutionContext(
  understandContext: string | undefined,
  conversationContext: string | undefined,
  previousResults: string[]
): ExecutionContext {
  return {
    understandContext: understandContext ?? '',
    conversationContext: conversationContext ?? '',
    previousResults,
  };
}

async function main() {
  const config = loadConfig();
  const memory = createMemory(config);
  const model = createModelClient(config);
  const mcpRegistry = await createMcpRegistry(config.mcpServers, memory);
  const planner = createPlanner(model, memory, mcpRegistry);
  const conversationMemory = createConversationMemory();

  memory.saveFact(USER_ID, 'name', 'Franco');
  memory.saveFact(USER_ID, 'home', os.homedir());
  memory.saveFact(USER_ID, 'tasks_file', `${os.homedir()}/tareas.md`);
  memory.saveFact(USER_ID, 'assistant_description',
  'Enzo is a personal AI assistant built to help Franco with daily tasks, web search, file management, and automation. Enzo runs on small local models using the Amplify architecture.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Enzo listo. Escribe tu mensaje (Ctrl+C para salir)\n');

  const ask = () => {
    rl.question('> ', async (userMessage) => {
      if (!userMessage.trim()) { ask(); return; }

      const understandContext = conversationMemory.getRelevantForUnderstand(userMessage);
      const conversationContext = conversationMemory.getRelevant(userMessage);
      const previousResults = conversationMemory.getLastTurnResults();

      const executionContext = buildExecutionContext(
        understandContext,
        conversationContext,
        previousResults
      );

      const result = await planner.resolve(userMessage, USER_ID, executionContext, false);
      conversationMemory.save(userMessage, result.content);
      console.log(`\nEnzo: ${result.content}\n`);
      ask();
    });
  };

  ask();
}

main().catch(console.error);