import { Message } from '../providers/types.js';

/**
 * Extracts a file path (Unix or Windows) from a text string.
 * Falls back to a bare filename if no full path is found.
 */
export function extractFilePath(text: string): string | null {
  const unix = text.match(/(?:^|\s)(\/[^\s'"]+\/[^\s'"]+\.[a-zA-Z0-9]{1,5})(?:\s|$)/);
  const win  = text.match(/(?:^|\s)([A-Za-z]:\\[^\s'"]+\.[a-zA-Z0-9]{1,5})(?:\s|$)/);
  const name = text.match(/[\w-]+\.[a-zA-Z0-9]{1,5}/);
  return unix?.[1]?.trim() ?? win?.[1]?.trim() ?? name?.[0] ?? null;
}

/**
 * Extracts the target directory from the current message or conversation history.
 * Searches newest to oldest; requires at least 3 path segments to avoid false positives.
 */
export function extractTargetDir(message: string, history: Message[]): string | null {
  const clean = (p: string) => p.replace(/[?!,;:.]+$/, '').replace(/\/$/, '');

  const msgPaths = message.match(/(\/[^\s'"()]+)/g);
  if (msgPaths) {
    return clean(msgPaths.sort((a, b) => b.length - a.length)[0]);
  }

  for (let i = history.length - 1; i >= 0; i--) {
    const hp = String(history[i].content ?? '').match(/(\/[^\s'"()]+)/g);
    if (hp) {
      const candidate = clean(hp.sort((a, b) => b.length - a.length)[0]);
      if (candidate.split('/').length >= 3) return candidate;
    }
  }

  return null;
}
