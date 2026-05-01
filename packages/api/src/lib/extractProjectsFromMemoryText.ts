export interface MemoryRowForProjects {
  key: string;
  value: string;
  updatedAt: number;
}

export interface ExtractedProject {
  name: string;
  lastActivity: Date;
  pendingItems: string[];
}

const MEMORY_KEY_PROJECTS = 'projects';
const MEMORY_KEY_OTHER = 'other';

/** Legacy fixed names for existing stored memories (do not extend with new product names). */
const PROJECT_PATTERNS: Array<{ name: string; test: (s: string) => boolean }> = [
  { name: 'Dash', test: (s) => /\bdash\b/i.test(s) },
  { name: 'Don Financio', test: (s) => /\bdon\s+financio\b/i.test(s) },
  { name: 'Andes', test: (s) => /\bandes\b/i.test(s) },
  { name: 'Enzo', test: (s) => /\benzo\b/i.test(s) },
  { name: 'consultoría', test: (s) => /\bconsultor[ií]a\b/i.test(s) },
];

const PROJECT_LABEL_LINE =
  /^\s*[-*•]?\s*(?:#{1,3}\s*)?(?:\*{0,2}\s*)?(?:Nombre\s+del\s+proyecto|Project\s+name)(?:\s*\*{0,2})?\s*[:\u2014\-–]\s*(.+)$/i;

const OTHER_PROJECT_SCOPE = /\bproyectos?\b\s*[:\u2014\-–]\s*\S+/i;

const MAX_TITLE_CHARS = 80;

function normalizeMergeKey(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripInlineMarkdown(s: string): string {
  return s.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1').trim();
}

function lineLooksPending(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) {
    return false;
  }
  return (
    /^\s*[-*•]\s+/.test(line) ||
    /\bpendiente\b/i.test(t) ||
    /\btodo\b/i.test(t) ||
    /\btarea\b/i.test(t)
  );
}

function extractPendingSnippets(multilineValue: string): string[] {
  const out: string[] = [];
  for (const line of multilineValue.split(/\r?\n/)) {
    if (!lineLooksPending(line)) continue;
    const snippet = line.trim().slice(0, 200);
    if (snippet.length > 0) out.push(snippet);
  }
  return out;
}

/** Title line: strip list/bold noise, cap length without breaking mid-surrogate. */
function firstLineFallbackTitle(multilineValue: string): string {
  const trimmed = multilineValue.trim();
  const firstBreak = trimmed.split(/\r?\n/).find((l) => l.trim().length > 0) ?? trimmed;
  const stripped = stripInlineMarkdown(firstBreak.replace(/^[-*#]+\s*/, '').trim());
  const base = stripped.length > 0 ? stripped : trimmed;
  if (base.length <= MAX_TITLE_CHARS) {
    return base;
  }
  return `${base.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
}

/**
 * Parses structural labels ("Nombre del proyecto", "Project name") — not arbitrary product lexicon.
 */
function extractProjectDisplayName(multilineValue: string): string {
  const lines = multilineValue.split(/\r?\n/);

  const scanLine = (line: string): string | null => {
    const m = line.match(PROJECT_LABEL_LINE);
    const raw = m?.[1];
    if (!raw?.trim()) return null;
    const cleaned = stripInlineMarkdown(raw.trim());
    const short =
      cleaned.length <= MAX_TITLE_CHARS ? cleaned : `${cleaned.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
    return short.length >= 2 ? short : null;
  };

  for (const line of lines) {
    const fromLabel = scanLine(line);
    if (fromLabel) return fromLabel;
  }

  return firstLineFallbackTitle(multilineValue);
}

function maxUpdatedAtForPattern(rows: MemoryRowForProjects[], projectName: string): number {
  const pattern = PROJECT_PATTERNS.find((p) => p.name === projectName);
  if (!pattern) {
    return 0;
  }
  let max = 0;
  for (const row of rows) {
    if (pattern.test(row.value)) {
      max = Math.max(max, row.updatedAt);
    }
  }
  return max;
}

type ProjectAccumulator = Map<string, { displayName: string; lastActivity: number; pending: Set<string> }>;

function accumulate(
  map: ProjectAccumulator,
  displayName: string,
  updatedAt: number,
  pending: Iterable<string>
): void {
  const mergeKey = normalizeMergeKey(displayName);
  if (!mergeKey) return;

  let entry = map.get(mergeKey);
  if (!entry) {
    entry = { displayName: displayName.trim(), lastActivity: 0, pending: new Set() };
    map.set(mergeKey, entry);
  }
  entry.lastActivity = Math.max(entry.lastActivity, updatedAt);
  for (const p of pending) {
    entry.pending.add(p);
  }
}

export function extractProjectsFromMemoryText(rows: MemoryRowForProjects[]): ExtractedProject[] {
  if (rows.length === 0) {
    return [];
  }

  const merged: ProjectAccumulator = new Map();

  // 1. Explicit memories under key `projects`
  for (const row of rows) {
    if (row.key !== MEMORY_KEY_PROJECTS) continue;
    const name = extractProjectDisplayName(row.value);
    if (!name.trim()) continue;
    const pendingLines = extractPendingSnippets(row.value);
    accumulate(merged, name, row.updatedAt, pendingLines);
  }

  // 2. Guarded `other` rows only when they look like scoped project descriptions
  for (const row of rows) {
    if (row.key !== MEMORY_KEY_OTHER) continue;
    if (!OTHER_PROJECT_SCOPE.test(row.value)) continue;
    const name = extractProjectDisplayName(row.value);
    if (!name.trim()) continue;
    const pendingLines = extractPendingSnippets(row.value);
    accumulate(merged, name, row.updatedAt, pendingLines);
  }

  // 3. Legacy lexical projects (combined scan + pending attribution)
  for (const row of rows) {
    for (const { name, test } of PROJECT_PATTERNS) {
      if (test(row.value)) {
        accumulate(merged, name, row.updatedAt, []);
      }
    }
  }

  const sortedRows = [...rows].sort((a, b) => a.updatedAt - b.updatedAt);
  const combined = sortedRows.map((r) => r.value).join('\n\n');
  let lastLegacyProject: string | null = null;

  for (const line of combined.split(/\r?\n/)) {
    let lineProject: string | null = null;
    for (const { name, test } of PROJECT_PATTERNS) {
      if (test(line)) {
        lineProject = name;
      }
    }
    if (lineProject) {
      lastLegacyProject = lineProject;
    }
    if (lineLooksPending(line) && lastLegacyProject) {
      const snippet = line.trim().slice(0, 200);
      if (snippet.length === 0) {
        continue;
      }
      const maxAt = maxUpdatedAtForPattern(rows, lastLegacyProject);
      const existing = merged.get(normalizeMergeKey(lastLegacyProject));
      const pend = existing?.pending ?? new Set<string>();
      pend.add(snippet);
      accumulate(merged, lastLegacyProject, maxAt, pend);
    }
  }

  if (merged.size === 0) {
    return [];
  }

  return Array.from(merged.values())
    .map(({ displayName, lastActivity, pending }) => ({
      name: displayName,
      lastActivity: new Date(lastActivity),
      pendingItems: Array.from(pending),
    }))
    .filter((p) => p.lastActivity.getTime() > 0 || p.pendingItems.length > 0)
    .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
}
