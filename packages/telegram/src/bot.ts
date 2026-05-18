import { Telegraf } from 'telegraf';
import { createModelClient } from '../../core/src/model/client.js';
import { createMemory } from '../../core/src/memory/memory.js';
import { createPlanner } from '../../core/src/planner/planner.js';
import { createMcpRegistry } from '../../core/src/mcp/registry.js';
import { loadConfig } from '../../core/src/config.js';
import os from 'os';

const config = loadConfig();
const memory = createMemory(config);
const model = createModelClient(config);
const mcpRegistry = await createMcpRegistry(config.mcpServers, memory);
const planner = createPlanner(model, memory, mcpRegistry);

const USER_ID = config.telegramOwnerId ?? 'franco';

memory.saveFact(USER_ID, 'name', 'Franco');
memory.saveFact(USER_ID, 'home', os.homedir());
memory.saveFact(USER_ID, 'tasks_file', `${os.homedir()}/tareas.md`);

export function createBot(token: string) {
  const bot = new Telegraf(token);

  bot.on('text', async (ctx) => {
    const userId = String(ctx.from.id);

    if (userId !== config.telegramOwnerId) return;

    const userMessage = ctx.message.text;
    await ctx.sendChatAction('typing');

    try {
      const response = await planner.resolve(userMessage, USER_ID);
      await ctx.reply(response.slice(0, 4000));
    } catch (error) {
      await ctx.reply('Ocurrió un error. Intenta de nuevo.');
      console.error('[telegram error]:', error);
    }
  });

  return bot;
}