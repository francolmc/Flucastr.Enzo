import { AvailableCapabilities, ResolvedAction } from './types.js';

export class CapabilityResolver {
  /**
   * Parses THINK JSON. `available.agents` is not validated here: `delegate` targets may be built-in ids or
   * user-preset ids; {@link AgentRouter} resolves and executes.
   */
  async resolve(thought: string, available: AvailableCapabilities): Promise<ResolvedAction> {
    const parsed = this.tryParseJSON(thought);
    if (!parsed) {
      // Model responded with prose — no JSON at all. Flag for retry.
      return { type: 'none', target: '', reason: thought, input: '', proseOnly: true };
    }

    // Explicit "I have enough information, no action needed" signal.
    if (parsed.action === 'none') {
      return { type: 'none', target: '', reason: '', input: '', proseOnly: false };
    }

    if (parsed.action === 'delegate') {
      return {
        type: 'delegate',
        target: String(parsed.agent ?? ''),
        reason: String(parsed.reason ?? ''),
        input: { task: String(parsed.task ?? '') },
      };
    }

    const toolName = String(parsed.tool ?? parsed.action ?? '');
    const tool = available.tools.find((item) => item.name === toolName);
    if (!tool) {
      return {
        type: 'none',
        target: '',
        reason: `Tool not found: ${toolName}. Available tools: ${available.tools.map((item) => item.name).join(', ')}`,
        input: '',
        proseOnly: true,  // Unknown tool — loop should retry with correction context.
      };
    }
    return {
      type: 'tool',
      target: tool.name,
      reason: 'Tool requested by model',
      input: (parsed.input ?? parsed) as Record<string, unknown>,
    };
  }

  private tryParseJSON(text: string): Record<string, unknown> | null {
    const trimmed = text.trim();

    // Extract all top-level JSON objects by tracking brace depth.
    const candidates: string[] = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (c === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          candidates.push(trimmed.slice(start, i + 1));
          start = -1;
        }
      }
    }

    if (candidates.length === 0) return null;

    // First pass: try raw parse, prefer objects with an 'action' key.
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        if (typeof parsed === 'object' && parsed !== null && 'action' in parsed) {
          return parsed;
        }
      } catch { /* try next */ }
    }

    // Second pass: try after cleaning common issues (trailing commas).
    for (const candidate of candidates) {
      const cleaned = candidate.replace(/,(\s*[}\]])/g, '$1');
      try {
        const parsed = JSON.parse(cleaned) as Record<string, unknown>;
        if (typeof parsed === 'object' && parsed !== null && 'action' in parsed) {
          return parsed;
        }
      } catch { /* try next */ }
    }

    // Fallback: return first parseable object even without 'action'.
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        if (typeof parsed === 'object' && parsed !== null) return parsed;
      } catch { /* try next */ }
    }

    return null;
  }
}
