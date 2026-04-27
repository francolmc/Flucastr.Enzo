/**
 * Canonical memory keys accepted by POST /api/memory — keep aligned with
 * packages/core/src/memory/MemoryKeys.ts (MEMORY_KEYS).
 */
export const CANONICAL_MEMORY_KEYS = [
  'name',
  'city',
  'profession',
  'projects',
  'preferences',
  'routines',
  'family',
  'other',
] as const;

export type CanonicalMemoryKey = (typeof CANONICAL_MEMORY_KEYS)[number];
