import assert from 'node:assert/strict';
import type { RelevantSkill } from '../SkillResolver.js';
import { mergeResolvedSkills, resolveMaxSkillsInjection } from '../SkillResolver.js';
import {
  buildMultiStepAlgorithmPlan,
  countCompletedToolActs,
  isMultiStepRelevantSkill,
  resolveAlgorithmCursor,
  totalToolActsForMultiStepPlan,
  stepCountForRelevantSkill,
} from '../SkillAlgorithmProgress.js';
import type { Step } from '../types.js';

function rs(p: Partial<RelevantSkill> & Pick<RelevantSkill, 'id'>): RelevantSkill {
  return {
    id: p.id,
    name: p.name ?? p.id,
    description: p.description ?? '',
    content: p.content ?? '',
    relevanceScore: p.relevanceScore ?? 0,
    steps: p.steps,
  };
}

function thinkStep(): Step {
  return {
    iteration: 1,
    type: 'think',
    modelUsed: 'test',
  };
}

function toolAct(): Step {
  return {
    iteration: 1,
    type: 'act',
    action: 'tool',
    target: 'execute_command',
    modelUsed: 'test',
  };
}

function delegateAct(): Step {
  return {
    iteration: 1,
    type: 'act',
    action: 'delegate',
    target: 'vision_agent',
    modelUsed: 'test',
  };
}

export async function runSkillAlgorithmProgressTests(): Promise<void> {
  console.log('SkillAlgorithmProgress / merge tests...\n');

  assert.equal(countCompletedToolActs([thinkStep(), toolAct(), toolAct()]), 2);
  assert.equal(countCompletedToolActs([delegateAct(), toolAct()]), 1);

  const weatherLike = rs({
    id: 'weather',
    name: 'weather',
    steps: [
      { id: 'a', description: 'geo' },
      { id: 'b', description: 'forecast' },
    ],
  });
  assert.equal(isMultiStepRelevantSkill(weatherLike), true);
  assert.equal(stepCountForRelevantSkill(weatherLike), 2);

  const oneStepYaml = rs({
    id: 'one',
    name: 'one',
    steps: [{ id: 'only', description: 'x' }],
  });
  assert.equal(isMultiStepRelevantSkill(oneStepYaml), false);

  assert.equal(totalToolActsForMultiStepPlan([weatherLike]), 2);

  const b = rs({
    id: 'b',
    content: 'Paso 1: x.\nPaso 2: y.',
    relevanceScore: 0.4,
  });
  assert.equal(isMultiStepRelevantSkill(b), true);
  assert.equal(stepCountForRelevantSkill(b), 2);

  const segA = rs({
    id: 'a',
    relevanceScore: 0.95,
    steps: [
      { id: 's1', description: 'first' },
      { id: 's2', description: 'second' },
    ],
  });
  const segB = rs({
    id: 'b',
    relevanceScore: 0.5,
    steps: [
      { id: 't1', description: 'a' },
      { id: 't2', description: 'b' },
    ],
  });
  const plan = buildMultiStepAlgorithmPlan([segB, segA]);
  assert.equal(plan[0]?.skill.id, 'a');
  assert.equal(plan[1]?.skill.id, 'b');

  assert.equal(plan.reduce((s, e) => s + e.stepCount, 0), 4);
  assert.equal(totalToolActsForMultiStepPlan([segA, segB, weatherLike]), 6);

  const cursor0 = resolveAlgorithmCursor(0, plan);
  assert.equal(cursor0?.stepWithinSkill, 1);
  assert.equal(cursor0?.currentSkill.id, 'a');

  const cursor2 = resolveAlgorithmCursor(2, plan);
  assert.equal(cursor2?.currentSkill.id, 'b');
  assert.equal(cursor2?.stepWithinSkill, 1);

  const merged = mergeResolvedSkills(
    [rs({ id: 'p1', relevanceScore: 0.5, name: 'p1' })],
    [rs({ id: 'p1', relevanceScore: 0.9, name: 'p1' }), rs({ id: 's1', relevanceScore: 0.3, name: 's1' })],
    3
  );
  assert.equal(merged[0]?.id, 'p1');
  assert.equal(merged[0]?.relevanceScore, 0.9);
  assert.equal(merged.some((m) => m.id === 's1'), true);

  assert.ok(resolveMaxSkillsInjection() >= 1);

  console.log('SkillAlgorithmProgress / merge tests passed.');
}

void runSkillAlgorithmProgressTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
