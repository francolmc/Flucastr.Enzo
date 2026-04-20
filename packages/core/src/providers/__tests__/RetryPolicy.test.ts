import { fetchWithRetry } from '../retry.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  console.log('Running provider retry policy tests...\n');

  // Test 1: Retry on transient HTTP status and eventually succeed.
  {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls < 3) {
        return new Response('temporary error', { status: 503, statusText: 'Service Unavailable' });
      }
      return new Response('ok', { status: 200 });
    };

    const response = await fetchWithRetry('https://example.com', {}, { fetchFn: fetchFn as any, baseDelayMs: 1 });
    assert(response.status === 200, 'Test 1 failed: expected final 200 response');
    assert(calls === 3, `Test 1 failed: expected 3 attempts, got ${calls}`);
    console.log('✓ Test 1: retries transient 5xx and succeeds');
  }

  // Test 2: Do not retry non-retryable HTTP status.
  {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return new Response('bad request', { status: 400, statusText: 'Bad Request' });
    };

    const response = await fetchWithRetry('https://example.com', {}, { fetchFn: fetchFn as any, baseDelayMs: 1 });
    assert(response.status === 400, 'Test 2 failed: expected immediate 400 response');
    assert(calls === 1, `Test 2 failed: expected 1 attempt, got ${calls}`);
    console.log('✓ Test 2: skips retries for non-retryable status');
  }

  // Test 3: Retry network errors and eventually succeed.
  {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error('socket hang up');
      }
      return new Response('ok', { status: 200 });
    };

    const response = await fetchWithRetry('https://example.com', {}, { fetchFn: fetchFn as any, baseDelayMs: 1 });
    assert(response.status === 200, 'Test 3 failed: expected final 200 response');
    assert(calls === 3, `Test 3 failed: expected 3 attempts, got ${calls}`);
    console.log('✓ Test 3: retries network errors');
  }

  // Test 4: Bubble up final error after max attempts.
  {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      throw new Error('network down');
    };

    let failedAsExpected = false;
    try {
      await fetchWithRetry('https://example.com', {}, { fetchFn: fetchFn as any, baseDelayMs: 1, maxAttempts: 3 });
    } catch (error) {
      failedAsExpected = true;
    }
    assert(failedAsExpected, 'Test 4 failed: expected fetchWithRetry to throw');
    assert(calls === 3, `Test 4 failed: expected 3 attempts, got ${calls}`);
    console.log('✓ Test 4: throws after max attempts');
  }

  // Test 5: Chaos scenario with intermittent 429 and eventual recovery.
  {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls === 1 || calls === 2) {
        return new Response('rate limited', { status: 429, statusText: 'Too Many Requests' });
      }
      return new Response('ok', { status: 200 });
    };

    const response = await fetchWithRetry('https://example.com', {}, { fetchFn: fetchFn as any, baseDelayMs: 1, maxAttempts: 5 });
    assert(response.status === 200, 'Test 5 failed: expected recovery after intermittent 429');
    assert(calls === 3, `Test 5 failed: expected 3 attempts, got ${calls}`);
    console.log('✓ Test 5: recovers from intermittent 429');
  }

  // Test 6: Chaos scenario with timeout-like network errors and eventual failure.
  {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      throw new Error('ETIMEDOUT');
    };

    let threw = false;
    try {
      await fetchWithRetry('https://example.com', {}, { fetchFn: fetchFn as any, baseDelayMs: 1, maxAttempts: 4 });
    } catch {
      threw = true;
    }
    assert(threw, 'Test 6 failed: expected timeout chaos run to throw');
    assert(calls === 4, `Test 6 failed: expected 4 attempts, got ${calls}`);
    console.log('✓ Test 6: exhausts retries on repeated timeouts');
  }

  console.log('\nProvider retry policy tests passed.');
}

runTests().catch((error) => {
  console.error('Provider retry policy tests failed:', error);
  process.exitCode = 1;
});
