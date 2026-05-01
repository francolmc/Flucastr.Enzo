import type { Memory, MemoryLesson } from './types.js';

const WORD_RE = /\p{L}[\p{L}\p{N}]*/gu;

function tokenFreq(text: string): Map<string, number> {
  const m = text.toLowerCase().match(WORD_RE);
  const bag = new Map<string, number>();
  if (!m) {
    return bag;
  }
  for (const w of m) {
    if (w.length < 2) {
      continue;
    }
    bag.set(w, (bag.get(w) ?? 0) + 1);
  }
  return bag;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) {
    na += v * v;
  }
  for (const v of b.values()) {
    nb += v * v;
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const [k, va] of smaller) {
    const vb = larger.get(k);
    if (vb !== undefined) {
      dot += va * vb;
    }
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Lexical recall (bag-of-words cosine). Zero extra dependencies; optional upgrade path to embeddings.
 */
export function rankMemoriesByLexicalSimilarity(
  query: string,
  memories: Memory[],
  topK: number
): Memory[] {
  if (topK <= 0 || memories.length <= topK) {
    return memories;
  }
  const qBag = tokenFreq(query);
  const scored = memories.map((m) => {
    const doc = `${m.key} ${m.value}`;
    const score = cosineSimilarity(qBag, tokenFreq(doc));
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.m);
}

export function parseMemoryRecallTopK(): number {
  const raw = process.env.ENZO_MEMORY_RECALL_TOP_K ?? '0';
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

/** Text blob used to score a lesson against the current user message (lexical cosine). */
export function lessonRankingDocument(lesson: MemoryLesson): string {
  return `${lesson.situation} ${lesson.avoid} ${lesson.prefer} ${lesson.source}`;
}

/**
 * Rank lessons by bag-of-words overlap with `query` (same family as profile memory recall).
 */
export function rankLessonsByLexicalSimilarity(
  query: string,
  lessons: MemoryLesson[],
  topK: number
): MemoryLesson[] {
  if (topK <= 0 || lessons.length <= topK) {
    return lessons;
  }
  const qBag = tokenFreq(query);
  const scored = lessons.map((l) => ({
    l,
    score: cosineSimilarity(qBag, tokenFreq(lessonRankingDocument(l))),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.l);
}

/** If 0: inject up to ENZO_LESSONS_MAX_IN_PROMPT lessons, newest first (no ranking). If > 0: pin N recent + top‑K ranked vs message. */
export function parseLessonsRecallTopK(): number {
  const raw = process.env.ENZO_LESSONS_RECALL_TOP_K ?? '0';
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

/** Recent lessons always included before ranked retrieval (when ENZO_LESSONS_RECALL_TOP_K > 0). */
export function parseLessonsAlwaysPin(): number {
  const raw = process.env.ENZO_LESSONS_ALWAYS_PIN ?? '2';
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return 2;
  }
  return Math.min(20, Math.floor(n));
}

/** Cap on lines injected into the continuity block after pin+rank. */
export function parseLessonsMaxInPrompt(): number {
  const raw = process.env.ENZO_LESSONS_MAX_IN_PROMPT ?? '20';
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return 20;
  }
  return Math.min(50, Math.floor(n));
}

/** How many active lessons to load from DB before ranking (larger pool → better recall). */
export function parseLessonsPoolMax(): number {
  const raw = process.env.ENZO_LESSONS_POOL_MAX ?? '40';
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return 40;
  }
  return Math.min(100, Math.floor(n));
}

/**
 * Picks lessons for this turn: optionally pin most recent + lexical top‑k from the rest vs `userMessage`.
 */
export function selectLessonsForUserMessage(
  lessons: MemoryLesson[],
  userMessage: string | undefined
): MemoryLesson[] {
  if (lessons.length === 0) {
    return [];
  }
  const sorted = [...lessons].sort((a, b) => b.updatedAt - a.updatedAt);
  const maxTotal = parseLessonsMaxInPrompt();
  const rankK = parseLessonsRecallTopK();
  const q = (userMessage ?? '').trim();

  if (rankK <= 0 || q.length === 0) {
    return sorted.slice(0, maxTotal);
  }

  const pin = parseLessonsAlwaysPin();
  const pinned = sorted.slice(0, Math.min(pin, sorted.length));
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const rest = sorted.filter((l) => !pinnedIds.has(l.id));
  const rankedSlice = rankLessonsByLexicalSimilarity(q, rest, rankK);

  const out: MemoryLesson[] = [];
  for (const p of pinned) {
    out.push(p);
    if (out.length >= maxTotal) {
      return out;
    }
  }
  for (const r of rankedSlice) {
    if (pinnedIds.has(r.id)) {
      continue;
    }
    out.push(r);
    if (out.length >= maxTotal) {
      break;
    }
  }
  return out;
}
