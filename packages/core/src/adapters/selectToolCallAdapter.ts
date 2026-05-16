import type { ToolCallAdapter } from './ToolCallAdapter.js';
import { TextToolAdapter } from './TextToolAdapter.js';
import { NativeToolAdapter } from './NativeToolAdapter.js';

export function selectToolCallAdapter(providerName: string): ToolCallAdapter {
  if (providerName === 'anthropic' || providerName === 'openai') {
    return new NativeToolAdapter();
  }
  return new TextToolAdapter();
}