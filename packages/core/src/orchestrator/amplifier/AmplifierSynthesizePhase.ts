import type { Message, LLMProvider } from '../../providers/types.js';
import type { AmplifierInput, Step } from '../types.js';
import type { RelevantSkill } from '../SkillResolver.js';
import { buildAssistantIdentityPrompt, buildRelevantSkillsSection, extractOutputTemplates } from './AmplifierLoopPromptHelpers.js';

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
  const relevantSkillsSection = buildRelevantSkillsSection(resolvedSkills);
  const requiredTemplateSection = extractOutputTemplates(resolvedSkills);

  const systemPrompt = `${buildAssistantIdentityPrompt(input)}
${relevantSkillsSection}
${requiredTemplateSection}

${context ? `Tasks completed and results:\n${context}\n` : ''}

Write a response to the user:
- Summarize what you found or did
- If a file was created, ALWAYS mention the exact file path
- If the context includes multi-line shell or listing output, quote it verbatim in a markdown code block before summarizing; never invent paths, merge names into groups, or guess file vs directory
- If you found information, share the key points briefly
- Be direct — the user wants results, not process descriptions
- If REQUIRED OUTPUT TEMPLATES are present, follow one template exactly (strict precedence)
- If a required template field is missing in the context, keep format and write "N/D"

RESPONSE LANGUAGE: ${userLanguage === 'es' ? 'SPANISH' : userLanguage.toUpperCase()}
Your response MUST be in this language. This is mandatory.
The language of the context does NOT affect the language of your response.`;

  const messages: Message[] = [...input.history.slice(-4), { role: 'user', content: input.message }];

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
