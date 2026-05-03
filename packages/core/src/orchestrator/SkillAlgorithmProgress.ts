import type { Step } from './types.js';
import type { RelevantSkill } from './SkillResolver.js';

export function countCompletedToolActs(steps: Step[]): number {
  return steps.filter((s) => s.type === 'act' && s.action === 'tool').length;
}

export function isMultiStepRelevantSkill(skill: RelevantSkill): boolean {
  const markers = (skill.content ?? '').match(/\bpaso\s+(\d+)|\bstep\s+(\d+)/gi) ?? [];
  const maxN = markers.reduce((m, s) => Math.max(m, parseInt(s.replace(/\D/g, ''), 10) || 0), 0);
  return maxN >= 2;
}

export function stepCountForRelevantSkill(skill: RelevantSkill): number {
  const markers = (skill.content ?? '').match(/\bpaso\s+(\d+)|\bstep\s+(\d+)/gi) ?? [];
  const maxN = markers.reduce((m, s) => Math.max(m, parseInt(s.replace(/\D/g, ''), 10) || 0), 0);
  if (maxN >= 2) return maxN;
  const pasoLines = (skill.content ?? '')
    .split('\n')
    .filter((l) => /^\d+\.\s/.test(l.trim()) || /\bpaso\s+\d+/i.test(l.trim()))
    .slice(0, 20);
  if (pasoLines.length >= 2) return pasoLines.length;
  return 1;
}

export type AlgorithmPlanEntry = {
  skill: RelevantSkill;
  stepCount: number;
};

/** Multi-step segments run in descending relevance score (stable among equals). */
export function buildMultiStepAlgorithmPlan(multiStepSkills: RelevantSkill[]): AlgorithmPlanEntry[] {
  const sorted = [...multiStepSkills].sort((a, b) => b.relevanceScore - a.relevanceScore);
  return sorted.map((skill) => ({ skill, stepCount: stepCountForRelevantSkill(skill) }));
}

export type AlgorithmCursor = {
  skillIndex: number;
  /** 1-based next tool step index within current skill segment */
  stepWithinSkill: number;
  currentSkill: RelevantSkill;
  totalStepsAllSkills: number;
  completedGlobally: number;
  planLength: number;
};

/** Maps completed tool acts to the active skill segment and local step index. */
export function resolveAlgorithmCursor(
  completedToolActs: number,
  plan: AlgorithmPlanEntry[]
): AlgorithmCursor | null {
  if (plan.length === 0) return null;
  const totalStepsAllSkills = plan.reduce((s, e) => s + e.stepCount, 0);
  let offset = 0;
  for (let i = 0; i < plan.length; i++) {
    const { skill, stepCount } = plan[i]!;
    const end = offset + stepCount;
    if (completedToolActs < end) {
      return {
        skillIndex: i,
        stepWithinSkill: completedToolActs - offset + 1,
        currentSkill: skill,
        totalStepsAllSkills,
        completedGlobally: completedToolActs,
        planLength: plan.length,
      };
    }
    offset = end;
  }
  const last = plan[plan.length - 1]!;
  return {
    skillIndex: plan.length - 1,
    stepWithinSkill: last.stepCount,
    currentSkill: last.skill,
    totalStepsAllSkills,
    completedGlobally: completedToolActs,
    planLength: plan.length,
  };
}

/** Total tool calls required when running every multi-step skill segment in the plan (serial). */
export function totalToolActsForMultiStepPlan(preResolvedSkills: RelevantSkill[]): number {
  const multi = preResolvedSkills.filter(isMultiStepRelevantSkill);
  if (multi.length === 0) return 0;
  return buildMultiStepAlgorithmPlan(multi).reduce((sum, e) => sum + e.stepCount, 0);
}

export function buildStepDescriptionsForSkill(skill: RelevantSkill): string[] {
  const pasoLines = (skill.content ?? '')
    .split('\n')
    .filter((l) => /^\d+\.\s/.test(l.trim()) || /\bpaso\s+\d+/i.test(l.trim()))
    .slice(0, 10)
    .map((l, i) => `  Step ${i + 1}: ${l.trim()}`);
  return pasoLines.length > 0 ? pasoLines : [`  (see skill algorithm below)`];
}
