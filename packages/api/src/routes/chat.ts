import { Router, Request, Response } from 'express';
import {
  Orchestrator,
  Step,
  MemoryService,
  ConversationRecord,
  InputChunker,
  buildChunkCaptureConfirmation,
  getMemoryExtractionMessages,
  type ChunkResult,
  type ConfigService,
} from '@enzo/core';
import { validateChatRequest } from '../middleware/validate.js';
import { randomUUID } from 'crypto';

// Type for SSE stream events
interface StreamEvent {
  type: 'start' | 'progress' | 'chunk' | 'done' | 'error';
  data: Record<string, any>;
}

function encodeSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// Simple semaphore to prevent concurrent Ollama requests
let isProcessing = false;
const requestQueue: Array<() => void> = [];

async function withSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  // If already processing, wait in queue
  if (isProcessing) {
    console.log('[Chat] Request queued, waiting for current request to finish...');
    await new Promise<void>((resolve) => requestQueue.push(resolve));
  }

  isProcessing = true;
  try {
    return await fn();
  } finally {
    isProcessing = false;
    // Process next in queue
    const next = requestQueue.shift();
    if (next) next();
  }
}

function resolveUserLanguageFromRequest(req: Request): string {
  const fromBody = req.body?.lang;
  if (typeof fromBody === 'string' && fromBody.trim().length > 0) {
    return fromBody.trim().split(/[-_]/)[0]!.toLowerCase();
  }
  const accept = req.headers['accept-language'];
  if (typeof accept === 'string' && accept.trim().length > 0) {
    return accept.split(',')[0]!.split('-')[0]!.toLowerCase();
  }
  return 'es';
}

function buildRuntimeHintsFromConfig(configService?: ConfigService) {
  const profile = configService?.getUserProfile();
  const systemTz = configService?.getSystemConfig()?.tz?.trim();
  const lang = process.env.LANG || '';
  const timeLocale =
    profile?.locale?.trim() ||
    (lang.toLowerCase().includes('en_us') || lang.toLowerCase().startsWith('en')
      ? 'en-US'
      : 'es-CL');
  const hints: {
    homeDir?: string;
    osLabel?: string;
    timeLocale?: string;
    timeZone?: string;
  } = {
    homeDir: process.env.HOME,
    osLabel: process.platform === 'darwin' ? 'macOS' : process.platform,
    timeLocale,
  };
  const tz = profile?.timezone?.trim() || systemTz;
  if (tz) {
    hints.timeZone = tz;
  }
  return hints;
}

const inputChunker = new InputChunker();

function extractMemoryInBackground(
  orchestrator: Orchestrator,
  userId: string,
  userMessage: string,
  assistantResponse: string,
  chunkResult?: ChunkResult
): void {
  const memoryExtractor = orchestrator.getMemoryExtractor();
  const extraction = async () => {
    const messages = chunkResult
      ? getMemoryExtractionMessages(userMessage, chunkResult)
      : [userMessage];
    await Promise.all(
      messages.map((chunkedMessage) => memoryExtractor.extractAndSave(userId, chunkedMessage, assistantResponse))
    );
  };

  extraction().catch((error) => {
    console.error('[Chat] Memory extraction error:', error);
  });
}

