export interface Chunk {
  id: number;
  content: string;
  topic?: string;
}

export interface ChunkResult {
  isLong: boolean;
  chunks: Chunk[];
  original: string;
}

const CONNECTOR_PATTERN = /\b(y también|además|por otro lado|también tengo)\b/gi;
const SINGLE_CONNECTOR_PATTERN = /^(y también|además|por otro lado|también tengo)$/i;
const WORD_PATTERN = /[^\s]+/g;
const MIN_CHUNK_WORDS = 5;
const MAX_CHUNKS = 10;
const LONG_MESSAGE_WORDS = 300;

export class InputChunker {
  shouldChunk(message: string): boolean {
    const normalized = this.normalizeWhitespace(message);
    if (!normalized) return false;

    const words = this.countWords(normalized);
    if (words > LONG_MESSAGE_WORDS) {
      return true;
    }

    const candidates = this.splitByHeuristics(normalized).filter((candidate) => this.countWords(candidate) >= MIN_CHUNK_WORDS);
    return candidates.length >= 3;
  }

  chunk(message: string): ChunkResult {
    const normalized = this.normalizeWhitespace(message);
    if (!normalized) {
      return { isLong: false, chunks: [], original: message };
    }

    if (!this.shouldChunk(normalized)) {
      return {
        isLong: false,
        chunks: [{ id: 1, content: normalized }],
        original: message,
      };
    }

    const pieces = this.splitByHeuristics(normalized)
      .map((piece) => piece.trim())
      .filter((piece) => this.countWords(piece) >= MIN_CHUNK_WORDS)
      .slice(0, MAX_CHUNKS)
      .map((content, index) => ({ id: index + 1, content }));

    return {
      isLong: pieces.length > 1,
      chunks: pieces,
      original: message,
    };
  }

  private splitByHeuristics(message: string): string[] {
    const byParagraphs = message
      .split(/\n\s*\n+/)
      .map((part) => part.trim())
      .filter(Boolean);

    const parts: string[] = [];
    for (const paragraph of byParagraphs) {
      parts.push(...this.splitByConnectors(paragraph));
    }

    const sentences: string[] = [];
    for (const part of parts) {
      sentences.push(...this.splitBySentenceRule(part));
    }

    return this.mergeShortNeighbors(sentences);
  }

  private splitByConnectors(text: string): string[] {
    const segments = text.split(CONNECTOR_PATTERN);
    const out: string[] = [];
    let buffer = '';

    for (const segment of segments) {
      const trimmed = segment.trim();
      if (!trimmed) continue;
      if (SINGLE_CONNECTOR_PATTERN.test(trimmed)) {
        if (buffer.trim()) out.push(buffer.trim());
        buffer = trimmed;
      } else {
        buffer = buffer ? `${buffer} ${trimmed}` : trimmed;
      }
    }

    if (buffer.trim()) out.push(buffer.trim());
    return out;
  }

  private splitBySentenceRule(text: string): string[] {
    const rawSentences = text
      .split(/\. +/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (rawSentences.length <= 1) {
      return rawSentences;
    }

    const chunks: string[] = [];
    let current = rawSentences[0] || '';

    for (let i = 1; i < rawSentences.length; i += 1) {
      const previousWords = this.countWords(rawSentences[i - 1] || '');
      const nextSentence = rawSentences[i] || '';
      if (previousWords > 8) {
        chunks.push(current.trim());
        current = nextSentence;
      } else {
        current = `${current}. ${nextSentence}`;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }
    return chunks;
  }

  private mergeShortNeighbors(chunks: string[]): string[] {
    const merged: string[] = [];
    for (const chunk of chunks) {
      if (this.countWords(chunk) < MIN_CHUNK_WORDS && merged.length > 0) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${chunk}`.trim();
      } else {
        merged.push(chunk.trim());
      }
    }
    return merged;
  }

  private countWords(text: string): number {
    const matches = text.match(WORD_PATTERN);
    return matches ? matches.length : 0;
  }

  private normalizeWhitespace(message: string): string {
    return (message || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }
}
