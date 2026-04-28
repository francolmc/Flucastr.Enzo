import { AvailableCapabilities, ResolvedAction } from './types.js';

export class CapabilityResolver {
  async resolve(thought: string, available: AvailableCapabilities): Promise<ResolvedAction> {
    const parsed = this.tryParseJSON(thought);
    if (!parsed) {
      return { type: 'none', target: '', reason: thought, input: '' };
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
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
