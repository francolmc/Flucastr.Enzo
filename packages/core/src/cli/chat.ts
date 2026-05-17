import readline from 'readline';
import os from 'os';
import { createModelClient } from '../model/client.js';
import { createMemory } from '../memory/memory.js';
import { createExecutor } from '../executor/executor.js';
import { createPlanner } from '../planner/planner.js';
import { loadConfig } from '../config.js';
import { setupTools } from '../tools/setup.js';
import { Message } from '../model/client.js';

const MAX_ITERATIONS = 10;
const USER_ID = 'franco';

async function main() {
  const config = loadConfig();
  const memory = createMemory(config);
  const model = createModelClient(config);
  const executor = createExecutor(memory);
  const planner = createPlanner(model, memory);

  await setupTools(memory);

  memory.saveFact(USER_ID, 'name', 'Franco');
  memory.saveFact(USER_ID, 'home', os.homedir());

  const history: Message[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Enzo listo. Escribe tu mensaje (Ctrl+C para salir)\n');

  const ask = () => {
    rl.question('> ', async (userMessage) => {
      if (!userMessage.trim()) {
        ask();
        return;
      }

      history.push({ role: 'user', content: userMessage });

      let accumulatedContext = '';
      let iterations = 0;
      let finalResponse = '';

      while (iterations < MAX_ITERATIONS) {
        iterations++;

        const action = await planner.decide(
          userMessage,
          USER_ID,
          history.slice(-6),
          accumulatedContext || undefined
        );

        if (action.type === 'response' || action.type === 'done') {
          finalResponse = action.content;
          break;
        }

        if (action.type === 'tool') {
          process.stdout.write(`[${action.name}] `);
          const result = await executor.execute(action.name, action.input);
          process.stdout.write(result.success ? '✓\n' : '✗\n');

          accumulatedContext += `\nStep ${iterations}: ${action.name}(${JSON.stringify(action.input)})\n`;
          accumulatedContext += result.success
            ? `Result: ${result.output.slice(0, 300)}\n`
            : `Failed: ${result.output}\n`;
        }
      }

      if (!finalResponse) {
        finalResponse = accumulatedContext || 'No pude completar la tarea.';
      }

      console.log(`\nEnzo: ${finalResponse}\n`);
      history.push({ role: 'assistant', content: finalResponse });

      ask();
    });
  };

  ask();
}

main().catch(console.error);