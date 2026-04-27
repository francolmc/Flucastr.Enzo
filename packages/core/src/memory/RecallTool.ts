import { ExecutableTool, ToolExecutionContext, ToolResult } from '../tools/types.js';
import { MemoryService } from './MemoryService.js';
import { Memory } from './types.js';

export interface RecallInput {
  query: string;
  project?: string;
  key?: string;
  userId?: string;
}

export interface RecallItem {
  key: string;
  value: string;
  updatedAt: Date;
}

export interface RecallOutput {
  found: boolean;
  items: RecallItem[];
  summary: string;
}

const RECALL_TRIGGERS = [
  'qué tengo pendiente',
  'que tengo pendiente',
  'qué hay de',
  'que hay de',
  'recordás',
  'recordas',
  'qué dijimos de',
  'que dijimos de',
  'qué capturaste',
  'que capturaste',
  'mis tareas',
  'pendientes de',
] as const;

const STOPWORDS = new Set([
  'tengo', 'tienes', 'tiene', 'tenemos', 'tienen',
  'pendiente', 'pendientes',
  'sobre', 'acerca', 'algo',
  'cosa', 'cosas',
  'para', 'desde', 'hasta', 'entre',
  'donde', 'cuando', 'como', 'porque',
  'esto', 'esta', 'estos', 'estas', 'eso', 'esa', 'esos', 'esas',
  'aquel', 'aquella', 'aquellos', 'aquellas',
  'pero', 'aunque', 'mientras',
  'todo', 'todos', 'toda', 'todas',
  'nada', 'algo', 'alguien', 'nadie',
  'mucho', 'mucha', 'muchos', 'muchas',
  'poco', 'poca', 'pocos', 'pocas',
  'estar', 'estaba', 'estaban',
  'haber', 'había', 'habían',
  'hacer', 'hacía', 'hacían',
  'decir', 'dijo', 'dije', 'dijiste',
  'recordar', 'recordás', 'recordas', 'recuerdo', 'recuerda',
  'capturar', 'capturaste', 'capturé', 'capturado',
  'dijimos', 'dijiste',
  'tareas', 'tarea',
  'with', 'this', 'that', 'these', 'those', 'where', 'when', 'what', 'which', 'while',
  'have', 'having', 'about', 'something', 'anything', 'nothing',
  'pending', 'remember', 'remembered', 'captured', 'tasks', 'task',
]);

function foldDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokenize(query: string): string[] {
  const folded = foldDiacritics((query || '').toLowerCase());
  const rawTokens = folded.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of rawTokens) {
    if (token.length <= 3) continue;
    if (STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function scoreMemory(memory: Memory, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const haystack = foldDiacritics(memory.value.toLowerCase());
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      hits += 1;
    }
  }
  return hits;
}

function buildSummary(query: string, items: RecallItem[]): string {
  const trimmedQuery = (query || '').trim();
  if (items.length === 0) {
    return `No encontré nada relacionado con "${trimmedQuery}" en mi memoria.`;
  }

  const lines = items.map((item, idx) => `${idx + 1}) ${item.key}: ${item.value}`);
  const noun = items.length === 1 ? 'item' : 'items';
  return `Encontré ${items.length} ${noun} en memoria sobre "${trimmedQuery}": ${lines.join('; ')}.`;
}

export class RecallTool implements ExecutableTool {
  name = 'recall';
  readonly actionAliases = ['recordar_consulta', 'consultar_memoria'] as const;
  readonly triggers = RECALL_TRIGGERS;
  description =
    'Search the user\'s saved memories using a natural-language query. Use this when the user asks what they have pending, captured, or said before.';
  parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language search query' },
      project: { type: 'string', description: 'Optional project filter (substring match on memory value)' },
      key: { type: 'string', description: 'Optional memory key filter (e.g. "projects", "other")' },
      userId: { type: 'string', description: 'User ID owner of the memories' },
    },
    required: ['query', 'userId'],
  };

  private memoryService: MemoryService;

  constructor(memoryService: MemoryService) {
    this.memoryService = memoryService;
  }

  injectExecutionContext(input: Record<string, unknown>, ctx: ToolExecutionContext): void {
    const uid = ctx.userId;
    if (!uid || typeof uid !== 'string') return;
    const existing = input['userId'];
    if (existing === undefined || existing === null || String(existing).trim() === '') {
      input['userId'] = uid;
    }
  }

  async execute(input: RecallInput): Promise<ToolResult> {
    try {
      const query = typeof input?.query === 'string' ? input.query.trim() : '';
      const userId = typeof input?.userId === 'string' ? input.userId.trim() : '';
      const project = typeof input?.project === 'string' && input.project.trim().length > 0 ? input.project.trim() : undefined;
      const key = typeof input?.key === 'string' && input.key.trim().length > 0 ? input.key.trim() : undefined;

      if (!query) {
        return { success: false, error: 'Query must be a non-empty string' };
      }
      if (!userId) {
        return { success: false, error: 'UserId must be a non-empty string' };
      }

      const memories = await this.memoryService.recall(userId, key);

      const tokens = tokenize(query);
      const projectFolded = project ? foldDiacritics(project.toLowerCase()) : null;
      const hasFilter = !!projectFolded || !!key;

      const scored = memories
        .map((memory) => ({ memory, score: scoreMemory(memory, tokens) }))
        .filter(({ memory, score }) => {
          if (projectFolded) {
            const haystack = foldDiacritics(memory.value.toLowerCase());
            if (!haystack.includes(projectFolded)) return false;
          }
          // When a filter is applied (project or key) and the query has no usable tokens
          // (e.g. only stopwords), keep every filter-matching memory.
          if (hasFilter && tokens.length === 0) return true;
          // With a key filter, also keep score-0 matches under that key.
          if (key) return true;
          return score > 0;
        })
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return b.memory.updatedAt - a.memory.updatedAt;
        })
        .slice(0, 10);

      const items: RecallItem[] = scored.map(({ memory }) => ({
        key: memory.key,
        value: memory.value,
        updatedAt: new Date(memory.updatedAt),
      }));

      const output: RecallOutput = {
        found: items.length > 0,
        items,
        summary: buildSummary(query, items),
      };

      return { success: true, data: output };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  formatToolOutput(data: unknown, _ctx: ToolExecutionContext): string | undefined {
    void _ctx;
    if (data && typeof data === 'object' && 'summary' in (data as Record<string, unknown>)) {
      const summary = (data as { summary?: unknown }).summary;
      if (typeof summary === 'string' && summary.length > 0) {
        return summary;
      }
    }
    return undefined;
  }
}
