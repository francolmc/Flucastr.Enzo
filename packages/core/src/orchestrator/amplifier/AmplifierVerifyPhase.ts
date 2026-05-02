import type { Message, LLMProvider } from '../../providers/types.js';
import type { AmplifierInput, Step } from '../types.js';
import type { Subtask } from '../Decomposer.js';
import { parseFirstJsonObject } from '../../utils/StructuredJson.js';
import { buildAssistantIdentityPrompt } from './AmplifierLoopPromptHelpers.js';
import { summarizeActSteps } from './SubtaskExecutionTrace.js';

export type VerifyPhaseDeps = {
  baseProvider: LLMProvider;
  withTimeout: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
};

/** Substring appended to context when gaps are detected — synthesized phase uses this marker. */
export const VERIFY_PRESYNTHESIS_MARK = 'VERIFICATION (pre-synthesis):';

export type VerifyBeforeSynthesizeStructuredContext = {
  plannedSubtasks: Subtask[];
  orchestratorSteps: Step[];
};

type VerifyJson = {
  satisfied: boolean;
  gaps?: string;
  /** Planned decomposition step IDs that have no plausible successful execution in orchestrator traces. */
  missingStepIds?: unknown;
};

function normalizeMissingStepIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const x of raw) {
    const n = typeof x === 'number' ? x : Number(x);
    if (Number.isFinite(n)) out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Optional LLM check that tool/context evidence addresses the user request before final synthesis.
 *
 * With `extras`, prompts include decomposition plan vs factual act-step audit derived from orchestrator traces.
 */
export async function runVerifyBeforeSynthesizeIfEnabled(
  deps: VerifyPhaseDeps,
  input: AmplifierInput,
  context: string,
  iteration: number,
  modelsUsed: Set<string>,
  enabled: boolean,
  extras?: VerifyBeforeSynthesizeStructuredContext
): Promise<{ context: string; step?: Step }> {
  if (!enabled || !context.trim()) {
    return { context };
  }

  const { baseProvider, withTimeout } = deps;
  const startTime = Date.now();

  let planVersusFactsBlock = '';
  const actFacts = extras?.orchestratorSteps != null ? extras.orchestratorSteps : undefined;
  if (extras?.plannedSubtasks?.length && actFacts) {
    const plannedCompact = extras.plannedSubtasks.map((s) => ({
      id: s.id,
      tool: s.tool,
      dependsOn: s.dependsOn,
      description:
        typeof s.description === 'string'
          ? s.description.length > 220
            ? `${s.description.slice(0, 220)}…`
            : s.description
          : '',
    }));
    planVersusFactsBlock = `Structured audit (trusted — compare systematically):
DECOMPOSITION PLAN (minimal steps proposed):
${JSON.stringify(plannedCompact)}

ORCHESTRATOR ACT STEPS (fact — type act rows only):
${JSON.stringify(summarizeActSteps(actFacts))}

For each planned row with tool not equal to "none", check whether orchestrator traces show a successful matching tool invocation (target equals planned tool). Delegation counts only if traces show action "delegate" with status ok. If any planned actionable step lacks such evidence, set satisfied=false and list its ids in missingStepIds.

`;
  }

  const systemPrompt = `${buildAssistantIdentityPrompt(input)}
You verify whether the gathered evidence satisfies the user's request before the assistant replies.

${planVersusFactsBlock}Reply ONLY with compact JSON (no markdown):
{\"satisfied\":true}
or
{\"satisfied\":false,\"gaps\":\"what is missing or uncertain\",\"missingStepIds\":[numbers]}

Rules:
- If tools produced concrete results that answer the request, satisfied=true.
- If critical data is missing, failed, or clearly wrong, satisfied=false with brief gaps (and optional missingStepIds when structured plan was supplied).
- When DECOMPOSITION PLAN is present: cross-check act targets against planned tools step-by-step — do not claim completion for planned tools that lack a plausible successful invocation in orchestrator traces.`;

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
  let missingStepIds: number[] = [];
  try {
    const response = await withTimeout(
      baseProvider.complete({
        messages,
        temperature: 0,
        maxTokens: 260,
      }),
      60_000,
      'verify-before-synthesize'
    );
    modelsUsed.add(baseProvider.model);
    const parsed = parseFirstJsonObject<VerifyJson>(response.content ?? '', { tryRepair: true });
    if (parsed?.value && typeof parsed.value.satisfied === 'boolean') {
      satisfied = parsed.value.satisfied;
      gaps = typeof parsed.value.gaps === 'string' ? parsed.value.gaps : '';
      missingStepIds = normalizeMissingStepIds(parsed.value.missingStepIds);
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

  const gapPieces = [gaps || 'unspecified gaps'];
  if (missingStepIds.length > 0) {
    gapPieces.push(`missing planned step ids per verifier: ${missingStepIds.join(', ')}`);
  }
  const note = `\n\n${VERIFY_PRESYNTHESIS_MARK} The checklist found gaps — incorporate honestly: ${gapPieces.filter(Boolean).join(' | ')}`;
  return {
    context: context + note,
    step: {
      iteration,
      type: 'verify',
      requestId: input.requestId,
      output: JSON.stringify({
        satisfied: false,
        gaps: gaps || null,
        ...(missingStepIds.length > 0 ? { missingStepIds } : {}),
      }),
      durationMs,
      status: 'ok',
      modelUsed: baseProvider.model,
    },
  };
}
