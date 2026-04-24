import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadFileTool } from '../ReadFileTool.js';
import { WriteFileTool } from '../WriteFileTool.js';
import { isPathWithinWorkspace, resolveWorkspaceRoot } from '../workspacePathPolicy.js';

async function runTests(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), 'enzo-ws-'));
  const nested = join(base, 'nested');
  mkdirSync(nested, { recursive: true });
  const insideFile = join(nested, 'a.md');
  writeFileSync(insideFile, 'hello', 'utf-8');

  console.log('WorkspacePathPolicy: resolveWorkspaceRoot');
  assert.equal(resolveWorkspaceRoot(base), join(base));

  console.log('WorkspacePathPolicy: isPathWithinWorkspace');
  assert.equal(isPathWithinWorkspace(insideFile, base), true);
  assert.equal(isPathWithinWorkspace(join(tmpdir(), 'other-file'), base), false);

  console.log('WriteFileTool: allows write inside workspace');
  const writeTool = new WriteFileTool(base);
  const ok = await writeTool.execute({ path: 'out/x.md', content: 'x' });
  assert.equal(ok.success, true);

  console.log('WriteFileTool: rejects outside workspace');
  const bad = await writeTool.execute({ path: '/etc/enzo-write-test-forbidden.md', content: 'x' });
  assert.equal(bad.success, false);

  console.log('ReadFileTool: absolute outside workspace allowed when not strict');
  const readLoose = new ReadFileTool(base, { strictAbsolutePaths: false });
  const r1 = await readLoose.execute({ path: insideFile });
  assert.equal(r1.success, true);

  console.log('ReadFileTool: strict absolute rejects outside');
  const readStrict = new ReadFileTool(base, { strictAbsolutePaths: true });
  const r2 = await readStrict.execute({ path: insideFile });
  assert.equal(r2.success, true);
  const r3 = await readStrict.execute({ path: join(tmpdir(), 'nope.md') });
  assert.equal(r3.success, false);

  rmSync(base, { recursive: true, force: true });
  console.log('WorkspacePathPolicy tests passed');
}

runTests().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
