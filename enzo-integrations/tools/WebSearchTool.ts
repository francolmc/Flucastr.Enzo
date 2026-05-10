import { ExecutableTool, ToolResult } from './types.js';

type TavilyResponse = {
  results?: Array<{ title?: string; url?: string; content?: string }>;
};

export class WebSearchTool implements ExecutableTool {
  name = 'web_search';
  description =
    'Search the internet for current information. Returns relevant results with titles, URLs and summaries.';
  parameters = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The search query' },
    },
    required: ['query'],
  };

  constructor(private readonly apiKey: string) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = String(input.query ?? '');
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          max_results: 5,
          search_depth: 'basic',
        }),
      });

      const data = (await response.json()) as TavilyResponse;
      const results = data.results ?? [];
      if (!results.length) {
        return { success: true, output: `No results found for: ${query}` };
      }

      const output = results
        .map(
          (item, index) =>
            `${index + 1}. ${item.title ?? 'Untitled'}\n${item.url ?? ''}\n${item.content ?? ''}`
        )
        .join('\n\n');

      return { success: true, output };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}