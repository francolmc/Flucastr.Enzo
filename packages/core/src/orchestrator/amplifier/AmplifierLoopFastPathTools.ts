import type { Tool } from '../../providers/types.js';
import type { ExecutableTool } from '../../tools/types.js';
import type { AmplifierInput } from '../types.js';
import type { MCPRegistry } from '../../mcp/MCPRegistry.js';
import { ToolCallValidator } from '../ToolCallValidator.js';

export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\' && inStr) {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1).trim();
      }
    }
  }

  return null;
}

function canonicalizeToolNameLower(toolNameLower: string, executableTools: ExecutableTool[]): string {
  const exact = executableTools.find((t) => t.name.toLowerCase() === toolNameLower);
  if (exact) return exact.name.toLowerCase();
  return toolNameLower;
}

/** Tool names whose execution must receive the authenticated Enzo user id from the runtime (never from LLM JSON). */
const SERVER_SCOPED_USER_TOOL_NAMES = new Set(['calendar']);

/**
 * Attach internal fields after validation so the LLM cannot spoof another user's scope.
 */
export function attachToolScopedUserId(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId?: string
): Record<string, unknown> {
  const uid = userId?.trim();
  if (!uid || !SERVER_SCOPED_USER_TOOL_NAMES.has(toolName)) {
    return toolInput;
  }
  return { ...toolInput, __enzoScopedUserId: uid };
}

/** Optional hints so calendar tool output can mirror the user's wall clock (not only UTC). */
export function attachCalendarDisplayClock(
  toolName: string,
  scoped: Record<string, unknown>,
  clock?: { timeZone?: string; timeLocale?: string }
): Record<string, unknown> {
  const tz = clock?.timeZone?.trim();
  if (toolName !== 'calendar' || !tz) {
    return scoped;
  }
  const loc = clock?.timeLocale?.trim() || 'es-CL';
  return { ...scoped, __enzoDisplayTimeZone: tz, __enzoDisplayLocale: loc };
}

/** Shallow copy of tool input with optional host/runtime fields applied before validation and execute. */
export function applyExecutableToolContext(
  toolName: string,
  toolInput: unknown,
  executableTools: ExecutableTool[]
): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof toolInput === 'object' && toolInput !== null && !Array.isArray(toolInput)
      ? { ...(toolInput as Record<string, unknown>) }
      : {};
  void toolName;
  void executableTools;
  return base;
}

const CALENDAR_FIELD_SYNONYMS: Record<string, string> = {
  acción: 'action',
  accion: 'action',
  titulo: 'title',
  título: 'title',
  notas: 'notes',
  inicio_iso: 'start_iso',
  fin_iso: 'end_iso',
  desde_iso: 'from_iso',
  hasta_iso: 'to_iso',
  id_evento: 'event_id',
};

function isCalendarSemanticKey(key: string): boolean {
  const canon = CALENDAR_FIELD_SYNONYMS[key] ?? CALENDAR_FIELD_SYNONYMS[key.toLowerCase()] ?? key;
  return (
    canon === 'action' ||
    canon === 'title' ||
    canon === 'notes' ||
    canon === 'start_iso' ||
    canon === 'end_iso' ||
    canon === 'from_iso' ||
    canon === 'to_iso' ||
    canon === 'event_id'
  );
}

/**
 * LLMs / native tool callers sometimes flatten calendar fields next to the envelope keys
 * (`tool` / `action:"tool"`) instead of nesting under `input`. Merge + ES aliases + infer `action:list`.
 */
