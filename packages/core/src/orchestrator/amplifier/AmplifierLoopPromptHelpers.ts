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
  ];

  if (identity.styleGuidelines) {
    lines.push(`Additional style guidelines: ${identity.styleGuidelines}`);
  }

  return lines.join('\n');
}

export function resolveFastPathSkillContentLimit(): number {
  const fromEnv = Number(process.env.ENZO_SKILLS_FASTPATH_CONTENT_LIMIT ?? 1800);
  if (Number.isNaN(fromEnv)) return 1800;
  return Math.max(300, Math.floor(fromEnv));
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
  return `\nRELEVANT SKILLS FOR THIS REQUEST (follow these instructions):\n${blocks.join('\n\n')}\n`;
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
