import { Telegraf } from 'telegraf';
import type { Context } from 'telegraf';
import type { Orchestrator, MemoryService } from '@enzo/core';

export interface EnzoContext extends Context {
  orchestrator: Orchestrator;
  memoryService: MemoryService;
}

export function createBot(
  orchestrator: Orchestrator,
  memoryService: MemoryService
): Telegraf<EnzoContext> {
  const bot = new Telegraf<EnzoContext>(
    process.env.TELEGRAM_BOT_TOKEN || '',
    {
      handlerTimeout: 90_000,
    }
  );

  // Attach orchestrator and memoryService to context
  bot.use((ctx, next) => {
    ctx.orchestrator = orchestrator;
    ctx.memoryService = memoryService;
    return next();
  });

  return bot;
}