export function coerceCalendarFastPathEnvelope(
  envelope: Record<string, unknown>,
  inner: Record<string, unknown>
): Record<string, unknown> {
  const ENVELOPE_SHAPE = new Set(['tool', 'herramienta', 'input', 'entrada']);

  const applySynonyms = (obj: Record<string, unknown>): Record<string, unknown> => {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const nk = CALENDAR_FIELD_SYNONYMS[k] ?? CALENDAR_FIELD_SYNONYMS[k.toLowerCase()] ?? k;
      next[nk] = v;
    }
    return next;
  };

  let merged = applySynonyms({ ...inner });

  for (const [rawKey, rawVal] of Object.entries(envelope)) {
    if (ENVELOPE_SHAPE.has(rawKey)) continue;
    const keyCanon = CALENDAR_FIELD_SYNONYMS[rawKey] ?? CALENDAR_FIELD_SYNONYMS[rawKey.toLowerCase()] ?? rawKey;
    if (keyCanon === 'action') {
      const marker = String(rawVal ?? '').toLowerCase();
      if (marker === 'tool' || marker === 'herramienta') continue;
    }
    if (!isCalendarSemanticKey(rawKey)) continue;
    const slot = keyCanon !== rawKey ? keyCanon : rawKey;
    if (merged[slot] === undefined) merged[slot] = rawVal;
  }

  merged = applySynonyms(merged);

  const actionStr = String(merged.action ?? '').trim().toLowerCase();
  if (!actionStr) {
    if (merged.from_iso && merged.to_iso) {
      merged.action = 'list';
    } else if (merged.start_iso && merged.title) {
      merged.action = 'add';
    } else if (merged.event_id) {
      const hasPatch =
        merged.title !== undefined ||
        merged.start_iso !== undefined ||
        merged.end_iso !== undefined ||
        merged.notes !== undefined;
      merged.action = hasPatch ? 'update' : 'delete';
    }
  }

  return merged;
}

/**
 * Models sometimes emit `{"action":"tool","tool":"gh","input":{"command":"repo list"}}` — treating the shell
 * binary as if it were an Enzo tool id. When `tool` is not registered, merge **generically** into
 * `execute_command` by prefixing the fragment with that token. No per-product synonym lists (repos→repo list, etc.).
 */
export function coerceEnvelopeShellBinaryToExecuteCommand(
  envelopeActionRaw: string,
  rawToolFromEnvelope: string,
  toolInput: Record<string, unknown>,
  executableTools: ExecutableTool[]
): { command: string } | null {
  if (!executableTools.some((t) => t.name === 'execute_command')) return null;

  const act = envelopeActionRaw.trim().toLowerCase();
  if (act !== 'tool' && act !== 'herramienta') return null;

  const lead = rawToolFromEnvelope.trim();
  if (!lead) return null;
  /** Single shell-like token only — avoids coercing arbitrary prose into "commands". */
  if (!/^[\w.-]+$/i.test(lead)) return null;

  const comando =
    typeof toolInput.command === 'string'
      ? toolInput.command.trim()
      : typeof toolInput['comando'] === 'string'
        ? String(toolInput['comando']).trim()
        : '';
  const args = typeof toolInput.args === 'string' ? toolInput.args.trim() : '';
  const fragment = [comando, args].filter(Boolean).join(' ').trim();

  /** Without command/args, models often emit RPC-like fake ids (`read_repo`, `read_github_repositories`). Snake_case rarely names a lone PATH executable — reject. */
  if (!fragment) {
    const underscoreCount = (lead.match(/_/g) ?? []).length;
    const MAX_LEAD_CHARS_EMPTY_FRAGMENT = 28;
    if (underscoreCount >= 1 || lead.length > MAX_LEAD_CHARS_EMPTY_FRAGMENT) {
      return null;
    }
  }

  const leadLc = lead.toLowerCase();
  const fragLc = fragment.toLowerCase();

  let line: string;
  if (!fragment) {
    line = lead;
  } else if (fragLc === leadLc || fragLc.startsWith(`${leadLc} `) || fragLc.startsWith(`${leadLc}\t`)) {
    line = fragment;
  } else {
    line = `${lead} ${fragment}`.trim();
  }

  if (!line.trim()) return null;
  return { command: line };
}

