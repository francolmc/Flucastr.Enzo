import { Telegraf } from 'telegraf';
import type { EnzoContext } from '../bot.js';
import type { ConfigService, Step, OrchestratorInput } from '@enzo/core';
import {
  ComplexityLevel,
  InputChunker,
  buildChunkCaptureConfirmation,
  getMemoryExtractionMessages,
  buildOrchestratorRuntimeHints,
  AudioConverter,
  getVoiceTriggers,
  requestsVoiceResponse,
} from '@enzo/core';
import { LanguageMiddleware } from '../LanguageMiddleware.js';
import { startTyping } from '../typing.js';
import { tryHandleAgentCommandText } from './commands.js';
import { getCurrentConversationId } from './conversationState.js';
import { downloadUrlToBuffer } from '../downloadTelegramFile.js';
import { randomUUID } from 'crypto';

const MAX_MESSAGE_LENGTH = 4096;
const inputChunker = new InputChunker();
const TTS_FALLBACK_NOTE = '_(No pude generar audio, pero acá va la respuesta)_';

function complexityRank(level: ComplexityLevel): number {
  switch (level) {
    case ComplexityLevel.SIMPLE:
      return 0;
    case ComplexityLevel.MODERATE:
      return 1;
    case ComplexityLevel.COMPLEX:
      return 2;
    case ComplexityLevel.AGENT:
      return 3;
    default:
      return 0;
  }
}

function mergeHigherComplexity(a: ComplexityLevel, b: ComplexityLevel): ComplexityLevel {
  return complexityRank(b) > complexityRank(a) ? b : a;
}

/**
 * Telegram numeric id differs from chat web userId: when `telegramAgentOwnerUserId` is set,
 * persisted tools (calendar, remember, recall) use that id so Agenda/Memoria align with UI.
 */
function resolveTelegramPersistenceUserId(telegramUserId: string, configService?: ConfigService): string {
  const owner = configService?.getSystemConfig()?.telegramAgentOwnerUserId?.trim();
  if (owner) {
    return owner;
  }
  return telegramUserId;
}

/** Best-effort user-visible error; logs if Telegram rejects the send (e.g. rate limit). */
async function safeReply(ctx: EnzoContext, text: string): Promise<void> {
  try {
    await ctx.reply(text);
  } catch (err) {
    console.error('[Telegram] safeReply failed:', err);
  }
}

