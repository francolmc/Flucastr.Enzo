import { resolve, sep } from 'path';

/**
 * Canonical workspace root used by read/write/shell tools when the host passes the same path.
 */
export function resolveWorkspaceRoot(explicit?: string): string {
  return resolve(explicit ?? process.env.ENZO_WORKSPACE_PATH ?? './workspace');
}

/**
 * True if `resolvedTarget` is exactly `resolvedWorkspaceRoot` or a path beneath it.
 * Both arguments should be passed through `path.resolve` by callers when needed.
 */
export function isPathWithinWorkspace(resolvedTarget: string, resolvedWorkspaceRoot: string): boolean {
  const root = resolve(resolvedWorkspaceRoot);
  const target = resolve(resolvedTarget);
  if (target === root) {
    return true;
  }
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target.startsWith(prefix);
}
