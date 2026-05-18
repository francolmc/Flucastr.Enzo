import readline from 'readline';
import os from 'os';
import { createModelClient } from '../model/client.js';
import { createMemory } from '../memory/memory.js';
import { createPlanner } from '../planner/planner.js';
import { loadConfig } from '../config.js';
import { createMcpRegistry } from '../mcp/registry.js';
import { createConversationMemory } from '../memory/conversation.js';

const USER_ID = 'franco';

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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Enzo listo. Escribe tu mensaje (Ctrl+C para salir)\n');

  const ask = () => {
    rl.question('> ', async (userMessage) => {
      if (!userMessage.trim()) { ask(); return; }

      const context = conversationMemory.getRelevant(userMessage);
      const response = await planner.resolve(userMessage, USER_ID, context);
      conversationMemory.save(userMessage, response);
      console.log(`\nEnzo: ${response}\n`);
      ask();
    });
  };

  ask();
}

main().catch(console.error);