export function normalizeFastPathToolCall(
  parsed: any,
  executableTools: ExecutableTool[]
): { toolName: string; toolInput: any } {
  const normalized = { ...(parsed || {}) };

  const esFields: Record<string, string> = {
    herramienta: 'tool',
    entrada: 'input',
    accion: 'action',
    tool_name: 'tool',
    parameters: 'input',
  };
  for (const [es, en] of Object.entries(esFields)) {
    if (normalized[es] !== undefined && normalized[en] === undefined) {
      normalized[en] = normalized[es];
    }
  }

  let toolName = String(normalized.tool ?? '').toLowerCase();
  const envelopeActionRaw = String(normalized.action ?? '');
  /** When present, `tool` identifies the executable; legacy shapes use `action` as tool name instead. */
  if (!normalized.tool || String(normalized.tool).trim() === '') {
    toolName = String(normalized.action ?? '').toLowerCase();
  }

  let toolInput: Record<string, unknown> = {};
  const rawIn = normalized.input;
  if (typeof rawIn === 'string') {
    try {
      const p = JSON.parse(rawIn) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        toolInput = { ...(p as Record<string, unknown>) };
      }
    } catch {
      toolInput = {};
    }
  } else if (rawIn && typeof rawIn === 'object' && !Array.isArray(rawIn)) {
    toolInput = { ...(rawIn as Record<string, unknown>) };
  }

  /** Flat payloads like {"tool":"read_repo","query":"list"} — fold extras into toolInput for coerce/validators. */
  const envelopeOnlyKeys = new Set([
    'tool',
    'herramienta',
    'action',
    'accion',
    'input',
    'entrada',
    'parameters',
  ]);
  for (const [k, v] of Object.entries(normalized as Record<string, unknown>)) {
    if (envelopeOnlyKeys.has(k)) continue;
    if (toolInput[k] === undefined) toolInput[k] = v;
  }

  /** Missing `action` but `tool` present — still a tool-invocation envelope (models often omit action). */
  const envelopeActionForCoerce =
    envelopeActionRaw.trim() !== ''
      ? envelopeActionRaw
      : String(normalized.tool ?? '').trim() !== ''
        ? 'tool'
        : '';

  const knownToolNames = new Set<string>();
  for (const tool of executableTools) {
    knownToolNames.add(tool.name.toLowerCase());
  }
  if (!knownToolNames.has(toolName) && toolName !== 'none' && toolName !== '') {
    const originalAction = envelopeActionRaw.toLowerCase();
    /** Legacy/native shape puts the shell line as `action` when the canonical tool map already names `execute_command`. */
    if (originalAction === 'execute_command' || originalAction === 'ejecutar_comando' || originalAction === 'ejecutar') {
      toolInput = { command: toolName };
      toolName = 'execute_command';
    } else {
      const rawTool = String(normalized.tool ?? '').trim();
      const shellBinaryShim = coerceEnvelopeShellBinaryToExecuteCommand(
        envelopeActionForCoerce,
        rawTool,
        toolInput,
        executableTools
      );
      if (shellBinaryShim) {
        toolInput = shellBinaryShim;
        toolName = 'execute_command';
      }
    }
  }

  toolName = canonicalizeToolNameLower(toolName, executableTools);

  if (toolName === 'calendar') {
    toolInput = coerceCalendarFastPathEnvelope(normalized as Record<string, unknown>, toolInput);
  }

  return { toolName, toolInput };
}

export function mergeAvailableToolDefinitions(
  input: AmplifierInput,
  mcpRegistry: MCPRegistry | undefined
): Tool[] {
  const merged: Tool[] = [...input.availableTools];
  if (mcpRegistry) {
    for (const mcpTool of mcpRegistry.getMCPToolsForOrchestrator()) {
      if (!merged.some((tool) => tool.name === mcpTool.name)) {
        merged.push(mcpTool);
      }
    }
  }
  return merged;
}

