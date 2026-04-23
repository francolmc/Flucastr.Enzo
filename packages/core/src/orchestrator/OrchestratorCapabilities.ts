import type { Tool } from '../providers/types.js';
import type { SkillRegistry } from '../skills/SkillRegistry.js';
import type { Skill } from './types.js';

/** Mutates `tools` by appending MCP tool definitions. */
export function appendMcpToolsToToolList(tools: Tool[], mcpTools: Tool[]): void {
  if (mcpTools.length > 0) {
    tools.push(...mcpTools);
  }
}

/**
 * Prefer enabled skills from SkillRegistry; optional fallback to all skills when none enabled.
 */
export function resolveSkillsForOrchestrator(
  skillRegistry: SkillRegistry | undefined,
  availableSkills: Skill[]
): Skill[] {
  const allowAllSkillsFallback =
    (process.env.ENZO_SKILLS_FALLBACK_ALL_WHEN_NONE_ENABLED ?? 'true').toLowerCase() !== 'false';
  const registrySkillsRaw = skillRegistry ? skillRegistry.getEnabled() : [];
  const skillsSource = skillRegistry
    ? registrySkillsRaw.length > 0
      ? registrySkillsRaw
      : allowAllSkillsFallback
        ? skillRegistry.getAll()
        : []
    : [];
  const registrySkills: Skill[] = skillsSource.map((skill) => ({
    id: skill.id,
    name: skill.metadata.name,
    description: skill.metadata.description,
  }));
  return registrySkills.length > 0 ? registrySkills : availableSkills;
}
