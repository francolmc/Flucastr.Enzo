export type NormalizedErrorCode =
  | 'TOOL_VALIDATION_ERROR'
  | 'TOOL_EXECUTION_ERROR'
  | 'MCP_EXECUTION_ERROR'
  | 'PROVIDER_CIRCUIT_OPEN'
  | 'PROVIDER_RETRY_EXHAUSTED'
  | 'UNKNOWN_ERROR';

export interface NormalizedError {
  code: NormalizedErrorCode;
  source: 'tool' | 'mcp' | 'provider' | 'orchestrator';
  retryable: boolean;
  message: string;
  technicalMessage: string;
}

export function normalizeError(error: unknown, source: NormalizedError['source']): NormalizedError {
  const technicalMessage = error instanceof Error ? error.message : String(error);
  const lower = technicalMessage.toLowerCase();

  if (lower.includes('circuit open')) {
    return {
      code: 'PROVIDER_CIRCUIT_OPEN',
      source: 'provider',
      retryable: true,
      message: 'Provider temporary unavailable, trying fallback.',
      technicalMessage,
    };
  }

  if (lower.includes('retry') && lower.includes('exhaust')) {
    return {
      code: 'PROVIDER_RETRY_EXHAUSTED',
      source: 'provider',
      retryable: true,
      message: 'Provider retries exhausted.',
      technicalMessage,
    };
  }

  if (source === 'mcp') {
    return {
      code: 'MCP_EXECUTION_ERROR',
      source,
      retryable: true,
      message: 'MCP tool execution failed.',
      technicalMessage,
    };
  }

  if (source === 'tool') {
    return {
      code: 'TOOL_EXECUTION_ERROR',
      source,
      retryable: false,
      message: 'Tool execution failed.',
      technicalMessage,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    source,
    retryable: false,
    message: 'Unexpected error.',
    technicalMessage,
  };
}
