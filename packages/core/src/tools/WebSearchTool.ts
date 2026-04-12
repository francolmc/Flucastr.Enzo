import { ExecutableTool, ToolResult } from './types.js';

export class WebSearchTool implements ExecutableTool {
  name = 'web_search';
  description = 'Search the internet for real-time information using Tavily';
  parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  };

  async execute(input: any): Promise<ToolResult> {
    try {
      const query = typeof input === 'string' ? input : input?.query;

      if (!query || typeof query !== 'string' || query.trim() === '') {
        return {
          success: false,
          error: 'Query must be a non-empty string',
        };
      }

      console.log(`[WebSearchTool] Searching for: "${query}"`);

      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          error: 'TAVILY_API_KEY environment variable is not set',
        };
      }

      const url = 'https://api.tavily.com/search';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          query: query.trim(),
          max_results: 5,
          include_answer: true,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error(`[WebSearchTool] API error: ${response.status} - ${errorBody}`);
        return {
          success: false,
          error: `Tavily Search API returned status ${response.status}`,
        };
      }

      const data = await response.json();

      const results = this.parseResults(data);

      console.log(`[WebSearchTool] Parsed results: ${results.length}`);

      if (results.length === 0) {
        console.warn(`[WebSearchTool] No results found for query: "${query}"`);
        return {
          success: true,
          data: {
            answer: undefined,
            results: [{
              title: 'No results found',
              url: 'https://tavily.com',
              snippet: `No results found for "${query}". Try rephrasing your search.`,
            }],
          },
        };
      }

      return {
        success: true,
        data: {
          answer: (data.answer as string) || undefined,
          results,
        },
      };
    } catch (error) {
      console.error(`[WebSearchTool] Error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseResults(data: any): Array<{ title: string; url: string; snippet: string }> {
    const results = data?.results;

    if (!Array.isArray(results) || results.length === 0) {
      return [];
    }

    return results.slice(0, 5).map((item: any) => ({
      title: item.title ?? 'No title',
      url: item.url ?? '',
      snippet: item.content ?? 'No description available',
    }));
  }
}