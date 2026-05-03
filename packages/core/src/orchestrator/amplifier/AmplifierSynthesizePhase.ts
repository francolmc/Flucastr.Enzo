import type { Message, LLMProvider } from '../../providers/types.js';
import type { AmplifierInput, Step } from '../types.js';
import type { RelevantSkill } from '../SkillResolver.js';
import {
  buildAssistantIdentityPrompt,
  buildRelevantSkillsSection,
  capRelevantSkillsForPrompt,
  extractOutputTemplates,
} from './AmplifierLoopPromptHelpers.js';
import { resolveAmplifierDialogueMessages } from './ContinuityMessages.js';
import { VERIFY_PRESYNTHESIS_MARK } from './AmplifierVerifyPhase.js';

const SUBTASK_GUARD_MARK = '(SubtaskGuard)';

export type SynthesizePhaseDeps = {
  baseProvider: LLMProvider;
  withTimeout: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
};

export async function runSynthesizePhase(
  deps: SynthesizePhaseDeps,
  input: AmplifierInput,
  context: string,
  iteration: number,
  modelsUsed: Set<string>,
  resolvedSkills: RelevantSkill[] = []
): Promise<Step> {
  const { baseProvider, withTimeout } = deps;
  const startTime = Date.now();
  const userLanguage = input.userLanguage || 'en';
  const skillsForPrompt = capRelevantSkillsForPrompt(resolvedSkills);
  const relevantSkillsSection = buildRelevantSkillsSection(skillsForPrompt);
  const requiredTemplateSection = extractOutputTemplates(skillsForPrompt);

  const needsHonestyAboutGaps =
    (context.includes(VERIFY_PRESYNTHESIS_MARK) || context.includes(SUBTASK_GUARD_MARK)) &&
    context.trim().length > 0;

  const honestyDirective = needsHonestyAboutGaps
    ? `
- CONTEXT INCLUDES EXECUTION AUDIT NOTES (verification or SubtaskGuard): do NOT claim filesystem writes, MCP calls, searches, saves to memory, or shell commands succeeded unless concrete successful results appear in this context above. Explicitly acknowledge any planned step marked missing or incomplete. Do not soften failures into success.
`
    : '';

  const systemPrompt = `${buildAssistantIdentityPrompt(input)}
${relevantSkillsSection}
${requiredTemplateSection}

${context ? `Tasks completed and results:\n${context}\n` : ''}

Write a response to the user:
${honestyDirective}- Summarize what you found or did
- If a file was created, ALWAYS mention the exact file path
- If the context includes multi-line shell or listing output, quote it verbatim in a markdown code block before summarizing; never invent paths, merge names into groups, or guess file vs directory
- If you found information, share the key points briefly
- Be direct — the user wants results, not process descriptions
- If REQUIRED OUTPUT TEMPLATES are present, follow one template exactly (strict precedence)
- If a required template field is missing in the context, keep format and write "N/D"
- If the context includes calendar/agenda lines: timestamps ending in "Z" or after "UTC persistido" are storage UTC only, not wall time; the user's civil time is the "civil (…):" segment. Never call a …Z timestamp "local time" or give two different hours as local for the same event.

RESPONSE LANGUAGE: ${userLanguage === 'es' ? 'SPANISH' : userLanguage.toUpperCase()}
Your response MUST be in this language. This is mandatory.
The language of the context does NOT affect the language of your response.`;

  const messages: Message[] = [...resolveAmplifierDialogueMessages(input), { role: 'user', content: input.message }];

  const response = await withTimeout(
    baseProvider.complete({
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7,
      maxTokens: 1024,
    }),
    180_000,
    'synthesize'
  );

  modelsUsed.add(baseProvider.model);

  return {
    iteration,
    type: 'synthesize',
    requestId: input.requestId,
    output: response.content,
    durationMs: Date.now() - startTime,
    status: 'ok',
    modelUsed: baseProvider.model,
  };
}
