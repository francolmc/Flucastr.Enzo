import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import { homedir } from 'os';
import type { MemoryService } from '@enzo/core';

interface FileHandler {
  save(buffer: Buffer, originalName: string, mimeType: string): Promise<{
    fileId: string;
    localPath: string;
    sizeBytes: number;
  }>;
}

export function createFilesRouter(
  memoryService: MemoryService,
  fileHandler?: FileHandler,
  uploadDir?: string
): Router {
  const router = Router();
  const uploadsPath = uploadDir || join(homedir(), '.enzo', 'uploads');

  // Ensure upload directory exists
  mkdirSync(uploadsPath, { recursive: true });

  // POST /api/files/upload
  router.post('/api/files/upload', async (req: Request, res: Response) => {
    try {
      if (!req.body || !req.headers['content-type']?.includes('multipart/form-data')) {
        // For now, support base64 upload via JSON
        // Full multipart support would require multer or similar
        res.status(501).json({
          error: 'NotImplemented',
          message: 'Multipart upload not yet implemented. Use base64 via /api/files/upload-base64',
          statusCode: 501,
        });
        return;
      }
    } catch (error) {
      console.error('[POST /api/files/upload] error:', error);
      res.status(500).json({
        error: 'UploadError',
        message: error instanceof Error ? error.message : 'Failed to upload file',
        statusCode: 500,
      });
    }
  });

  // POST /api/files/upload-base64 (temporary until multipart is implemented)
  router.post('/api/files/upload-base64', async (req: Request, res: Response) => {
    try {
      const { fileBase64, filename, mimeType } = req.body;
      
      if (!fileBase64 || !filename) {
        res.status(400).json({
          error: 'BadRequest',
          message: 'fileBase64 and filename are required',
          statusCode: 400,
        });
        return;
      }

      const buffer = Buffer.from(fileBase64, 'base64');
      const fileId = randomUUID();
      const extension = extname(filename);
      const safeFilename = `${fileId}${extension}`;
      const localPath = join(uploadsPath, safeFilename);

      // Save file
      writeFileSync(localPath, buffer);

      // Return result matching SDK types
      res.json({
        fileId,
        localPath,
        sizeBytes: buffer.length,
        mimeType: mimeType || 'application/octet-stream',
      });
    } catch (error) {
      console.error('[POST /api/files/upload-base64] error:', error);
      res.status(500).json({
        error: 'UploadError',
        message: error instanceof Error ? error.message : 'Failed to upload file',
        statusCode: 500,
      });
    }
  });

  return router;
}
