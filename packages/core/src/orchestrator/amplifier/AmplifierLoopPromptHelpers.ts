import type { AgentConfig, AmplifierInput, DelegationHint } from '../types.js';
import type { RelevantSkill } from '../SkillResolver.js';
import type { Tool } from '../../providers/types.js';

export function getAssistantIdentityContext(input: AmplifierInput): {
  name: string;
  persona: string;
  tone: string;
  styleGuidelines: string;
} {
  return {
    name: input.assistantProfile?.name || 'Enzo',
    persona: input.assistantProfile?.persona || 'intelligent personal assistant',
    tone: input.assistantProfile?.tone || 'direct, concise, and friendly',
    styleGuidelines: input.assistantProfile?.styleGuidelines || '',
  };
}

export function buildAssistantIdentityPrompt(input: AmplifierInput): string {
  const identity = getAssistantIdentityContext(input);
  const lines = [
    `You are ${identity.name}, ${identity.persona}.`,
    `Your communication tone is: ${identity.tone}.`,
    `Your assistant name is strictly "${identity.name}". Never claim to be a different assistant.`,
    `If user asks "what is your name?" or "who are you?", answer exactly with "${identity.name}" plus optional brief context.`,
    `If user asks about THEIR OWN name or personal details, look at the USER CONTEXT / FACTS ABOUT THE USER section — that data is about the human, not you.`,
    `IDENTITY CONFIDENTIALITY: Never disclose your underlying AI model, provider, or training company (Google, Anthropic, OpenAI, Meta, etc.). If asked about your underlying technology, say only that you are a privately configured AI assistant. You are ${identity.name} — that is your only identity.`,
  ];

  if (identity.styleGuidelines) {
    lines.push(`Additional style guidelines: ${identity.styleGuidelines}`);
  }

  return lines.join('\n');
}

/**
 * Resolves the user's display name with explicit precedence:
 * dynamic memory (extracted from conversation) > static profile (configured by user).
 * This is the single source of truth for "who is the person chatting".
 */
