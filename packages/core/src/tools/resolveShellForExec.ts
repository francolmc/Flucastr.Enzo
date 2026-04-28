/**
 * Shell path for child_process exec/spawn on Unix when `/bin/sh` may not exist
 * (Node's default for exec is `/bin/sh -c`).
 */
export function resolveShellForExec(): string {
  return (
    [process.env.SHELL?.trim(), '/bin/bash', '/usr/bin/sh', 'sh'].find(
      (s) => typeof s === 'string' && s.length > 0
    ) ?? 'sh'
  );
}
