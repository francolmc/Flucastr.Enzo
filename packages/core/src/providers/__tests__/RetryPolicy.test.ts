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

  console.log('\nProvider retry policy tests passed.');
}

runTests().catch((error) => {
  console.error('Provider retry policy tests failed:', error);
  process.exitCode = 1;
});
