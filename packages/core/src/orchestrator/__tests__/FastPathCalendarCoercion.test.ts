import { CalendarService } from '../../calendar/CalendarService.js';
import { CalendarTool } from '../../tools/CalendarTool.js';
import {
  coerceCalendarFastPathEnvelope,
  normalizeFastPathToolCall,
  validateToolInput,
} from '../amplifier/AmplifierLoopFastPathTools.js';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function runTests(): Promise<void> {
  console.log('FastPathCalendarCoercion tests...\n');

  const inner = coerceCalendarFastPathEnvelope(
    {
      action: 'tool',
      tool: 'calendar',
      from_iso: '2026-05-01T00:00:00.000Z',
      to_iso: '2026-05-01T23:59:59.999Z',
      input: {},
    } as Record<string, unknown>,
    {}
  );
  assert(inner.action === 'list', `expected inferred list action, got ${inner.action}`);
  assert(typeof inner.from_iso === 'string' && typeof inner.to_iso === 'string', 'expected iso range preserved');

  const tmp = join(tmpdir(), `enzo-cal-coerce-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  const dbPath = join(tmp, 'c.db');
  try {
    const tools = [new CalendarTool(new CalendarService(dbPath))];
    const { toolName, toolInput } = normalizeFastPathToolCall(
      {
        action: 'tool',
        tool: 'calendar',
        desde_iso: '2026-05-02T03:00:00.000Z',
        hasta_iso: '2026-05-02T06:00:00.000Z',
      },
      tools
    );
    assert(toolName === 'calendar', 'tool name calendar');
    const err = validateToolInput(toolName, toolInput, tools, undefined);
    assert(err === null, `validate should pass for hoisted synonyms: ${err}`);
    assert(toolInput.action === 'list', `action after normalize ${String(toolInput.action)}`);
    assert(toolInput.from_iso === '2026-05-02T03:00:00.000Z', 'from_iso synonym');
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log('FastPathCalendarCoercion tests passed.');
}

runTests()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
