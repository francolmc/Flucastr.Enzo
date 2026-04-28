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
  if (!result.success) return result.error ? `Error: ${result.error}` : result.output;
  const output = result.output ?? '';
  const maxChars = options?.maxChars;
  if (!maxChars || maxChars <= 0) {
    return output;
  }
  return smartTruncate(output, maxChars);
}
