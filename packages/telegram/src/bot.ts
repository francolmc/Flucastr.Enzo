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
  const debugUpdates = (process.env.ENZO_DEBUG || '').toLowerCase() === 'true';

  const bot = new Telegraf<EnzoContext>(
    process.env.TELEGRAM_BOT_TOKEN || '',
    {
      handlerTimeout: 90_000,
    }
  );

  // Surface runtime handler errors so we can diagnose "silent" failures.
  bot.catch((err, ctx) => {
    const userId = String(ctx.from?.id || 'unknown');
    const chatId = String((ctx.chat as any)?.id || 'unknown');
    console.error(`[Telegram] Handler error (user=${userId}, chat=${chatId}):`, err);
  });

  if (debugUpdates) {
    bot.use(async (ctx, next) => {
      const userId = String(ctx.from?.id || 'unknown');
      const chatId = String((ctx.chat as any)?.id || 'unknown');
      const text = 'text' in (ctx.message || {}) ? (ctx.message as any).text : '';
      console.log(`[Telegram][Debug] update=${ctx.updateType} user=${userId} chat=${chatId} text=${JSON.stringify(text)}`);
      await next();
    });
  }

  // Attach orchestrator and memoryService to context
  bot.use((ctx, next) => {
    ctx.orchestrator = orchestrator;
    ctx.memoryService = memoryService;
    return next();
  });

  return bot;
}
