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

export function normalizeFastPathToolCall(
  parsed: any,
  executableTools: ExecutableTool[]
): { toolName: string; toolInput: any } {
  const normalized = { ...(parsed || {}) };

  const esFields: Record<string, string> = {
    herramienta: 'tool',
    entrada: 'input',
    accion: 'action',
  };
  for (const [es, en] of Object.entries(esFields)) {
    if (normalized[es] !== undefined && normalized[en] === undefined) {
      normalized[en] = normalized[es];
    }
  }

  const esActionToTool: Record<string, string> = {
    ejecutar_comando: 'execute_command',
    ejecutar: 'execute_command',
    buscar_web: 'web_search',
    buscar: 'web_search',
    buscar_en_internet: 'web_search',
    leer_archivo: 'read_file',
    leer: 'read_file',
    escribir_archivo: 'write_file',
    crear_archivo: 'write_file',
    recordar: 'remember',
    guardar_memoria: 'remember',
  };
  const actionVal = String(normalized.action ?? '').toLowerCase();
  if (actionVal in esActionToTool) {
    if (!normalized.tool) {
      normalized.tool = esActionToTool[actionVal];
    }
    normalized.action = 'tool';
  }

  let toolName = String(normalized.tool ?? normalized.action ?? '').toLowerCase();
  let toolInput = normalized.input ?? {};

  const knownToolNames = new Set(executableTools.map((tool) => tool.name.toLowerCase()));
  if (!knownToolNames.has(toolName) && toolName !== 'none' && toolName !== '') {
    const originalAction = String(normalized.action ?? actionVal).toLowerCase();
    if (originalAction === 'execute_command' || originalAction === 'ejecutar_comando' || originalAction === 'ejecutar') {
      toolInput = { command: toolName };
      toolName = 'execute_command';
    }
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
  return false;
}
