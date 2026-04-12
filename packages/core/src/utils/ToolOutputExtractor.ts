import { ToolResult } from '../tools/types.js';

/**
 * Extracts the raw string output from a tool result,
 * normalizing the different data formats across tools:
 * - execute_command → result.data.stdout
 * - read_file / write_file / remember → result.data (string)
 * - web_search / others → JSON.stringify(result.data)
 */
export function extractToolOutput(result: ToolResult): string {
  if (!result.success) return `Error: ${result.error}`;
  const data = result.data;
  if (data && typeof data === 'object' && 'stdout' in data) return (data as any).stdout ?? '';
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}