export function resolveFastPathToolForExecution(
  toolNameLower: string,
  mcpToolList: Tool[],
  executableTools: ExecutableTool[]
): { kind: 'internal' | 'mcp'; name: string } | null {
  const internal = executableTools.find((t) => t.name.toLowerCase() === toolNameLower);
  if (internal) return { kind: 'internal', name: internal.name };

  const mcpExact = mcpToolList.find((t) => t.name.toLowerCase() === toolNameLower);
  if (mcpExact) return { kind: 'mcp', name: mcpExact.name };

  const suffixMatches = mcpToolList.filter(
    (t) =>
      t.name.startsWith('mcp_') &&
      (t.name.toLowerCase().endsWith('_' + toolNameLower) || t.name.toLowerCase().endsWith(toolNameLower))
  );
  if (suffixMatches.length === 1) return { kind: 'mcp', name: suffixMatches[0].name };

  return null;
}

export function getToolSchema(
  toolName: string,
  executableTools: ExecutableTool[],
  mcpRegistry: MCPRegistry | undefined
): Record<string, any> | undefined {
  const internalTool = executableTools.find((tool) => tool.name === toolName);
  if (internalTool) return internalTool.parameters;

  if (toolName.startsWith('mcp_') && mcpRegistry) {
    const mcpTool = mcpRegistry.getMCPToolsForOrchestrator().find((tool) => tool.name === toolName);
    return mcpTool?.parameters;
  }
  return undefined;
}

export function validateToolInput(
  toolName: string,
  input: any,
  executableTools: ExecutableTool[],
  mcpRegistry: MCPRegistry | undefined
): string | null {
  const schema = getToolSchema(toolName, executableTools, mcpRegistry);
  const result = ToolCallValidator.validate(input ?? {}, schema);
  if (!result.valid) {
    const detail = result.issues
      .slice(0, 3)
      .map((issue) => `${issue.path} ${issue.message}`)
      .join('; ');
    return `invalid input for ${toolName}: ${detail}`;
  }
  if (toolName === 'execute_command') {
    const cmd =
      typeof input?.command === 'string' ? input.command : typeof input === 'string' ? input : '';
    if (cmd && textContainsPlaceholderPath(cmd)) {
      return 'command contains placeholder paths (/path/to/...) — use a real absolute path from the user message';
    }
  }
  return null;
}

export function textContainsPlaceholderPath(text: string): boolean {
  return /\/path\/to\b|\bpath\/to\/|<path|your_path_here|example\/folder/i.test(text || '');
}

export function shellOutputIndicatesFailure(output: string): boolean {
  const lo = (output || '').toLowerCase();
  return (
    lo.startsWith('error:') ||
    lo.includes('no such file') ||
    lo.includes('command failed') ||
    lo.includes('comando fall') ||
    lo.includes('permiso denegado') ||
    lo.includes('permission denied') ||
    lo.includes('cannot stat') ||
    lo.includes('no existe el archivo') ||
    lo.includes('no se puede') ||
    lo.includes('denied') ||
    lo.includes('command not found') ||
    lo.includes('failed:')
  );
}

/** Multiline shell stdout is easy to garble if paraphrased (names, paths, file vs dir). Skip synthesis when it looks structural, not keyword-specific. */
export function isLikelyStructuredShellListingOrLog(toolOutput: string): boolean {
  const t = (toolOutput || '').trim();
  if (t.length < 16) return false;
  const lines = t.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length >= 4) return true;
  if (lines.length >= 2 && t.length > 200) return true;
  return false;
}

export function shouldReturnRawToolOutput(toolName: string, userMessage: string, toolOutput: string): boolean {
  const lowerMessage = (userMessage || '').toLowerCase();
  const lowerOutput = (toolOutput || '').toLowerCase();
  const rawRequested = /\b(raw|tal cual|sin resumir|exacto|stdout|output completo|ver salida)\b/i.test(lowerMessage);
  if (rawRequested) return true;
  if (!toolOutput) return false;
  if (
    lowerOutput.startsWith('error:') ||
    lowerOutput.includes('no such file') ||
    lowerOutput.includes('command not found')
  ) {
    return true;
  }
  if (toolName === 'read_file' && toolOutput.length < 300) {
    return true;
  }
  if (
    toolName === 'execute_command' &&
    !shellOutputIndicatesFailure(toolOutput) &&
    isLikelyStructuredShellListingOrLog(toolOutput)
  ) {
    return true;
  }
  return false;
}
