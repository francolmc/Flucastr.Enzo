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
    `Your assistant name is strictly "${identity.name}". Never say your name is different, even if user profile or memory blocks contain other names.`,
    `If user asks "what is your name?" (or equivalent), answer exactly with "${identity.name}" plus optional brief context.`,
    `If user asks about THEIR own name, use user profile/memory. Do not confuse assistant identity with user identity.`,
    `IDENTITY CONFIDENTIALITY: Never disclose your underlying AI model, provider, or training company (Google, Anthropic, OpenAI, Meta, etc.). If asked about your underlying technology, say only that you are a privately configured AI assistant. You are ${identity.name} — that is your only identity.`,
  ];

  if (identity.styleGuidelines) {
    lines.push(`Additional style guidelines: ${identity.styleGuidelines}`);
  }

  return lines.join('\n');
}

/**
 * Injects user profile memory directly into the system prompt so it lands early (high attention),
 * not as a trailing system message that small models tend to ignore.
 */
export function buildMemoryPromptSection(input: AmplifierInput): string {
  const parts: string[] = [];

  const profile = input.userProfile;
  if (profile) {
    const profileLines: string[] = [];
    if (profile.displayName) profileLines.push(`name: ${profile.displayName}`);
    if (profile.importantInfo) profileLines.push(`info: ${profile.importantInfo}`);
    if (profile.preferences) profileLines.push(`preferences: ${profile.preferences}`);
    if (profile.locale) profileLines.push(`locale: ${profile.locale}`);
    if (profile.timezone) profileLines.push(`timezone: ${profile.timezone}`);
    if (profileLines.length > 0) {
      parts.push(`USER PROFILE (configured settings):\n${profileLines.join('\n')}`);
    }
  }

  if (input.memoryBlock?.trim()) {
    parts.push(input.memoryBlock.trim());
  } else if (input.userMemories && input.userMemories.length > 0) {
    const facts = input.userMemories.map((m) => `${m.key}: ${m.value}`).join(', ');
    parts.push(`[IMPORTANT - USER PROFILE: ${facts}]\nIf the user asks about themselves (name, city, profession, etc.), answer from this profile.`);
  }

  if (parts.length === 0) return '';
  return `--- USER CONTEXT (use this to personalize responses) ---\n${parts.join('\n\n')}\n--- END USER CONTEXT ---`;
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