export function resolveUserDisplayName(input: AmplifierInput): string | undefined {
  const nameMatch = input.memoryBlock?.match(/The user's name is "([^"]+)"/i);
  if (nameMatch?.[1]) return nameMatch[1];
  return input.userProfile?.displayName || undefined;
}

/**
 * Merges static UserProfile and dynamic memory facts into a single USER CONTEXT block.
 *
 * Precedence rules:
 * - name / profession / city: dynamic memory wins (extracted from natural conversation)
 * - locale / timezone: static profile wins (explicitly configured by user — authoritative)
 * - importantInfo / preferences: static profile appended unless memory has a matching key
 *
 * Injected early in the system prompt so small models don't lose it under tool rules.
 */
export function buildMemoryPromptSection(input: AmplifierInput): string {
  const parts: string[] = [];
  const profile = input.userProfile;

  // --- Dynamic memory (ranked facts from conversation history) ---
  // These override static profile for personal identity fields (name, profession, city).
  if (input.memoryBlock?.trim()) {
    parts.push(input.memoryBlock.trim());
  } else if (input.userMemories && input.userMemories.length > 0) {
    const facts = input.userMemories
      .map((m) => `${m.key}: ${m.value}`)
      .join('\n');
    parts.push(`FACTS ABOUT THE USER (the person chatting with you — NOT the assistant):\n${facts}\nWhen the user asks "what is my name?" or "who am I?", answer using the facts above.`);
  }

  // --- Static profile (explicitly configured settings) ---
  // Authoritative for locale/timezone; supplements dynamic memory for name/profession
  // only when dynamic memory has no value for that field.
  if (profile) {
    const dynamicKeys = new Set(
      (input.userMemories ?? []).map((m) => m.key.toLowerCase())
    );
    const hasDynamicName = dynamicKeys.has('name') || /The user's name is "/i.test(input.memoryBlock ?? '');
    const hasDynamicProfession = dynamicKeys.has('profession') || /The user's profession:/i.test(input.memoryBlock ?? '');

    const staticLines: string[] = [];
    if (profile.displayName && !hasDynamicName) {
      staticLines.push(`name: ${profile.displayName}`);
    }
    if (profile.profession && !hasDynamicProfession) {
      staticLines.push(`profession: ${profile.profession}`);
    }
    if (profile.importantInfo) staticLines.push(`info: ${profile.importantInfo}`);
    if (profile.preferences) staticLines.push(`preferences: ${profile.preferences}`);
    // locale and timezone are always from static config — they are user-configured, not inferred
    if (profile.locale) staticLines.push(`locale: ${profile.locale}`);
    if (profile.timezone) staticLines.push(`timezone: ${profile.timezone}`);

    if (staticLines.length > 0) {
      parts.push(`USER PROFILE (configured settings):\n${staticLines.join('\n')}`);
    }
  }

  if (parts.length === 0) return '';
  return `--- USER CONTEXT (use this to personalize responses) ---\n${parts.join('\n\n')}\n--- END USER CONTEXT ---`;
}

/**
 * Compact anchor appended at the END of the system prompt.
 * Mitigates attention dilution in long prompts (small models ignore identity buried early).
 * Uses resolveUserDisplayName() as single source of truth for the user's name.
 */
export function buildContextAnchorPrompt(input: AmplifierInput): string {
  const identity = getAssistantIdentityContext(input);
  const lines: string[] = [
    `CONTEXT ANCHOR (highest priority — read this last before responding):`,
    `- Your name is "${identity.name}". You are a privately configured AI assistant. NEVER say you are "trained by Google", "a Google model", "trained by Anthropic", or any other company. If asked who made you, say only that you are a privately configured assistant named "${identity.name}".`,
  ];

  const userName = resolveUserDisplayName(input);
  if (userName) {
    lines.push(`- The person chatting with you is named ${userName}. Use their name naturally when relevant.`);
  }

  return lines.join('\n');
}

export function resolveFastPathSkillContentLimit(): number {
  const fromEnv = Number(process.env.ENZO_SKILLS_FASTPATH_CONTENT_LIMIT ?? 1800);
  if (Number.isNaN(fromEnv)) return 1800;
  return Math.max(300, Math.floor(fromEnv));
}

/** Max number of skills injected into fast-path / synthesis prompts (by relevance). Override with ENZO_SKILLS_FASTPATH_MAX_COUNT. */
export function resolveFastPathSkillMaxCount(): number {
  const fromEnv = Number(process.env.ENZO_SKILLS_FASTPATH_MAX_COUNT ?? '6');
  if (Number.isNaN(fromEnv)) return 6;
  return Math.max(1, Math.min(20, Math.floor(fromEnv)));
}

/** Keeps the highest-ranked skills so prompts stay focused; does not change orchestrator routing logic when callers pass uncapped lists elsewhere. */
export function capRelevantSkillsForPrompt(skills: RelevantSkill[]): RelevantSkill[] {
  const max = resolveFastPathSkillMaxCount();
  if (skills.length <= max) return skills;
  return [...skills].sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, max);
}

/**
 * Short fixed contract: skills (how-to) vs agents (delegate) vs tools (only host effects).
 * Placed near the start of the system prompt for fast path and THINK.
 */
export function buildRuntimeThreeLayersContractPrompt(): string {
  return `RUNTIME LAYERS (this turn only):
- Skills: procedural text in RELEVANT SKILLS — how to build shell lines or follow a workflow. Not invocable tool ids; never put a skill name in JSON "tool".
- Agents: specialists from the delegation catalog only, invoked with {"action":"delegate",...} using an exact agent id from that catalog. They do not run until the host dispatches delegation.
- Tools: the ONLY valid names in {"action":"tool","tool":"..."} are those listed under AVAILABLE TOOLS (exact strings, including mcp_…). Host actions use these; for CLIs (gh, git, …) use **execute_command** and put the full line in **input.command**.

Acting on this machine is only through Tools as listed. Skills and agents are not tools.`;
}

