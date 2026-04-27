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

const PROJECT_PATTERNS: Array<{ name: string; test: (s: string) => boolean }> = [
  { name: 'Dash', test: (s) => /\bdash\b/i.test(s) },
  { name: 'Don Financio', test: (s) => /\bdon\s+financio\b/i.test(s) },
  { name: 'Andes', test: (s) => /\bandes\b/i.test(s) },
  { name: 'Enzo', test: (s) => /\benzo\b/i.test(s) },
  { name: 'consultoría', test: (s) => /\bconsultor[ií]a\b/i.test(s) },
];

function lineLooksPending(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) {
    return false;
  }
  return /^\s*[-*•]\s+/.test(line) || /\bpendiente\b/i.test(t) || /\btodo\b/i.test(t) || /\btarea\b/i.test(t);
}

function maxUpdatedAtForProject(rows: MemoryRowForProjects[], projectName: string): number {
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

export function extractProjectsFromMemoryText(rows: MemoryRowForProjects[]): ExtractedProject[] {
  if (rows.length === 0) {
    return [];
  }

  const byProject = new Map<string, { lastActivity: number; pending: Set<string> }>();

  for (const row of rows) {
    for (const { name, test } of PROJECT_PATTERNS) {
      if (test(row.value)) {
        const cur = byProject.get(name) ?? { lastActivity: 0, pending: new Set<string>() };
        cur.lastActivity = Math.max(cur.lastActivity, row.updatedAt);
        byProject.set(name, cur);
      }
    }
  }

  const sorted = [...rows].sort((a, b) => a.updatedAt - b.updatedAt);
  const combined = sorted.map((r) => r.value).join('\n\n');
  let lastProject: string | null = null;

  for (const line of combined.split(/\r?\n/)) {
    let lineProject: string | null = null;
    for (const { name, test } of PROJECT_PATTERNS) {
      if (test(line)) {
        lineProject = name;
      }
    }
    if (lineProject) {
      lastProject = lineProject;
    }
    if (lineLooksPending(line) && lastProject) {
      const snippet = line.trim().slice(0, 200);
      if (snippet.length === 0) {
        continue;
      }
      const entry = byProject.get(lastProject) ?? {
        lastActivity: maxUpdatedAtForProject(rows, lastProject),
        pending: new Set<string>(),
      };
      entry.pending.add(snippet);
      entry.lastActivity = Math.max(entry.lastActivity, maxUpdatedAtForProject(rows, lastProject));
      byProject.set(lastProject, entry);
    }
  }

  if (byProject.size === 0) {
    return [];
  }

  return Array.from(byProject.entries())
    .map(([name, { lastActivity, pending }]) => ({
      name,
      lastActivity: new Date(lastActivity),
      pendingItems: Array.from(pending),
    }))
    .filter((p) => p.lastActivity.getTime() > 0 || p.pendingItems.length > 0)
    .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
}
