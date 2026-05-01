import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  validateSkillId,
  readSkillMarkdownRaw,
  writeSkillMarkdownCreate,
  writeSkillMarkdownUpdate,
  deleteSkillDirectory,
} from './SkillFilesystem.js';
import { SkillLoader } from './SkillLoader.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function throws(fn: () => void, substring: string): void {
  try {
    fn();
    throw new Error(`expected throw containing "${substring}"`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    assert(msg.includes(substring), `got "${msg}", expected substring "${substring}"`);
  }
}

const sampleMarkdown = `---
name: filesystem-test-skill
description: Test skill for SkillFilesystem helpers
version: 0.0.1
author: test
---

Instructions line one.
`;

async function runTests(): Promise<void> {
  console.log('SkillFilesystem tests...\n');

  console.log('Test: validateSkillId rejects invalid ids');
  throws(() => validateSkillId(''), 'required');
  throws(() => validateSkillId(' '), 'required');
  throws(() => validateSkillId('a/../b'), 'letter or digit');
  throws(() => validateSkillId('foo/bar'), 'letter or digit');
  throws(() => validateSkillId('x.y'), 'letter or digit');
  console.log('✓ Passed\n');

  console.log('Test: validateSkillId accepts slug');
  assert(validateSkillId('my_skill-2') === 'my_skill-2', 'expected normalized id');
  console.log('✓ Passed\n');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enzo-skills-fs-'));

  console.log('Test: create → read raw → SkillLoader parses → update → delete');
  writeSkillMarkdownCreate(dir, 'alpha', sampleMarkdown);
  const raw = readSkillMarkdownRaw(dir, 'alpha');
  assert(raw === sampleMarkdown, 'raw round-trip');
  const loader = new SkillLoader(dir);
  loader.validateRawMarkdown(raw);
  const loaded = await loader.loadSkill('alpha');
  assert(!!loaded && loaded.metadata.name === 'filesystem-test-skill', 'expected loaded metadata');

  const updated = sampleMarkdown.replace('Instructions line one.', 'Updated body.');
  writeSkillMarkdownUpdate(dir, 'alpha', updated);
  assert(readSkillMarkdownRaw(dir, 'alpha') === updated, 'updated raw');

  deleteSkillDirectory(dir, 'alpha');
  throws(() => readSkillMarkdownRaw(dir, 'alpha'), 'not found');
  console.log('✓ Passed\n');

  console.log('Test: create duplicate throws');
  writeSkillMarkdownCreate(dir, 'beta', sampleMarkdown);
  throws(() => writeSkillMarkdownCreate(dir, 'beta', sampleMarkdown), 'already exists');
  deleteSkillDirectory(dir, 'beta');
  console.log('✓ Passed\n');

  console.log('Test: writeSkillMarkdownUpdate missing skill');
  throws(() => writeSkillMarkdownUpdate(dir, 'missing', sampleMarkdown), 'not found');
  console.log('✓ Passed\n');

  console.log('Test: validateRawMarkdown rejects bad frontmatter');
  throws(() => new SkillLoader(dir).validateRawMarkdown('no frontmatter'), 'frontmatter');
  console.log('✓ Passed\n');

  fs.rmSync(dir, { recursive: true, force: true });

  console.log('SkillFilesystem tests passed.');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