async function sendTextResponse(ctx: EnzoContext, content: string, metadata: string): Promise<void> {
  if (content.length + metadata.length + 10 > MAX_MESSAGE_LENGTH) {
    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > MAX_MESSAGE_LENGTH - 50) {
      chunks.push(remaining.substring(0, MAX_MESSAGE_LENGTH - 50));
      remaining = remaining.substring(MAX_MESSAGE_LENGTH - 50);
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    for (let i = 0; i < chunks.length - 1; i++) {
      await ctx.reply(chunks[i]);
    }

    const lastChunk = chunks[chunks.length - 1] || '';
    const finalMessage = `${lastChunk}\n\n${metadata}`;
    await ctx.reply(finalMessage);
    return;
  }

  const finalMessage = `${content}\n\n${metadata}`;
  await ctx.reply(finalMessage);
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
      case 'send_file':
        return '📎';
      case 'calendar':
        return '📅';
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
      case 'send_file':
        return 'Enviando archivo...';
      case 'calendar':
        return 'Actualizando agenda...';
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
  requestId: string,
  responsePrefix?: string,
  imageContext?: OrchestratorInput['imageContext']
): Promise<void> {
  const typingSession = startTyping(ctx);
  let progressMessageId: number | null = null;

  try {
    const persistenceUserId = resolveTelegramPersistenceUserId(userId, ctx.configService);

    // Step 0: Setup language middleware
    const languageMiddleware = new LanguageMiddleware(ctx.orchestrator.getBaseProvider());
    
    // Step 1: Detect language; optionally translate input to English (see TELEGRAM_TRANSLATE_INPUT in LanguageMiddleware)
    const langContext = await languageMiddleware.processInput(messageText, userId);
    const workingMessage = langContext.translatedInput;
    const chunkResult = inputChunker.chunk(workingMessage);
    console.log(`[Telegram] Language: ${langContext.userLanguage}, translated: ${langContext.wasTranslated}`);

    const resolvedAgentId = explicitAgentId;

    const profile = ctx.configService?.getUserProfile();
    const systemTz = ctx.configService?.getSystemConfig()?.tz?.trim();
    const timeLocale =
      profile?.locale?.trim() ||
      (langContext.userLanguage.toLowerCase().startsWith('en') ? 'en-US' : 'es-CL');
    const timeZone = profile?.timezone?.trim() || systemTz;

    // Step 2: Classify (use persistence user id for memory/session alignment with web/Echo owner)
    let complexityLevel = await ctx.orchestrator.classify(
      workingMessage,
      persistenceUserId,
      conversationId,
      'telegram'
    );
    if (
      langContext.wasTranslated &&
      langContext.originalInput.trim() !== workingMessage.trim()
    ) {
      const levelOrig = await ctx.orchestrator.classify(
        langContext.originalInput.trim(),
        persistenceUserId,
        conversationId,
        'telegram'
      );
      complexityLevel = mergeHigherComplexity(complexityLevel, levelOrig);
    }
    console.log(
      `[Telegram] Classified as: ${complexityLevel}; persistenceUserId=${persistenceUserId} (telegram id ${userId})`
    );

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
      userId: persistenceUserId,
      source: 'telegram',
      requestId,
      userLanguage: langContext.userLanguage,
      agentId: resolvedAgentId,
      classifiedLevel: complexityLevel as any,
      runtimeHints: buildOrchestratorRuntimeHints({
        homeDir: process.env.HOME,
        timeLocale,
        ...(timeZone ? { timeZone } : {}),
      }),
      ...(imageContext ? { imageContext } : {}),
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
    const baseContent = chunkResult.isLong
      ? buildChunkCaptureConfirmation(chunkResult)
      : result.content || 'No se pudo procesar tu mensaje.';
    const translatedContent = await languageMiddleware.processOutput(
      baseContent,
      langContext.userLanguage
    );

    const prefixedContent = responsePrefix
      ? `${responsePrefix}\n${translatedContent}`
      : translatedContent;

    const shouldSendVoice = ctx.configService
      ? requestsVoiceResponse(messageText, getVoiceTriggers(ctx.configService))
      : requestsVoiceResponse(messageText);

    // Prepare response with metadata
    const metadata = `_⚡ ${result.modelUsed} · ${result.durationMs}ms_`;

    if (shouldSendVoice) {
      const chatId = ctx.chat?.id;
      const ttsService = ctx.ttsService;
      let sentVoice = false;

      if (chatId != null && ttsService) {
        const ttsResult = await ttsService.synthesize(translatedContent, langContext.userLanguage);
        if (ttsResult.success && ttsResult.audioBuffer) {
          try {
            await ctx.telegram.sendVoice(chatId, { source: ttsResult.audioBuffer });
            sentVoice = true;
          } catch (error) {
            console.warn('[Telegram] Failed to send TTS voice message:', error);
          }
        } else if (ttsResult.error) {
          console.warn('[Telegram] TTS synthesis failed:', ttsResult.error);
        }
      }

      if (!sentVoice) {
        await sendTextResponse(ctx, `${TTS_FALLBACK_NOTE}\n\n${prefixedContent}`, metadata);
      } else {
        await sendTextResponse(ctx, prefixedContent, metadata);
      }
    } else {
      await sendTextResponse(ctx, prefixedContent, metadata);
    }

    // Extract and save memories in background — no await, no blocking
    const memoryExtractor = ctx.orchestrator.getMemoryExtractor();
    const extractMemory = async () => {
      const messages = getMemoryExtractionMessages(messageText, chunkResult);
      await Promise.all(
        messages.map((chunkedMessage) =>
          memoryExtractor.extractAndSave(persistenceUserId, chunkedMessage, result.content)
        )
      );
    };
    extractMemory().catch(err => {
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

function buildTranscriptionPrefix(transcribedText: string): string {
  return `🎙️ _"${transcribedText}"_`;
}

async function preloadMessageContext(
  ctx: EnzoContext,
  userId: string
): Promise<{ conversationId: string; requestId: string; explicitAgentId?: string }> {
  const conversationId = getCurrentConversationId(userId);
  const requestId = randomUUID();

  let explicitAgentId: string | undefined;
  try {
    explicitAgentId = await ctx.memoryService.getConversationActiveAgent(conversationId);
  } catch (error) {
    console.warn('[Telegram] Failed to load conversation active agent:', error);
  }

  return { conversationId, requestId, explicitAgentId };
}

async function allowAndPersistChat(ctx: EnzoContext, userId: string): Promise<boolean> {
  const allowedUsers = getAllowedUsers();
  if (!allowedUsers.has(userId)) {
    console.warn(`[Telegram] Unauthorized access attempt from user ${userId}`);
    await ctx.reply('No tienes acceso a Enzo.');
    return false;
  }

  const chatId = ctx.chat?.id != null ? String(ctx.chat.id) : undefined;
  if (chatId) {
    void ctx.memoryService.remember(userId, 'telegram_chat_id', chatId).catch((error) => {
      console.warn('[Telegram] Failed to persist telegram_chat_id:', error);
    });
  }

  return true;
}

function runBackgroundProcessing(
  ctx: EnzoContext,
  userId: string,
  messageText: string,
  conversationId: string,
  explicitAgentId: string | undefined,
  requestId: string,
  responsePrefix?: string,
  imageContext?: OrchestratorInput['imageContext']
): void {
  processMessageInBackground(
    ctx,
    userId,
    messageText,
    conversationId,
    explicitAgentId,
    requestId,
    responsePrefix,
    imageContext
  ).catch((err) => {
    console.error('[Telegram] Fatal error in background processing:', err, {
      requestId,
      userId,
      conversationId,
    });
    void safeReply(
      ctx,
      `❌ Error interno al procesar el mensaje.\n\n_id: ${requestId}_\nSi persiste, revisa los logs del servidor.`
    );
  });
}

async function downloadTelegramFileBuffer(ctx: EnzoContext, fileId: string): Promise<Buffer> {
  const fileUrl = await ctx.telegram.getFileLink(fileId);
  return downloadUrlToBuffer(fileUrl.toString());
}

/** Match FileHandler limits in telegram bootstrap */
const MAX_INCOMING_FILE_BYTES = 50 * 1024 * 1024;

function formatFileSizeHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function handleIncomingAttachment(
  ctx: EnzoContext,
  userId: string,
  fileId: string,
  originalName: string,
  mimeType: string,
  caption: string | undefined
): Promise<void> {
  const fileHandler = ctx.fileHandler;
  if (!fileHandler) {
    console.warn('[Telegram] fileHandler is not configured.');
    await safeReply(ctx, 'No puedo guardar archivos en este momento.');
    return;
  }

  try {
    let telegramSize: number | undefined;
    try {
      const fileMeta = await ctx.telegram.getFile(fileId);
      telegramSize =
        typeof (fileMeta as { file_size?: number }).file_size === 'number'
          ? (fileMeta as { file_size: number }).file_size
          : undefined;
    } catch (e) {
      console.warn('[Telegram] getFile failed:', e);
    }
    if (telegramSize !== undefined && telegramSize > MAX_INCOMING_FILE_BYTES) {
      await safeReply(ctx, `No pude guardar el archivo ${originalName}. ¿Podés intentar de nuevo?`);
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await downloadTelegramFileBuffer(ctx, fileId);
    } catch (e) {
      console.error('[Telegram] Attachment download failed:', e);
      await safeReply(ctx, `No pude guardar el archivo ${originalName}. ¿Podés intentar de nuevo?`);
      return;
    }

    if (buffer.length > MAX_INCOMING_FILE_BYTES) {
      await safeReply(ctx, `No pude guardar el archivo ${originalName}. ¿Podés intentar de nuevo?`);
      return;
    }

    let saved;
    try {
      saved = await fileHandler.save(buffer, originalName, mimeType);
    } catch (e) {
      console.error('[Telegram] fileHandler.save failed:', e);
      await safeReply(ctx, `No pude guardar el archivo ${originalName}. ¿Podés intentar de nuevo?`);
      return;
    }

    const who = ctx.from?.first_name?.trim() || 'Franco';
    const typeLabel = mimeType || saved.extension || 'application/octet-stream';
    const sizeHuman = formatFileSizeHuman(saved.sizeBytes);

    let contentDescription = '';
    const markItDown = ctx.markItDownService;
    if (markItDown && markItDown.isSupported(saved.extension)) {
      const conversion = await markItDown.convert(saved.localPath);
      if (conversion.success && conversion.markdown) {
        contentDescription = `\n\nContenido del archivo:\n${conversion.markdown}`;
      } else {
        contentDescription = `\n\n[No se pudo leer el contenido del archivo: ${conversion.error ?? 'unknown'}]`;
      }
    }

    let messageText = `[${who} mandó un archivo: ${saved.originalName} (${typeLabel}, ${sizeHuman}). Está guardado en ${saved.localPath}]${contentDescription}`;
    if (caption?.trim()) {
      messageText += `\n[Archivo: ${saved.originalName}] ${caption.trim()}`;
    }

    const { conversationId, requestId, explicitAgentId } = await preloadMessageContext(ctx, userId);
    runBackgroundProcessing(ctx, userId, messageText, conversationId, explicitAgentId, requestId);
  } catch (e) {
    console.error('[Telegram] Unexpected attachment handling error:', e);
    await safeReply(ctx, `No pude guardar el archivo ${originalName}. ¿Podés intentar de nuevo?`);
  }
}

async function handleIncomingPhoto(
  ctx: EnzoContext,
  userId: string,
  fileId: string,
  name: string,
  caption: string | undefined
): Promise<void> {
  const who = ctx.from?.first_name?.trim() || 'Franco';
  const captionTrim = caption?.trim();

  try {
    let telegramSize: number | undefined;
    try {
      const fileMeta = await ctx.telegram.getFile(fileId);
      telegramSize =
        typeof (fileMeta as { file_size?: number }).file_size === 'number'
          ? (fileMeta as { file_size: number }).file_size
          : undefined;
    } catch (e) {
      console.warn('[Telegram] getFile failed:', e);
    }
    if (telegramSize !== undefined && telegramSize > MAX_INCOMING_FILE_BYTES) {
      await safeReply(ctx, `No pude procesar la imagen. ¿Podés intentar de nuevo?`);
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await downloadTelegramFileBuffer(ctx, fileId);
    } catch (e) {
      console.error('[Telegram] Photo download failed:', e);
      await safeReply(ctx, `No pude descargar la imagen. ¿Podés intentar de nuevo?`);
      return;
    }

    if (buffer.length > MAX_INCOMING_FILE_BYTES) {
      await safeReply(ctx, `No pude procesar la imagen. ¿Podés intentar de nuevo?`);
      return;
    }

    let savedOriginalName = name;
    let savedPath: string | undefined;
    const fileHandler = ctx.fileHandler;
    if (fileHandler) {
      try {
        const saved = await fileHandler.save(buffer, name, 'image/jpeg');
        savedOriginalName = saved.originalName;
        savedPath = saved.localPath;
      } catch (e) {
        console.error('[Telegram] fileHandler.save failed for photo:', e);
        await safeReply(ctx, `No pude guardar la imagen. ¿Podés intentar de nuevo?`);
        return;
      }
    }

    const visionPrompt = captionTrim
      ? `Analizá esta imagen y dime: ${captionTrim}`
      : undefined;

    const visionService = ctx.visionService;
    const visionResult = visionService
      ? await visionService.analyze(buffer, 'image/jpeg', visionPrompt)
      : { success: false as const, canRetry: true, error: 'Local vision service not configured' };

    const { conversationId, requestId, explicitAgentId } = await preloadMessageContext(ctx, userId);

    if (visionResult.success && visionResult.description) {
      let messageText = `[${who} mandó una imagen: ${savedOriginalName}]`;
      if (savedPath) {
        messageText += `\nEstá guardado en ${savedPath}`;
      }
      messageText += `\n\nContenido de la imagen: ${visionResult.description}`;
      if (captionTrim) {
        messageText += `\n\n[Caption] ${captionTrim}`;
      }
      runBackgroundProcessing(ctx, userId, messageText, conversationId, explicitAgentId, requestId);
      return;
    }

    // Any outcome other than "Ollama produced a non-empty description" still has raw image bytes —
    // forward imageContext so the orchestrator can delegate to a vision-capable catalog agent.
    const pathLine = savedPath ? `Archivo: ${savedOriginalName} en ${savedPath}.` : `Archivo: ${savedOriginalName}.`;
    const ollamaHint =
      visionResult.success && !visionResult.description?.trim()
        ? '\n[Nota interna: Ollama devolvió descripción vacía — los píxeles van en imageContext.]'
        : !visionResult.success
          ? `\n[Nota interna: pre-análisis local falló — ${visionResult.error ?? 'sin detalle'}. Los píxeles van en imageContext.]`
          : '';

    let delegateMessage = `${who} envió una imagen.${ollamaHint}

El asistente principal no debe inventar contenido visual sin delegar. Elegí en THINK un agente del catálogo que pueda analizar imágenes (preset del usuario o vision_agent) y delegá con una tarea concreta.

Tarea sugerida: Describí en detalle el contenido de la imagen. Si hay código, texto o mensajes de error, transcribilos exactamente. Si hay un diagrama o gráfico, describí su estructura y contenido.`;
    if (captionTrim) {
      delegateMessage += `\n\nInstrucción del usuario (caption): ${captionTrim}`;
    }
    delegateMessage += `\n\n${pathLine}`;

    if (!visionResult.success && visionResult.canRetry) {
      await safeReply(ctx, '🔍 Analizando la imagen con un agente especializado...');
    }

    runBackgroundProcessing(ctx, userId, delegateMessage, conversationId, explicitAgentId, requestId, undefined, {
      base64: buffer.toString('base64'),
      mimeType: 'image/jpeg',
    });
  } catch (e) {
    console.error('[Telegram] Unexpected photo handling error:', e);
    await safeReply(ctx, 'No pude procesar la imagen. ¿Podés intentar de nuevo?');
  }
}

export function registerMessageHandler(bot: Telegraf<EnzoContext>): void {
  bot.on('text', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const messageText = ctx.message?.text || '';
    const canContinue = await allowAndPersistChat(ctx, userId);
    if (!canContinue) return;

    if (await tryHandleAgentCommandText(ctx, messageText)) {
      return;
    }

    const entities = ctx.message.entities;
    const firstEntity = entities?.[0];
    if (firstEntity?.type === 'bot_command' && firstEntity.offset === 0) {
      await ctx.reply('Comando no reconocido. Usa /help para ver la lista.');
      return;
    }

    const { conversationId, requestId, explicitAgentId } = await preloadMessageContext(ctx, userId);
    runBackgroundProcessing(ctx, userId, messageText, conversationId, explicitAgentId, requestId);

    // Handler returns immediately - Telegraf doesn't timeout
  });

  bot.on('document', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const canContinue = await allowAndPersistChat(ctx, userId);
    if (!canContinue) return;

    const doc = ctx.message?.document;
    if (!doc?.file_id) return;
    const name = doc.file_name?.trim() || `document_${doc.file_id.slice(-12)}`;
    const mime = doc.mime_type || 'application/octet-stream';
    await handleIncomingAttachment(ctx, userId, doc.file_id, name, mime, ctx.message?.caption);
  });

  bot.on('photo', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const canContinue = await allowAndPersistChat(ctx, userId);
    if (!canContinue) return;

    const photos = ctx.message?.photo;
    if (!photos?.length) return;
    const best = photos[photos.length - 1];
    if (!best?.file_id) return;
    const name = `photo_${best.file_id.slice(-16)}.jpg`;
    await handleIncomingPhoto(ctx, userId, best.file_id, name, ctx.message?.caption);
  });

  bot.on('video', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const canContinue = await allowAndPersistChat(ctx, userId);
    if (!canContinue) return;

    const video = ctx.message?.video;
    if (!video?.file_id) return;
    const name = video.file_name?.trim() || `video_${video.file_id.slice(-12)}.mp4`;
    const mime = video.mime_type || 'video/mp4';
    await handleIncomingAttachment(ctx, userId, video.file_id, name, mime, ctx.message?.caption);
  });

  bot.on('voice', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const canContinue = await allowAndPersistChat(ctx, userId);
    if (!canContinue) return;

    const transcriptionService = ctx.transcriptionService;
    if (!transcriptionService) {
      console.warn('[Telegram] transcriptionService is not configured.');
      await safeReply(ctx, 'No pude procesar el audio. ¿Podés escribirlo o reenviar el audio?');
      return;
    }

    try {
      const fileId = ctx.message?.voice?.file_id;
      if (!fileId) {
        await safeReply(ctx, 'No pude procesar el audio. ¿Podés escribirlo o reenviar el audio?');
        return;
      }

      let originalBuffer: Buffer;
      try {
        originalBuffer = await downloadTelegramFileBuffer(ctx, fileId);
      } catch (downloadErr) {
        console.error('[Telegram] Failed to download voice file from Telegram (not Whisper):', downloadErr);
        await safeReply(
          ctx,
          'No pude descargar el audio desde los servidores de Telegram (red lenta, firewall o bloqueo saliente a Telegram). Reintentá en un minuto o escribí el mensaje de texto.'
        );
        return;
      }
      const converter = new AudioConverter();
      const convertedBuffer = await converter.oggToWav(originalBuffer);
      const mimeType = convertedBuffer === originalBuffer ? 'audio/ogg' : 'audio/wav';
      const transcription = await transcriptionService.transcribe(convertedBuffer, mimeType);
      if (!transcription.success || !transcription.text) {
        await safeReply(ctx, 'No pude procesar el audio. ¿Podés escribirlo o reenviar el audio?');
        return;
      }

      const { conversationId, requestId, explicitAgentId } = await preloadMessageContext(ctx, userId);
      runBackgroundProcessing(
        ctx,
        userId,
        transcription.text,
        conversationId,
        explicitAgentId,
        requestId,
        buildTranscriptionPrefix(transcription.text)
      );
    } catch (error) {
      console.error('[Telegram] Voice message handling failed (after download):', error);
      await safeReply(ctx, 'No pude procesar el audio. ¿Podés escribirlo o reenviar el audio?');
    }
  });

  bot.on('audio', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const canContinue = await allowAndPersistChat(ctx, userId);
    if (!canContinue) return;

    const audio = ctx.message?.audio;
    if (!audio?.file_id) return;
    const name = audio.file_name?.trim() || `audio_${audio.file_id.slice(-12)}`;
    const mime = audio.mime_type || 'audio/mpeg';
    await handleIncomingAttachment(ctx, userId, audio.file_id, name, mime, ctx.message?.caption);
  });
}
