import {
  assertCircuitClosed,
  registerCircuitFailure,
  registerCircuitSuccess,
  CircuitBreakerOptions,
} from './circuitBreaker.js';

export interface RetryableFetchOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  retryStatuses?: number[];
  fetchFn?: typeof fetch;
  providerName?: string;
  circuitBreaker?: CircuitBreakerOptions;
}

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];
const retryMetrics = {
  attemptsTotal: 0,
  recoveredTotal: 0,
  exhaustedTotal: 0,
};

function isRetryableStatus(status: number, retryStatuses: number[]): boolean {
  return retryStatuses.includes(status);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: RetryableFetchOptions
): Promise<Response> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const baseDelayMs = Math.max(10, options?.baseDelayMs ?? 250);
  const retryStatuses = options?.retryStatuses ?? DEFAULT_RETRY_STATUSES;
  const fetchFn = options?.fetchFn ?? fetch;

  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    if (options?.providerName) {
      assertCircuitClosed(options.providerName, options.circuitBreaker);
    }
    attempt += 1;
    retryMetrics.attemptsTotal += 1;

    try {
      const response = await fetchFn(url, init);
      const shouldRetry =
        !response.ok && isRetryableStatus(response.status, retryStatuses) && attempt < maxAttempts;

      if (!shouldRetry) {
        if (options?.providerName) {
          if (response.ok || !isRetryableStatus(response.status, retryStatuses)) {
            registerCircuitSuccess(options.providerName);
          } else {
            registerCircuitFailure(options.providerName, options.circuitBreaker);
          }
        }
        if (response.ok && attempt > 1) {
          retryMetrics.recoveredTotal += 1;
        }
        return response;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);
      await wait(delay);
      continue;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        if (options?.providerName) {
          registerCircuitFailure(options.providerName, options.circuitBreaker);
        }
        retryMetrics.exhaustedTotal += 1;
        throw error;
      }
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await wait(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('fetchWithRetry failed unexpectedly');
}

export function getRetryMetrics(): typeof retryMetrics {
  return { ...retryMetrics };
}