export function createChatRouter(
  orchestrator: Orchestrator,
  memoryService: MemoryService,
  configService?: ConfigService
): Router {
  const router = Router();

  router.post('/api/chat', validateChatRequest, async (req: Request, res: Response) => {
    try {
      const { message, conversationId, userId, agentId } = req.body;
      const chunkResult = inputChunker.chunk(message);
      const userLanguage = resolveUserLanguageFromRequest(req);
      const requestId = req.header('x-request-id') || randomUUID();

      let finalConversationId = conversationId;
      if (!finalConversationId) {
        finalConversationId = await memoryService.createConversation(userId);
      }

      const response = await withSemaphore(async () => {
        return await orchestrator.process({
          message,
          originalMessage: message, // Preserve original message from user
          conversationId: finalConversationId,
          userId,
          source: 'web',
          agentId,
          requestId,
          userLanguage,
          runtimeHints: buildRuntimeHintsFromConfig(configService),
          toolExecutionContext: { source: 'web', conversationId: finalConversationId },
        });
      });

      const responseContent = chunkResult.isLong ? buildChunkCaptureConfirmation(chunkResult) : response.content;
      extractMemoryInBackground(orchestrator, userId, message, response.content, chunkResult);

      res.json({
        content: responseContent,
        conversationId: finalConversationId,
        complexityUsed: response.complexityUsed,
        providerUsed: response.providerUsed,
        modelUsed: response.modelUsed,
        injectedSkills: response.injectedSkills,
        durationMs: response.durationMs,
        estimatedCostUsd: response.usage?.estimatedCostUsd ?? 0,
        requestId: response.requestId || requestId,
      });
    } catch (error) {
      console.error('[POST /api/chat] error:', error);
      res.status(500).json({
        error: 'ProcessingError',
        message: error instanceof Error ? error.message : 'Failed to process message',
        statusCode: 500,
      });
    }
  });

  // Streaming endpoint (SSE)
  router.post('/api/chat/stream', validateChatRequest, async (req: Request, res: Response) => {
    try {
      const { message, conversationId, userId, agentId } = req.body;
      const chunkResult = inputChunker.chunk(message);
      const userLanguage = resolveUserLanguageFromRequest(req);
      const requestId = req.header('x-request-id') || randomUUID();
      const startTime = Date.now();

      let finalConversationId = conversationId;
      if (!finalConversationId) {
        finalConversationId = await memoryService.createConversation(userId);
      }

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
      res.flushHeaders(); // Send headers immediately

      // Send start event with conversation info
      res.write(
        encodeSSE({
          type: 'start',
          data: {
            conversationId: finalConversationId,
            requestId,
            message: 'Processing your message...',
          },
        })
      );
      if ((res as any).flush) (res as any).flush(); // Flush immediately

      let contentBuffer = '';
      let progressCount = 0;

      // Call orchestrator with progress callback (wrapped in semaphore)
      const response = await withSemaphore(async () => {
        return await orchestrator.process({
          message,
          originalMessage: message,
          conversationId: finalConversationId,
          userId,
          source: 'web',
          agentId,
          requestId,
          userLanguage,
          runtimeHints: buildRuntimeHintsFromConfig(configService),
          toolExecutionContext: { source: 'web', conversationId: finalConversationId },
          onProgress: (step: Step) => {
            progressCount++;
            // Send progress event every step
            res.write(
              encodeSSE({
                type: 'progress',
                data: {
                  step: step.type,
                  substep: step.target || '',
                  progressNumber: progressCount,
                  requestId: step.requestId || requestId,
                },
              })
            );
            if ((res as any).flush) (res as any).flush(); // Flush immediately
          },
        });
      });

      const responseContent = chunkResult.isLong ? buildChunkCaptureConfirmation(chunkResult) : response.content;
      extractMemoryInBackground(orchestrator, userId, message, response.content, chunkResult);

      contentBuffer = responseContent;

      // Send content in chunks (simulating streaming if not natively supported)
      const chunkSize = 50;
      for (let i = 0; i < contentBuffer.length; i += chunkSize) {
        res.write(
          encodeSSE({
            type: 'chunk',
            data: {
              content: contentBuffer.slice(i, i + chunkSize),
            },
          })
        );
      }

      const durationMs = Date.now() - startTime;

      // Send done event with metadata
      res.write(
        encodeSSE({
          type: 'done',
          data: {
            content: contentBuffer,
            conversationId: finalConversationId,
            complexityUsed: response.complexityUsed,
            providerUsed: response.providerUsed,
            modelUsed: response.modelUsed,
            injectedSkills: response.injectedSkills,
            durationMs,
            usage: response.usage,
            requestId: response.requestId || requestId,
          },
        })
      );

      // Close stream
      res.end();
    } catch (error) {
      console.error('[POST /api/chat/stream] error:', error);
      res.write(
        encodeSSE({
          type: 'error',
          data: {
            error: 'ProcessingError',
            message: error instanceof Error ? error.message : 'Failed to process message',
            statusCode: 500,
          },
        })
      );
      res.end();
    }
  });

  router.get('/api/chat/:conversationId/history', async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;

      const messages = await memoryService.getHistoryWithMetadata(conversationId);

      res.json({
        messages: messages || [],
      });
    } catch (error) {
      console.error('[GET /api/chat/:conversationId/history] error:', error);
      res.status(500).json({
        error: 'RetrievalError',
        message: error instanceof Error ? error.message : 'Failed to retrieve history',
        statusCode: 500,
      });
    }
  });

  router.get('/api/chat/conversations/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      const conversations = await memoryService.getConversations(userId, 20) as ConversationRecord[];

      res.json({
        conversations: conversations.map((conv: ConversationRecord) => ({
          id: conv.id,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        })),
      });
    } catch (error) {
      console.error('[GET /api/chat/conversations/:userId] error:', error);
      res.status(500).json({
        error: 'RetrievalError',
        message: error instanceof Error ? error.message : 'Failed to retrieve conversations',
        statusCode: 500,
      });
    }
  });

  router.delete('/api/chat/:conversationId', async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;

      await memoryService.deleteConversation(conversationId);

      res.json({
        success: true,
      });
    } catch (error) {
      console.error('[DELETE /api/chat/:conversationId] error:', error);
      res.status(500).json({
        error: 'DeletionError',
        message: error instanceof Error ? error.message : 'Failed to delete conversation',
        statusCode: 500,
      });
    }
  });

  return router;
}
