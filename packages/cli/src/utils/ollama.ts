export interface Model {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

async function makeRequest(
  url: string,
  options?: { method?: string; body?: string }
): Promise<{ status: number; data: string }> {
  const response = await (globalThis as any).fetch(url, {
    method: options?.method || 'GET',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body,
  });

  const data = await response.text();
  return { status: response.status, data };
}

export async function checkOllamaRunning(baseUrl: string = 'http://localhost:11434'): Promise<boolean> {
  try {
    const result = await makeRequest(`${baseUrl}/api/tags`);
    return result.status === 200;
  } catch {
    return false;
  }
}

export async function listModels(baseUrl: string = 'http://localhost:11434'): Promise<Model[]> {
  try {
    const result = await makeRequest(`${baseUrl}/api/tags`);
    if (result.status !== 200) {
      throw new Error(`HTTP ${result.status}`);
    }

    const data = JSON.parse(result.data) as { models: Model[] };
    return data.models || [];
  } catch (error) {
    throw new Error(`Failed to list models: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function pullModel(
  modelName: string,
  baseUrl: string = 'http://localhost:11434',
  onProgress?: (status: string) => void
): Promise<void> {
  try {
    const response = await (globalThis as any).fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new (globalThis as any).TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const json = JSON.parse(line);
            if (json.status && onProgress) {
              onProgress(json.status);
            }
          } catch {
            // Ignore JSON parse errors
          }
        }
      }
    }

    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer);
        if (json.status && onProgress) {
          onProgress(json.status);
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  } catch (error) {
    throw new Error(`Failed to pull model: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
