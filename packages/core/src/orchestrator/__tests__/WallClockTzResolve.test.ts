import {
  parseExplicitUtcOffsetLabelToTimeZoneId,
  resolvePreferredWallClockTimeZoneId,
} from '../runtimeHostContext.js';

function assertEq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`${msg} (expected ${String(b)}, got ${String(a)})`);
}

function runTests(): void {
  console.log('WallClockTzResolve tests...\n');

  assertEq(parseExplicitUtcOffsetLabelToTimeZoneId('UTC-3'), 'Etc/GMT+3', 'UTC-3 → Etc/GMT+3');
  assertEq(parseExplicitUtcOffsetLabelToTimeZoneId('gmt+2'), 'Etc/GMT-2', 'GMT+2 → Etc/GMT-2');
  assertEq(parseExplicitUtcOffsetLabelToTimeZoneId('UTC+0'), 'Etc/UTC', 'UTC+0');

  const prev = process.env.ENZO_KEEP_IANA_SANTIAGO;
  delete process.env.ENZO_KEEP_IANA_SANTIAGO;
  try {
    assertEq(
      resolvePreferredWallClockTimeZoneId('America/Santiago'),
      'Etc/GMT+3',
      'Santiago mainland → civil UTC-3 mapping'
    );
  } finally {
    if (prev === undefined) delete process.env.ENZO_KEEP_IANA_SANTIAGO;
    else process.env.ENZO_KEEP_IANA_SANTIAGO = prev;
  }

  process.env.ENZO_KEEP_IANA_SANTIAGO = 'true';
  try {
    assertEq(
      resolvePreferredWallClockTimeZoneId('America/Santiago'),
      'America/Santiago',
      'escape hatch keeps IANA Santiago'
    );
  } finally {
    delete process.env.ENZO_KEEP_IANA_SANTIAGO;
  }

  const d = new Date('2026-05-01T18:50:00.000Z');
  const hhmm = new Intl.DateTimeFormat('es-CL', {
    timeZone: resolvePreferredWallClockTimeZoneId('America/Santiago'),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  assertEq(hhmm, '15:50', '18:50Z should read 15:50 under resolved Chile civil offset');

  console.log('WallClockTzResolve tests passed.');
}

try {
  runTests();
} catch (e) {
  console.error(e);
  process.exit(1);
}
