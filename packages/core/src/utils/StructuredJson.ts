export interface ParsedJsonResult<T = any> {
  value: T;
  raw: string;
  repaired: boolean;
}

export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString && ch === '\\') {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1).trim();
      }
    }
  }

  return null;
}

export function extractJsonObjects(text: string): string[] {
  const matches: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const chunk = text.slice(cursor);
    const found = extractFirstJsonObject(chunk);
    if (!found) break;

    matches.push(found);
    const index = chunk.indexOf(found);
    if (index < 0) break;
    cursor += index + found.length;
  }

  return matches;
}

export function repairJsonString(json: string): string {
  const repairedKeys = json
    .replace(/"(\w+):\{/g, '"$1":{')
    .replace(/\{(\w+):/g, '{"$1":')
    .replace(/,\s*(\w+):/g, ', "$1":')
    .replace(/:\s*'([^']*)'/g, ': "$1"');

  const lastBrace = repairedKeys.lastIndexOf('}');
  return lastBrace >= 0 ? repairedKeys.slice(0, lastBrace + 1) : repairedKeys;
}

export function parseFirstJsonObject<T = any>(
  text: string,
  options?: { tryRepair?: boolean }
): ParsedJsonResult<T> | null {
  const candidate = extractFirstJsonObject(text);
  if (!candidate) return null;

  try {
    return {
      value: JSON.parse(candidate) as T,
      raw: candidate,
      repaired: false,
    };
  } catch {
    if (!options?.tryRepair) return null;
    const repaired = repairJsonString(candidate);
    try {
      return {
        value: JSON.parse(repaired) as T,
        raw: repaired,
        repaired: true,
      };
    } catch {
      return null;
    }
  }
}
