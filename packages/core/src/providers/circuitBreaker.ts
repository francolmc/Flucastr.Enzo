type CircuitState = 'closed' | 'open' | 'half_open';

interface ProviderCircuitState {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt?: number;
}

interface CircuitMetrics {
  openedTotal: number;
  halfOpenTotal: number;
  shortCircuitTotal: number;
  recoveredTotal: number;
}

export class CircuitOpenError extends Error {
  providerName: string;
  retryAfterMs: number;

  constructor(providerName: string, retryAfterMs: number) {
    super(`Circuit open for provider "${providerName}"`);
    this.name = 'CircuitOpenError';
    this.providerName = providerName;
    this.retryAfterMs = retryAfterMs;
  }
}

const states = new Map<string, ProviderCircuitState>();
const metrics: CircuitMetrics = {
  openedTotal: 0,
  halfOpenTotal: 0,
  shortCircuitTotal: 0,
  recoveredTotal: 0,
};

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
}

const defaultOptions: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  cooldownMs: 30_000,
};

function getOrCreateState(providerName: string): ProviderCircuitState {
  const existing = states.get(providerName);
  if (existing) return existing;
  const created: ProviderCircuitState = {
    state: 'closed',
    consecutiveFailures: 0,
  };
  states.set(providerName, created);
  return created;
}

export function assertCircuitClosed(providerName: string, options?: CircuitBreakerOptions): void {
  const state = getOrCreateState(providerName);
  const mergedOptions = { ...defaultOptions, ...(options || {}) };
  if (state.state !== 'open') return;

  const elapsed = Date.now() - (state.openedAt || 0);
  if (elapsed >= mergedOptions.cooldownMs) {
    state.state = 'half_open';
    metrics.halfOpenTotal += 1;
    return;
  }

  metrics.shortCircuitTotal += 1;
  throw new CircuitOpenError(providerName, Math.max(0, mergedOptions.cooldownMs - elapsed));
}

export function registerCircuitSuccess(providerName: string): void {
  const state = getOrCreateState(providerName);
  if (state.state === 'half_open' || state.state === 'open') {
    metrics.recoveredTotal += 1;
  }
  state.state = 'closed';
  state.consecutiveFailures = 0;
  state.openedAt = undefined;
}

export function registerCircuitFailure(providerName: string, options?: CircuitBreakerOptions): void {
  const state = getOrCreateState(providerName);
  const mergedOptions = { ...defaultOptions, ...(options || {}) };
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures < mergedOptions.failureThreshold) return;

  state.state = 'open';
  state.openedAt = Date.now();
  metrics.openedTotal += 1;
}

export function getCircuitMetrics(): CircuitMetrics {
  return { ...metrics };
}
