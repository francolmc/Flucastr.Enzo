/**
 * Lightweight counters for memory pipeline observability (CORE_SLOS alignment).
 * Not a metrics backend — log or expose via /health snapshot.
 */

export type MemoryMetricSnapshot = {
  memory_extract_total: number;
  memory_extract_failed_total: number;
  memory_recall_turns_ranked_total: number;
  memory_recall_turns_full_total: number;
  memory_recall_facts_returned_bucket: number;
  memory_lesson_saved_total: number;
  memory_lesson_rejected_total: number;
};

const state = {
  memory_extract_total: 0,
  memory_extract_failed_total: 0,
  memory_recall_turns_ranked_total: 0,
  memory_recall_turns_full_total: 0,
  memory_recall_facts_returned_bucket: 0,
  memory_lesson_saved_total: 0,
  memory_lesson_rejected_total: 0,
};

export function recordMemoryExtract(success: boolean): void {
  state.memory_extract_total += 1;
  if (!success) {
    state.memory_extract_failed_total += 1;
  }
}

export function recordMemoryRecallTurn(opts: {
  mode: 'ranked' | 'full';
  /** Sum of memories returned across turns this process (additive for budget visibility). */
  returnedCountDelta: number;
}): void {
  if (opts.mode === 'ranked') {
    state.memory_recall_turns_ranked_total += 1;
  } else {
    state.memory_recall_turns_full_total += 1;
  }
  state.memory_recall_facts_returned_bucket += Math.max(0, opts.returnedCountDelta);
}

export function recordMemoryLesson(saved: boolean): void {
  if (saved) {
    state.memory_lesson_saved_total += 1;
  } else {
    state.memory_lesson_rejected_total += 1;
  }
}

export function getMemoryMetricsSnapshot(): MemoryMetricSnapshot {
  return { ...state };
}

export function resetMemoryMetricsForTests(): void {
  state.memory_extract_total = 0;
  state.memory_extract_failed_total = 0;
  state.memory_recall_turns_ranked_total = 0;
  state.memory_recall_turns_full_total = 0;
  state.memory_recall_facts_returned_bucket = 0;
  state.memory_lesson_saved_total = 0;
  state.memory_lesson_rejected_total = 0;
}
