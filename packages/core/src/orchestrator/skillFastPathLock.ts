import type { ExecutableTool } from '../tools/types.js';
import type { SkillStep } from '../skills/SkillLoader.js';
import type { RelevantSkill } from './SkillResolver.js';

/** One YAML-declared skill step wired to exactly one runtime tool call (generic fast-path lock). */
export type DeclarativeSkillLockCandidate = {
  skillId: string;
  skillName: string;
  tool: string;
  /** Optional pinned shell line for execute_command prompts (skills may set command_hint in YAML). */
  commandHint?: string;
};

function commandHintFromStep(step: SkillStep): string | undefined {
  const raw =
    typeof step.commandHint === 'string'
      ? step.commandHint.trim()
      : typeof step.command_hint === 'string'
        ? step.command_hint.trim()
        : '';
  return raw.length > 0 ? raw : undefined;
}

/**
 * If the ranked skill declares exactly one `steps[].tool` and `tool` is registered, return metadata for the SKILL_FASTPATH_LOCKED block.
 */
export function resolveTopSkillDeclarativeExecutable(
  preResolvedSkills: RelevantSkill[],
  executableTools: ExecutableTool[]
): DeclarativeSkillLockCandidate | null {
  const top = preResolvedSkills[0];
  if (!top?.steps?.length || top.steps.length !== 1) {
    return null;
  }
  const s0 = top.steps[0]!;
  const toolName = typeof s0.tool === 'string' ? s0.tool.trim() : '';
  if (!toolName) {
    return null;
  }
  if (!executableTools.some((t) => t.name === toolName)) {
    return null;
  }
  return {
    skillId: top.id,
    skillName: top.name,
    tool: toolName,
    commandHint: commandHintFromStep(s0),
  };
}
