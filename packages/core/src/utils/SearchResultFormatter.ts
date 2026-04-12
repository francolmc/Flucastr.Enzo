export interface WebSearchData {
  answer?: string;
  results?: Array<{ title: string; snippet: string; url: string }>;
}

/**
 * Formats web search results as readable text for LLM synthesis.
 * - 'full': wide spacing, for SIMPLE path synthesis prompt
 * - 'compact': one line per source, for COMPLEX accumulatedContext
 */
export function formatSearchResults(data: WebSearchData, style: 'full' | 'compact' = 'full'): string {
  const parts: string[] = [];

  if (data.answer) {
    parts.push(style === 'full'
      ? `RESPUESTA DIRECTA:\n${data.answer}`
      : `RESPUESTA: ${data.answer}`);
  }

  if (Array.isArray(data.results) && data.results.length > 0) {
    if (style === 'full') parts.push('FUENTES:');
    data.results.forEach((r, i) => {
      parts.push(style === 'full'
        ? `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`
        : `${i + 1}. ${r.title} — ${r.snippet} [${r.url}]`);
    });
  }

  return parts.join('\n\n');
}
