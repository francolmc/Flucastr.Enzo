import type { ExecutableTool } from '../tools/types.js';
import type { RelevantSkill } from './SkillResolver.js';

export type DeclarativeSkillLockCandidate = {
  skillId: string;
  skillName: string;
  tool: string;
  commandHint?: string;
} | null;

/**
 * Fast-path lock is now LLM-driven. This function is kept for API compatibility
 * but returns null since steps were removed from skill metadata.
 * Future: Could reimplement by analyzing skill content for single-action patterns.
 */
export function resolveTopSkillDeclarativeExecutable(
  preResolvedSkills: RelevantSkill[],
  executableTools: ExecutableTool[]
): DeclarativeSkillLockCandidate {
  return null;
}