export function buildRelevantSkillsSection(skills: RelevantSkill[]): string {
  if (skills.length === 0) return '';
  const maxChars = resolveFastPathSkillContentLimit();
  const blocks = skills.map((skill) => {
    const content =
      skill.content.length > maxChars
        ? `${skill.content.slice(0, maxChars)}\n...(skill truncated)`
        : skill.content;
    return [
      `- Skill: ${skill.name} (relevance: ${(skill.relevanceScore * 100).toFixed(0)}%)`,
      `  Description: ${skill.description}`,
      '  Instructions:',
      '  """',
      content,
      '  """',
    ].join('\n');
  });
  return `\nRELEVANT SKILLS FOR THIS REQUEST (follow these instructions):\n${blocks.join(
    '\n\n'
  )}\n\nUse skill text for procedure and example shell lines; the JSON **tool** field must be an exact name from AVAILABLE TOOLS (see RUNTIME LAYERS above).\n`;
}

export function extractOutputTemplates(skills: RelevantSkill[]): string {
  const templates: string[] = [];
  for (const skill of skills) {
    const content = skill.content;
    const sectionRegex =
      /(##\s*(?:Como\s+Presentar\s+el\s+Resultado|Cómo\s+Presentar\s+el\s+Resultado|Output\s+Format|Response\s+Format)[\s\S]*?)(?=\n##\s+|$)/i;
    const sectionMatch = content.match(sectionRegex);
    const searchText = sectionMatch ? sectionMatch[1] : content;
    const codeBlockMatch = searchText.match(/```[\w-]*\n([\s\S]*?)```/);
    if (!codeBlockMatch) continue;
    const templateBody = codeBlockMatch[1].trim();
    if (!templateBody) continue;
    templates.push(
      [`Template from skill "${skill.name}" (MUST follow exact structure):`, '"""', templateBody, '"""'].join('\n')
    );
  }

  if (templates.length === 0) return '';
  return `\nREQUIRED OUTPUT TEMPLATES:\n${templates.join('\n\n')}\n`;
}

export function buildToolsPrompt(tools: Tool[]): string {
  const toolList = tools
    .map(
      (tool) => `- **${tool.name}**: ${tool.description}
  Input: ${JSON.stringify(tool.parameters?.properties ?? {}, null, 0)}`
    )
    .join('\n');

  const exactNames = tools.map((t) => t.name).join(', ');

  return `AVAILABLE TOOLS:
${toolList}

The names in the list above are the ONLY valid JSON values for "tool". Any prose or skill that mentions terminals, shells, vendors, APIs, Git hosts, containers, orchestrators, or command-line binaries still maps to executing a real shell line via **execute_command** with that line in input.command — never invent an extra tool whose name echoes the topic.

CANONICAL TOOL CALL (only when execution is needed):
{"action":"tool","tool":"<exact_name>","input":{...}}

The "tool" value MUST be one of these strings exactly — never invent or rename tools:
${exactNames}

Casual replies, greetings, math, conceptual chat without side effects → write plain text only (no JSON).
To delegate:
{"action":"delegate","agent":"agent_name","task":"description","reason":"why"}

When in a reasoning loop with nothing left to execute:
{"action":"none"}

ONE JSON object per message when using JSON — no prose before or after it.`;
}

/** THINK-phase catalog: user preset ids + built-in delegation specialists. */
export function buildThinkDelegationCatalogBlock(
  availableAgents: AgentConfig[],
  delegationHint?: DelegationHint
): string {
  const builtin = `- "claude_code" — large code / architecture / deep debugging
- "doc_agent" — long formal documents with sections
- "vision_agent" — analyze attached image bytes (built-in multimodal specialist)`;
  const userLines =
    availableAgents.length === 0
      ? '(No user-configured presets in catalog for this turn.)'
      : availableAgents
          .map(
            (a) =>
              `- "${a.id}" — name: ${a.name}; ${a.provider}/${a.model}; ${(a.description || 'no description').slice(0, 220)}`
          )
          .join('\n');
  const hint =
    delegationHint != null
      ? `CLASSIFIER_SUGGESTION (non-binding): agentId=${delegationHint.agentId ?? '(you choose)'} — ${delegationHint.reason}\n\n`
      : '';
  return `${hint}DELEGATION CATALOG — the "agent" field must be exactly one of these id strings:

User presets:
${userLines}

Built-in specialists:
${builtin}
`;
}
