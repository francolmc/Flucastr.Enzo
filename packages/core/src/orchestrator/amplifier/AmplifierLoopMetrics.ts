import type { StageMetrics } from '../types.js';

export function initStageMetrics(): StageMetrics {
  return {
    think: { count: 0, errorCount: 0, totalDurationMs: 0, maxDurationMs: 0 },
    act: { count: 0, errorCount: 0, totalDurationMs: 0, maxDurationMs: 0 },
    observe: { count: 0, errorCount: 0, totalDurationMs: 0, maxDurationMs: 0 },
    synthesize: { count: 0, errorCount: 0, totalDurationMs: 0, maxDurationMs: 0 },
  };
}

export function recordStageMetric(
  stageMetrics: StageMetrics,
  stage: keyof StageMetrics,
  durationMs: number,
  ok: boolean
): void {
  const snapshot = stageMetrics[stage];
  snapshot.count += 1;
  snapshot.totalDurationMs += durationMs;
  snapshot.maxDurationMs = Math.max(snapshot.maxDurationMs, durationMs);
  if (!ok) snapshot.errorCount += 1;
}
