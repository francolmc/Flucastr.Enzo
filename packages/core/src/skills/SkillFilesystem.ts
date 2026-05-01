import fs from 'fs';
import path from 'path';

const MAX_SKILL_ID_LENGTH = 64;
/** Slug only: no path segments, no dots (prevents .. and hidden names). */
const SKILL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function validateSkillId(id: string): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('Skill id is required');
  }
  const trimmed = id.trim();
  if (trimmed !== id) {
    throw new Error('Skill id must not have leading or trailing whitespace');
  }
  if (trimmed.length > MAX_SKILL_ID_LENGTH) {
    throw new Error(`Skill id must be at most ${MAX_SKILL_ID_LENGTH} characters`);
  }
  if (!SKILL_ID_PATTERN.test(trimmed)) {
    throw new Error(
      'Skill id must use only letters, digits, hyphen and underscore, and start with a letter or digit'
    );
  }
  return trimmed;
}

function resolvedPaths(
  skillsDir: string,
  id: string
): { skillRootResolved: string; skillMdResolved: string; skillsRootResolved: string } {
  const safeId = validateSkillId(id);
  const skillsRootResolved = path.resolve(skillsDir);
  const skillPath = path.join(skillsRootResolved, safeId);
  const skillRootResolved = path.resolve(skillPath);
  const normalizedSep = skillsRootResolved.endsWith(path.sep)
    ? skillsRootResolved
    : `${skillsRootResolved}${path.sep}`;
  if (skillRootResolved === skillsRootResolved || !skillRootResolved.startsWith(normalizedSep)) {
    throw new Error('Invalid skill directory path');
  }
  const skillMdResolved = path.join(skillRootResolved, 'SKILL.md');
  return { skillRootResolved, skillMdResolved, skillsRootResolved };
}

export function readSkillMarkdownRaw(skillsDir: string, id: string): string {
  const { skillMdResolved } = resolvedPaths(skillsDir, id);
  if (!fs.existsSync(skillMdResolved)) {
    throw new Error('Skill not found');
  }
  return fs.readFileSync(skillMdResolved, 'utf-8');
}

export function writeSkillMarkdownCreate(skillsDir: string, id: string, markdown: string): void {
  const { skillRootResolved, skillMdResolved } = resolvedPaths(skillsDir, id);
  if (fs.existsSync(skillRootResolved)) {
    throw new Error('Skill already exists');
  }
  fs.mkdirSync(skillRootResolved, { recursive: false });
  fs.writeFileSync(skillMdResolved, markdown, 'utf-8');
}

export function writeSkillMarkdownUpdate(skillsDir: string, id: string, markdown: string): void {
  const { skillMdResolved } = resolvedPaths(skillsDir, id);
  if (!fs.existsSync(skillMdResolved)) {
    throw new Error('Skill not found');
  }
  fs.writeFileSync(skillMdResolved, markdown, 'utf-8');
}

export function deleteSkillDirectory(skillsDir: string, id: string): void {
  const { skillRootResolved, skillMdResolved } = resolvedPaths(skillsDir, id);
  if (!fs.existsSync(skillMdResolved)) {
    throw new Error('Skill not found');
  }
  fs.rmSync(skillRootResolved, { recursive: true, force: true });
}
