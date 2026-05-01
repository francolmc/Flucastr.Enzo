import type { LLMProvider } from '../providers/types.js';
import { MemoryService } from './MemoryService.js';
import { parseFirstJsonObject } from '../utils/StructuredJson.js';
import { recordMemoryLesson } from './MemoryMetrics.js';

export type LessonCandidate = {
  situation: string;
  avoid: string;
  prefer: string;
  confidence?: number;
};

export class MemoryLessonExtractor {
  constructor(
    private readonly provider: LLMProvider,
    private readonly memoryService: MemoryService
  ) {}

  /**
   * Persists a compact lesson after repeated algorithm tool failures (opt-in via env).
   */
  async extractAndSaveFromAlgorithmFailure(input: {
    userId: string;
    conversationId: string;
    requestId?: string;
    userMessage: string;
    observeSnippet: string;
    stepsCompressed: string;
  }): Promise<void> {
    try {
      const lesson = await this.extractLesson(input);
      if (!lesson) {
        recordMemoryLesson(false);
        return;
      }
      const confidence =
        typeof lesson.confidence === 'number' && Number.isFinite(lesson.confidence) ? lesson.confidence : 0.65;
      const threshold = Number(process.env.ENZO_MEMORY_LESSON_CONFIDENCE_THRESHOLD ?? 0.5);
      const t = Number.isFinite(threshold) ? Math.min(0.95, Math.max(0, threshold)) : 0.5;
      if (confidence < t) {
        recordMemoryLesson(false);
        return;
      }

      await this.memoryService.saveMemoryLesson({
        userId: input.userId,
        situation: lesson.situation.trim(),
        avoid: lesson.avoid.trim(),
        prefer: lesson.prefer.trim(),
        source: 'tool_failure',
        confidence,
        conversationId: input.conversationId,
        requestId: input.requestId,
      });
      recordMemoryLesson(true);
    } catch (err) {
      console.error('[MemoryLessonExtractor] extractAndSaveFromAlgorithmFailure:', err);
      recordMemoryLesson(false);
    }
  }

  private async extractLesson(input: {
    userId: string;
    userMessage: string;
    observeSnippet: string;
    stepsCompressed: string;
  }): Promise<LessonCandidate | null> {
    const systemPrompt = `You extract ONE short operational lesson from a failed multi-step assistant run involving tool errors.

Respond ONLY with JSON:
{"lesson": null}
or
{"lesson": {"situation": "...", "avoid": "...", "prefer": "...", "confidence": 0.0-1.0}}

Rules:
- Spanish if user message is Spanish; otherwise concise English.
- situation: what the user tried to accomplish (neutral, no blame).
- avoid: concrete pattern that failed or misled (generic, no passwords/paths with secrets).
- prefer: what to try next time (actionable).
- confidence: how sure you are this lesson is useful and not noise.
- If nothing durable to learn, return {"lesson": null}.`;

    const userBlock = `User message:\n${input.userMessage}\n\nLatest observe output (truncated):\n${input.observeSnippet.slice(0, 2000)}\n\nCompressed steps:\n${input.stepsCompressed.slice(0, 6000)}`;

    const response = await this.provider.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userBlock },
      ],
      temperature: 0.2,
      maxTokens: 400,
    });

    const parsed = parseFirstJsonObject<{ lesson?: LessonCandidate | null }>(response.content?.trim() ?? '', {
      tryRepair: true,
    });
    if (!parsed?.value.lesson || typeof parsed.value.lesson !== 'object') {
      return null;
    }
    const l = parsed.value.lesson as LessonCandidate;
    if (!l.situation?.trim() || !l.avoid?.trim() || !l.prefer?.trim()) {
      return null;
    }
    return l;
  }
}
