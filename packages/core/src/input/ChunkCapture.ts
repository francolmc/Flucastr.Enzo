import type { ChunkResult } from './InputChunker.js';

function summarizeChunk(content: string, maxChars = 70): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars).trimEnd()}...`;
}

export function buildChunkCaptureConfirmation(chunkResult: ChunkResult): string {
  const validChunks = chunkResult.chunks.filter((chunk) => chunk.content.trim().length > 0);
  const capturedList = validChunks.map((chunk) => summarizeChunk(chunk.content)).join(' | ');
  return `Capturé ${validChunks.length} cosas: ${capturedList}. ¿Querés que priorice alguna?`;
}

export function getMemoryExtractionMessages(originalMessage: string, chunkResult: ChunkResult): string[] {
  if (chunkResult.isLong && chunkResult.chunks.length > 0) {
    return chunkResult.chunks.map((chunk) => chunk.content);
  }
  return [originalMessage];
}
