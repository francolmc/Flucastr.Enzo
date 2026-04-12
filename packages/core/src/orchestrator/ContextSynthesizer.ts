import { Step } from './types.js';
import { Message, LLMProvider } from '../providers/types.js';

export class ContextSynthesizer {
  compress(steps: Step[]): string {
    if (steps.length === 0) {
      return '';
    }

    const summary: string[] = [];

    for (const step of steps) {
      if (step.type === 'think') {
        summary.push(`[Iteration ${step.iteration}] Thought: ${step.output}`);
      } else if (step.type === 'act') {
        summary.push(
          `[Iteration ${step.iteration}] Action: ${step.action} on ${step.target} → ${step.output}`
        );
      } else if (step.type === 'observe') {
        summary.push(`[Iteration ${step.iteration}] Observed: ${step.output}`);
      }
    }

    return summary.join('\n\n');
  }

  async synthesize(
    original: string,
    context: string,
    provider: LLMProvider
  ): Promise<string> {
    const systemPrompt = `You are Enzo, an advanced AI assistant. Your role is to provide clear, helpful, and accurate responses.

Responde siempre en español, de forma natural y cercana.

Maintain these characteristics in all responses:
- Be concise and direct
- Use a friendly but professional tone
- Provide accurate information
- Acknowledge limitations when appropriate
- Structure complex answers clearly

REGLA ABSOLUTA:
Si el usuario pide ver, leer o mostrar el contenido de un archivo,
SIEMPRE usa read_file. NUNCA inventes el contenido.
Si el archivo no existe o no puedes leerlo, dilo honestamente.

You have completed your reasoning process. Now provide a final, synthesized answer to the user's original question.`;

    const userMessage = context
      ? `Original question: ${original}\n\nReasoning summary:\n${context}\n\nBased on your reasoning above, provide a final answer.`
      : `Answer this question: ${original}`;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    try {
      const response = await provider.complete({
        messages,
        temperature: 0.7,
        maxTokens: 2048,
      });

      return response.content;
    } catch (error) {
      console.error('[ContextSynthesizer] synthesize() error:', error);
      throw error;
    }
  }
}
