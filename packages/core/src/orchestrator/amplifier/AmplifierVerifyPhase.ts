import type { Message, LLMProvider } from '../../providers/types.js';
import type { AmplifierInput, Step } from '../types.js';
import { parseFirstJsonObject } from '../../utils/StructuredJson.js';
import { buildAssistantIdentityPrompt } from './AmplifierLoopPromptHelpers.js';

export type VerifyPhaseDeps = {
  baseProvider: LLMProvider;
  withTimeout: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
};

type VerifyJson = { satisfied: boolean; gaps?: string };

/**
 * Optional LLM check that tool/context evidence addresses the user request before final synthesis.
 */
export async function runVerifyBeforeSynthesizeIfEnabled(
  deps: VerifyPhaseDeps,
  input: AmplifierInput,
  context: string,
  iteration: number,
  modelsUsed: Set<string>,
  enabled: boolean
): Promise<{ context: string; step?: Step }> {
  if (!enabled || !context.trim()) {
    return { context };
  }

  const { baseProvider, withTimeout } = deps;
  const startTime = Date.now();
  const systemPrompt = `${buildAssistantIdentityPrompt(input)}
You verify whether the gathered evidence satisfies the user's request before the assistant replies.

Reply ONLY with compact JSON (no markdown):
{"satisfied":true}
or
{"satisfied":false,"gaps":"what is missing or uncertain"}

Rules:
- If tools produced concrete results that answer the request, satisfied=true.
- If critical data is missing, failed, or clearly wrong, satisfied=false and name gaps briefly.`;

  const evidence = context.length > 14000 ? `${context.slice(0, 14000)}\n…[truncated]` : context;
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `User request:\n${input.message}\n\nEvidence from tools and prior steps:\n${evidence}`,
    },
  ];

  let satisfied = true;
  let gaps = '';
  try {
    const response = await withTimeout(
      baseProvider.complete({
        messages,
        temperature: 0,
        maxTokens: 200,
      }),
      60_000,
      'verify-before-synthesize'
    );
    modelsUsed.add(baseProvider.model);
    const parsed = parseFirstJsonObject<VerifyJson>(response.content ?? '', { tryRepair: true });
    if (parsed?.value && typeof parsed.value.satisfied === 'boolean') {
      satisfied = parsed.value.satisfied;
      gaps = typeof parsed.value.gaps === 'string' ? parsed.value.gaps : '';
    }
  } catch {
    // On failure, do not block synthesis
    satisfied = true;
  }

  const durationMs = Date.now() - startTime;
  if (satisfied) {
    return {
      context,
      step: {
        iteration,
        type: 'verify',
        requestId: input.requestId,
        output: '{"satisfied":true}',
        durationMs,
        status: 'ok',
        modelUsed: baseProvider.model,
      },
    };
  }

  const note = `\n\nVERIFICATION (pre-synthesis): The checklist found gaps — incorporate honestly: ${gaps || 'unspecified gaps'}`;
  return {
    context: context + note,
    step: {
      iteration,
      type: 'verify',
      requestId: input.requestId,
      output: JSON.stringify({ satisfied: false, gaps: gaps || null }),
      durationMs,
      status: 'ok',
      modelUsed: baseProvider.model,
    },
  };
}
