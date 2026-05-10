import assert from 'node:assert/strict';
import {
  IterationProgressTracker,
  quickHash,
  calculateNoveltyScore,
  determineOutcomeType,
  type ProgressSignature,
} from '../IterationProgressTracker.js';

export async function runIterationProgressTrackerTests(): Promise<void> {
  console.log('IterationProgressTracker tests...\n');

  // Test quickHash
  console.log('Testing quickHash...');
  const hash1 = quickHash('test string');
  const hash2 = quickHash('test string');
  const hash3 = quickHash('different string');
  assert.equal(hash1, hash2, 'Same string should produce same hash');
  assert.notEqual(hash1, hash3, 'Different strings should produce different hashes');
  assert.equal(typeof hash1, 'string', 'Hash should be a string');
  assert.ok(hash1.length > 0, 'Hash should not be empty');
  console.log('✓ quickHash tests passed');

  // Test determineOutcomeType
  console.log('Testing determineOutcomeType...');
  // When hasError is true, always returns 'error'
  assert.equal(determineOutcomeType('any text', true), 'error');
  assert.equal(determineOutcomeType('', true), 'error');
  // When hasError is false, based on output length
  assert.equal(determineOutcomeType('a'.repeat(100), false), 'success');
  assert.equal(determineOutcomeType('operation completed', false), 'partial');
  assert.equal(determineOutcomeType('error: file not found', false), 'partial'); // Short text, not hasError
  assert.equal(determineOutcomeType('partial match found', false), 'partial');
  assert.equal(determineOutcomeType('', false), 'no_change');
  assert.equal(determineOutcomeType('   ', false), 'no_change');
  console.log('✓ determineOutcomeType tests passed');

  // Test calculateNoveltyScore
  console.log('Testing calculateNoveltyScore...');
  const context = 'existing context data here';
  const novelText = 'brand new unique information never seen before xyz123';
  const similarText = 'existing context data here with some addition';
  const duplicateText = 'existing context data here';
  
  const novelScore = calculateNoveltyScore(novelText, context);
  const similarScore = calculateNoveltyScore(similarText, context);
  const duplicateScore = calculateNoveltyScore(duplicateText, context);
  
  assert.ok(novelScore > similarScore, 'Novel text should have higher score than similar');
  assert.ok(similarScore > duplicateScore, 'Similar text should have higher score than duplicate');
  assert.ok(duplicateScore < 0.1, 'Duplicate text should have very low score');
  assert.ok(novelScore > 0.5, 'Novel text should have high score');
  console.log('✓ calculateNoveltyScore tests passed');

  // Test basic tracker functionality
  console.log('Testing IterationProgressTracker basics...');
  const tracker = new IterationProgressTracker();
  
  const sig1: ProgressSignature = {
    actionIntent: 'read_file',
    outcomeType: 'success',
    outputHash: quickHash('file content'),
    novelInformationScore: 0.8,
  };
  
  tracker.record(sig1);
  assert.equal(tracker.getHistory().length, 1, 'Should have 1 signature recorded');
  
  // With less than 3 signatures, should not be stagnant
  assert.equal(tracker.isStagnant(), false, 'Should not be stagnant with < 3 signatures');
  assert.equal(tracker.hasHealthyProgress(), true, 'Should have healthy progress with first signature');
  console.log('✓ Basic tracker tests passed');

  // Test stagnation detection - 3 errors in a row
  console.log('Testing stagnation detection (3 errors)...');
  const errorTracker = new IterationProgressTracker();
  
  for (let i = 0; i < 3; i++) {
    errorTracker.record({
      actionIntent: 'read_file',
      outcomeType: 'error',
      outputHash: quickHash(`error ${i}`),
      novelInformationScore: 0,
    });
  }
  
  assert.equal(errorTracker.isStagnant(), true, 'Should detect stagnation with 3 errors');
  const decision = errorTracker.shouldContinue(8, 3);
  assert.equal(decision.continue, false, 'Should not continue after stagnation');
  assert.equal(decision.reason, 'stagnation_detected');
  assert.ok(decision.stagnationPattern, 'Should describe stagnation pattern');
  console.log('✓ Error stagnation tests passed');

  // Test stagnation detection - same action same result
  console.log('Testing stagnation detection (repeated action)...');
  const repeatTracker = new IterationProgressTracker();
  const sameHash = quickHash('same result');
  
  for (let i = 0; i < 3; i++) {
    repeatTracker.record({
      actionIntent: 'execute_command',
      outcomeType: 'success',
      outputHash: sameHash,
      novelInformationScore: 0.05, // Low novelty
    });
  }
  
  assert.equal(repeatTracker.isStagnant(), true, 'Should detect stagnation with repeated action+result');
  console.log('✓ Repeated action stagnation tests passed');

  // Test stagnation detection - no novel information
  console.log('Testing stagnation detection (no novel info)...');
  const noInfoTracker = new IterationProgressTracker();
  
  for (let i = 0; i < 3; i++) {
    noInfoTracker.record({
      actionIntent: `action_${i}`,
      outcomeType: 'success',
      outputHash: quickHash(`result ${i}`),
      novelInformationScore: 0.02, // Very low novelty
    });
  }
  
  assert.equal(noInfoTracker.isStagnant(), true, 'Should detect stagnation with no novel information');
  console.log('✓ No novel info stagnation tests passed');

  // Test healthy progress detection
  console.log('Testing healthy progress detection...');
  const healthyTracker = new IterationProgressTracker();
  
  for (let i = 0; i < 3; i++) {
    healthyTracker.record({
      actionIntent: `step_${i}`,
      outcomeType: 'success',
      outputHash: quickHash(`new info ${i}`),
      novelInformationScore: 0.5 + (i * 0.1), // Increasing novelty
    });
  }
  
  assert.equal(healthyTracker.isStagnant(), false, 'Should not be stagnant with healthy progress');
  assert.equal(healthyTracker.hasHealthyProgress(), true, 'Should have healthy progress');
  
  const healthyDecision = healthyTracker.shouldContinue(8, 3);
  assert.equal(healthyDecision.continue, true, 'Should continue with healthy progress');
  assert.equal(healthyDecision.reason, 'progress_healthy');
  console.log('✓ Healthy progress tests passed');

  // Test limit extension
  console.log('Testing limit extension...');
  const extendTracker = new IterationProgressTracker();
  
  // Add successful progress
  extendTracker.record({
    actionIntent: 'step_1',
    outcomeType: 'success',
    outputHash: quickHash('result 1'),
    novelInformationScore: 0.6,
  });
  extendTracker.record({
    actionIntent: 'step_2',
    outcomeType: 'success',
    outputHash: quickHash('result 2'),
    novelInformationScore: 0.7,
  });
  
  // Should extend when at limit - 1 with healthy progress
  assert.equal(extendTracker.shouldExtendLimit(8, 7), true, 'Should extend limit at iteration 7/8');
  assert.equal(extendTracker.shouldExtendLimit(8, 6), false, 'Should not extend before limit - 1');
  assert.equal(extendTracker.shouldExtendLimit(8, 8), true, 'Should extend at limit with healthy progress');
  console.log('✓ Limit extension tests passed');

  // Test mixed progress (some errors, some success)
  console.log('Testing mixed progress...');
  const mixedTracker = new IterationProgressTracker();
  
  mixedTracker.record({
    actionIntent: 'read_file',
    outcomeType: 'error',
    outputHash: quickHash('error 1'),
    novelInformationScore: 0,
  });
  mixedTracker.record({
    actionIntent: 'web_search',
    outcomeType: 'success',
    outputHash: quickHash('search results'),
    novelInformationScore: 0.8,
  });
  mixedTracker.record({
    actionIntent: 'read_file',
    outcomeType: 'success',
    outputHash: quickHash('file content'),
    novelInformationScore: 0.6,
  });
  
  assert.equal(mixedTracker.isStagnant(), false, 'Should not be stagnant with mixed progress');
  assert.equal(mixedTracker.hasHealthyProgress(), true, 'Should have healthy progress after recovery');
  console.log('✓ Mixed progress tests passed');

  // Test describeStagnationPattern
  console.log('Testing stagnation pattern description...');
  const descTracker = new IterationProgressTracker();
  
  for (let i = 0; i < 3; i++) {
    descTracker.record({
      actionIntent: 'read_file',
      outcomeType: 'error',
      outputHash: quickHash('file not found'),
      novelInformationScore: 0,
    });
  }
  
  const pattern = descTracker.describeStagnationPattern();
  assert.ok(pattern.includes('error'), 'Pattern should mention errors');
  assert.ok(pattern.includes('read_file'), 'Pattern should mention the action');
  console.log('✓ Stagnation pattern description tests passed');

  // Test max iterations reached
  console.log('Testing max iterations check...');
  const maxTracker = new IterationProgressTracker();
  
  maxTracker.record({
    actionIntent: 'action',
    outcomeType: 'success',
    outputHash: quickHash('result'),
    novelInformationScore: 0.5,
  });
  
  const maxDecision = maxTracker.shouldContinue(5, 5);
  assert.equal(maxDecision.continue, false, 'Should not continue at max iterations');
  assert.equal(maxDecision.reason, 'max_iterations');
  console.log('✓ Max iterations tests passed');

  // Test empty tracker
  console.log('Testing empty tracker...');
  const emptyTracker = new IterationProgressTracker();
  assert.equal(emptyTracker.isStagnant(), false, 'Empty tracker should not be stagnant');
  assert.equal(emptyTracker.hasHealthyProgress(), true, 'Empty tracker should report healthy (no data)');
  assert.equal(emptyTracker.getHistory().length, 0, 'Empty tracker should have no history');
  console.log('✓ Empty tracker tests passed');

  // Test large window (more than 3 signatures)
  console.log('Testing large window behavior...');
  const largeTracker = new IterationProgressTracker();
  
  // Add 5 successful iterations
  for (let i = 0; i < 5; i++) {
    largeTracker.record({
      actionIntent: `step_${i}`,
      outcomeType: 'success',
      outputHash: quickHash(`result ${i}`),
      novelInformationScore: 0.4,
    });
  }
  
  // Last 3 are successful, so not stagnant
  assert.equal(largeTracker.isStagnant(), false, 'Should not be stagnant with recent success');
  
  // Now add 3 errors at the end
  for (let i = 0; i < 3; i++) {
    largeTracker.record({
      actionIntent: 'failing_action',
      outcomeType: 'error',
      outputHash: quickHash(`error ${i}`),
      novelInformationScore: 0,
    });
  }
  
  // Now last 3 are errors, should be stagnant
  assert.equal(largeTracker.isStagnant(), true, 'Should detect stagnation in recent window despite prior progress');
  console.log('✓ Large window tests passed');

  console.log('\n✅ All IterationProgressTracker tests passed!');
}

void runIterationProgressTrackerTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
