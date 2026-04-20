import { ToolResult } from '../tools/types.js';

/**
 * Extracts the raw string output from a tool result,
 * normalizing the different data formats across tools:
 * - execute_command → result.data.stdout
 * - read_file / write_file / remember → result.data (string)
 * - web_search / others → JSON.stringify(result.data)
 */
export function smartTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const headSize = Math.floor(maxChars * 0.7);
  const tailSize = maxChars - headSize;
  const head = text.slice(0, headSize);
  const tail = text.slice(-tailSize);
  return `${head}\n...(output truncated ${text.length - maxChars} chars)\n${tail}`;
}

export function extractToolOutput(result: ToolResult, options?: { maxChars?: number }): string {
  if (!result.success) return `Error: ${result.error}`;
  const data = result.data;
  let output = '';
  if (data && typeof data === 'object' && 'stdout' in data) {
    output = (data as any).stdout ?? '';
  } else if (typeof data === 'string') {
    output = data;
  } else {
    output = JSON.stringify(data, null, 2);
  }
  const maxChars = options?.maxChars;
  if (!maxChars || maxChars <= 0) {
    return output;
  }
  return smartTruncate(output, maxChars);
}
