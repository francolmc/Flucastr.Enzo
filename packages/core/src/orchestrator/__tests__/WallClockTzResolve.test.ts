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

  assertEq(
    resolvePreferredWallClockTimeZoneId('America/New_York'),
    'America/New_York',
    'IANA zone passes through unchanged'
  );

  assertEq(
    resolvePreferredWallClockTimeZoneId('UTC-3'),
    'Etc/GMT+3',
    'UTC-3 label resolves to Etc/GMT+3 via resolvePreferred'
  );

  const d = new Date('2026-05-01T18:50:00.000Z');
  const hhmm = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvePreferredWallClockTimeZoneId('UTC-3'),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  assertEq(hhmm, '15:50', '18:50Z should read 15:50 under UTC-3');

  console.log('WallClockTzResolve tests passed.');
}

try {
  runTests();
} catch (e) {
  console.error(e);
  process.exit(1);
}
