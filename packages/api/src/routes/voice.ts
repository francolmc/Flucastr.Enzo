import { Router, Request, Response } from 'express';
import type { Orchestrator, MemoryService } from '@enzo/core';

// Voice service interfaces - will be implemented later
interface TranscriptionService {
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<{ success: boolean; text?: string; error?: string }>;
}

interface TTSService {
  synthesize(text: string, language: string): Promise<{ success: boolean; audioBuffer?: Buffer; error?: string }>;
}

export function createVoiceRouter(
  orchestrator: Orchestrator,
  memoryService: MemoryService,
  transcriptionService?: TranscriptionService,
  ttsService?: TTSService
): Router {
  const router = Router();

  // POST /api/voice/transcribe
  router.post('/api/voice/transcribe', async (req: Request, res: Response) => {
    try {
      if (!transcriptionService) {
        res.status(503).json({
          error: 'ServiceUnavailable',
          message: 'Transcription service not configured',
          statusCode: 503,
        });
        return;
      }

      const { audioBase64, mimeType } = req.body;
      if (!audioBase64) {
        res.status(400).json({
          error: 'BadRequest',
          message: 'audioBase64 is required',
          statusCode: 400,
        });
        return;
      }

      const audioBuffer = Buffer.from(audioBase64, 'base64');
      const result = await transcriptionService.transcribe(audioBuffer, mimeType || 'audio/wav');

      res.json({
        success: result.success,
        text: result.text,
        error: result.error,
      });
    } catch (error) {
      console.error('[POST /api/voice/transcribe] error:', error);
      res.status(500).json({
        error: 'TranscriptionError',
        message: error instanceof Error ? error.message : 'Failed to transcribe audio',
        statusCode: 500,
      });
    }
  });

  // POST /api/voice/synthesize
  router.post('/api/voice/synthesize', async (req: Request, res: Response) => {
    try {
      if (!ttsService) {
        res.status(503).json({
          error: 'ServiceUnavailable',
          message: 'TTS service not configured',
          statusCode: 503,
        });
        return;
      }

      const { text, language } = req.body;
      if (!text) {
        res.status(400).json({
          error: 'BadRequest',
          message: 'text is required',
          statusCode: 400,
        });
        return;
      }

      const result = await ttsService.synthesize(text, language || 'es');

      res.json({
        success: result.success,
        audioBase64: result.audioBuffer ? result.audioBuffer.toString('base64') : undefined,
        error: result.error,
      });
    } catch (error) {
      console.error('[POST /api/voice/synthesize] error:', error);
      res.status(500).json({
        error: 'SynthesisError',
        message: error instanceof Error ? error.message : 'Failed to synthesize speech',
        statusCode: 500,
      });
    }
  });

  return router;
}
