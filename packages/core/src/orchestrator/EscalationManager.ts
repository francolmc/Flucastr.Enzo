import { EscalationInput } from './types.js';
import { LLMProvider, Message } from '../providers/types.js';

export class EscalationManager {
  async escalate(
    input: EscalationInput,
    provider: LLMProvider
  ): Promise<string> {
    const systemPrompt = `You are a specialized reasoning engine. Your task is to solve a specific subtask with deep analysis and expertise.

Be thorough, accurate, and provide clear reasoning. Focus only on the subtask provided.`;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Subtask to solve:\n${input.subtask}\n\nContext:\n${input.context}`,
      },
    ];

    try {
      const response = await provider.complete({
        messages,
        temperature: 0.7,
        maxTokens: 2048,
      });

      return response.content;
    } catch (error) {
      console.error('[EscalationManager] escalate() error:', error);
      throw error;
    }
  }
}
