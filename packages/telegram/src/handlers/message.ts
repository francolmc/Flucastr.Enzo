import { Telegraf } from 'telegraf';
import type { EnzoContext } from '../bot.js';
import type { Step } from '@enzo/core';
import { LanguageMiddleware } from '../LanguageMiddleware.js';
import { startTyping } from '../typing.js';
import { tryHandleAgentCommandText } from './commands.js';
import { getCurrentConversationId } from './conversationState.js';
import { randomUUID } from 'crypto';

const MAX_MESSAGE_LENGTH = 4096;

/** Best-effort user-visible error; logs if Telegram rejects the send (e.g. rate limit). */
async function safeReply(ctx: EnzoContext, text: string): Promise<void> {
  try {
    await ctx.reply(text);
  } catch (err) {
    console.error('[Telegram] safeReply failed:', err);
  }
}

function getAllowedUsers(): Set<string> {
  return new Set(
    (process.env.TELEGRAM_ALLOWED_USERS || '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  );
}

function getProgressEmoji(step: Step): string {
  if (step.type === 'think') {
    return '🧠';
  }
  if (step.type === 'act') {
    switch (step.target) {
      case 'web_search':
        return '🔍';
      case 'read_file':
        return '📂';
      case 'execute_command':
        return '⚡';
      case 'remember':
        return '💾';
      case 'schedule_reminder':
        return '⏰';
      default:
        return '⚙️';
    }
  }
  if (step.type === 'synthesize') {
    return '✍️';
  }
  return '🦊';
}

function getProgressText(step: Step): string {
  if (step.type === 'think') {
    return 'Analizando...';
  }
  if (step.type === 'act') {
    switch (step.target) {
      case 'web_search':
        return 'Buscando en internet...';
      case 'read_file':
        return 'Leyendo archivo...';
      case 'execute_command':
        return 'Ejecutando comando...';
      case 'remember':
        return 'Guardando en memoria...';
      case 'schedule_reminder':
        return 'Programando recordatorio...';
      default:
        return 'Ejecutando herramienta...';
    }
  }
  if (step.type === 'synthesize') {
    return 'Preparando respuesta...';
  }
  return 'Procesando...';
}

async function processMessageInBackground(
  ctx: EnzoContext,
  userId: string,
  messageText: string,
  conversationId: string,
  explicitAgentId: string | undefined,
  requestId: string
): Promise<void> {
  const typingSession = startTyping(ctx);
  let progressMessageId: number | null = null;

  try {
    // Step 0: Setup language middleware
    const languageMiddleware = new LanguageMiddleware(ctx.orchestrator.getBaseProvider());
    
    // Step 1: Detect language; optionally translate input to English (see TELEGRAM_TRANSLATE_INPUT in LanguageMiddleware)
    const langContext = await languageMiddleware.processInput(messageText, userId);
    const workingMessage = langContext.translatedInput;
    console.log(`[Telegram] Language: ${langContext.userLanguage}, translated: ${langContext.wasTranslated}`);

    const resolvedAgentId = explicitAgentId;

    const profile = ctx.configService?.getUserProfile();
    const systemTz = ctx.configService?.getSystemConfig()?.tz?.trim();
    const timeLocale =
      profile?.locale?.trim() ||
      (langContext.userLanguage.toLowerCase().startsWith('en') ? 'en-US' : 'es-CL');
    const timeZone = profile?.timezone?.trim() || systemTz;

    // Step 2: Classify using the working message (in English)
    const complexityLevel = await ctx.orchestrator.classify(workingMessage, userId, conversationId, 'telegram');
    console.log(`[Telegram] Classified as: ${complexityLevel}`);

    // Step 3: Only show progress message for non-SIMPLE tasks
    const isSimple = complexityLevel === 'SIMPLE';
    
    if (!isSimple) {
      const progressMsg = await ctx.reply('🦊 Entendido, trabajando en eso...');
      progressMessageId = progressMsg.message_id;
    }

    // Step 4: Process with orchestrator (no time limit in background)
    const result = await ctx.orchestrator.process({
      message: workingMessage,
      originalMessage: langContext.originalInput,
      conversationId,
      userId,
      source: 'telegram',
      requestId,
      userLanguage: langContext.userLanguage,
      agentId: resolvedAgentId,
      classifiedLevel: complexityLevel as any,
      toolExecutionContext: {
        source: 'telegram',
        conversationId,
        telegramChatId: ctx.chat?.id != null ? String(ctx.chat.id) : undefined,
      },
      runtimeHints: {
        homeDir: process.env.HOME,
        osLabel: process.platform === 'darwin' ? 'macOS' : process.platform,
        timeLocale,
        ...(timeZone ? { timeZone } : {}),
      },
      onProgress: isSimple ? undefined : async (step) => {
        if (progressMessageId && ctx.chat) {
          const emoji = getProgressEmoji(step);
          const text = getProgressText(step);
          try {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              progressMessageId,
              undefined,
              `${emoji} ${text}`
            );
          } catch (err) {
            console.warn('[Telegram] Failed to update progress message:', err);
          }
        }
      },
    });

    // Step 5: Translate response back to user's language
    const baseContent = result.content || 'No se pudo procesar tu mensaje.';
    const translatedContent = await languageMiddleware.processOutput(
      baseContent,
      langContext.userLanguage
    );

    // Prepare response with metadata
    const metadata = `_⚡ ${result.modelUsed} · ${result.durationMs}ms_`;

    // Handle message splitting if necessary
    if (translatedContent.length + metadata.length + 10 > MAX_MESSAGE_LENGTH) {
      // Content is too long, split it
      const chunks: string[] = [];
      let remaining = translatedContent;

      while (remaining.length > MAX_MESSAGE_LENGTH - 50) {
        chunks.push(remaining.substring(0, MAX_MESSAGE_LENGTH - 50));
        remaining = remaining.substring(MAX_MESSAGE_LENGTH - 50);
      }

      if (remaining.length > 0) {
        chunks.push(remaining);
      }

      // Send all chunks except the last
      for (let i = 0; i < chunks.length - 1; i++) {
        await ctx.reply(chunks[i]);
      }

      // Send last chunk with metadata
      const lastChunk = chunks[chunks.length - 1] || '';
      const finalMessage = `${lastChunk}\n\n${metadata}`;
      await ctx.reply(finalMessage);
    } else {
      // Message fits in one, send with metadata
      const finalMessage = `${translatedContent}\n\n${metadata}`;
      await ctx.reply(finalMessage);
    }

    // Extract and save memories in background — no await, no blocking
    const memoryExtractor = ctx.orchestrator.getMemoryExtractor();
    memoryExtractor.extractAndSave(
      userId,
      messageText,
      result.content
    ).catch(err => {
      console.error('[Telegram] Memory extraction error:', err);
    });
  } catch (error) {
    console.error('[Telegram] Error processing message:', error, { requestId, userId, conversationId });
    const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    await safeReply(ctx, `❌ Error: ${errorMsg}\n\n_id: ${requestId}_`);
  } finally {
    typingSession.stop();
  }
}

export function registerMessageHandler(bot: Telegraf<EnzoContext>): void {
  bot.on('text', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const messageText = ctx.message?.text || '';

    // Get allowed users dynamically
    const allowedUsers = getAllowedUsers();

    // Security check
    if (!allowedUsers.has(userId)) {
      console.warn(`[Telegram] Unauthorized access attempt from user ${userId}`);
      await ctx.reply('No tienes acceso a Enzo.');
      return;
    }

    if (await tryHandleAgentCommandText(ctx, messageText)) {
      return;
    }

    const entities = ctx.message.entities;
    const firstEntity = entities?.[0];
    if (firstEntity?.type === 'bot_command' && firstEntity.offset === 0) {
      await ctx.reply('Comando no reconocido. Usa /help para ver la lista.');
      return;
    }

    const conversationId = getCurrentConversationId(userId);
    const requestId = randomUUID();

    let explicitAgentId: string | undefined;
    try {
      explicitAgentId = await ctx.memoryService.getConversationActiveAgent(conversationId);
    } catch (error) {
      console.warn('[Telegram] Failed to load conversation active agent:', error);
    }

    // Fire and forget - process in background to avoid Telegraf timeout
    processMessageInBackground(ctx, userId, messageText, conversationId, explicitAgentId, requestId).catch(
      (err) => {
        console.error('[Telegram] Fatal error in background processing:', err, {
          requestId,
          userId,
          conversationId,
        });
        void safeReply(
          ctx,
          `❌ Error interno al procesar el mensaje.\n\n_id: ${requestId}_\nSi persiste, revisa los logs del servidor.`
        );
      }
    );

    // Handler returns immediately - Telegraf doesn't timeout
  });
}
