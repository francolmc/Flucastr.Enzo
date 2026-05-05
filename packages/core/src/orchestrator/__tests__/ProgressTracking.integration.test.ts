import assert from 'node:assert/strict';
import {
  IterationProgressTracker,
  quickHash,
  calculateNoveltyScore,
  determineOutcomeType,
  type ProgressSignature,
} from '../IterationProgressTracker.js';

/**
 * Integration test for IterationProgressTracker.
 * Simulates realistic iteration patterns and validates tracker behavior.
 */

export async function runProgressTrackingIntegrationTests(): Promise<void> {
  console.log('ProgressTracking integration tests...\n');

  // Test 1: Simulates a healthy multi-step task with increasing progress
  console.log('Test 1: Healthy multi-step task simulation...');
  {
    const tracker = new IterationProgressTracker();
    const maxIterations = 8;

    // Simulate a task reading multiple files successfully
    const files = ['/config.json', '/data.txt', '/results.csv'];
    let iteration = 0;

    for (const file of files) {
      iteration++;
      const content = `Content of ${file} with unique data ${Math.random()}`;
      tracker.record({
        actionIntent: `read_file:${file}`,
        outcomeType: 'success',
        outputHash: quickHash(content),
        novelInformationScore: 0.6,
      });

      const decision = tracker.shouldContinue(maxIterations, iteration);
      assert.equal(decision.continue, true, `Should continue at iteration ${iteration}`);
      assert.equal(decision.reason, 'progress_healthy');
    }

    assert.equal(tracker.isStagnant(), false, 'Healthy task should not stagnate');
    assert.equal(tracker.hasHealthyProgress(), true, 'Should report healthy progress');
    console.log('✓ Healthy multi-step task works correctly');
  }

  // Test 2: Simulates a task hitting repeated errors and detecting stagnation
  console.log('Test 2: Error stagnation detection simulation...');
  {
    const tracker = new IterationProgressTracker();
    const maxIterations = 8;

    // Simulate 3 failed attempts to read a non-existent file
    let iteration = 0;
    for (let i = 0; i < 3; i++) {
      iteration++;
      tracker.record({
        actionIntent: 'read_file:/nonexistent.txt',
        outcomeType: 'error',
        outputHash: quickHash('Error: ENOENT'),
        novelInformationScore: 0,
      });
    }

    assert.equal(tracker.isStagnant(), true, 'Should detect stagnation after 3 errors');
    
    const decision = tracker.shouldContinue(maxIterations, iteration);
    assert.equal(decision.continue, false, 'Should stop on stagnation');
    assert.equal(decision.reason, 'stagnation_detected');
    assert.ok(decision.stagnationPattern?.includes('error'), 'Pattern should mention errors');
    console.log('✓ Error stagnation detected correctly');
  }

  // Test 3: Simulates infinite loop detection (same action, same result)
  console.log('Test 3: Infinite loop detection simulation...');
  {
    const tracker = new IterationProgressTracker();

    // Simulate trying the same command 3 times with same output
    const sameOutput = 'Command output: no changes';
    for (let i = 0; i < 3; i++) {
      tracker.record({
        actionIntent: 'execute_command:ls',
        outcomeType: 'success',
        outputHash: quickHash(sameOutput),
        novelInformationScore: 0.02, // Very low novelty
      });
    }

    assert.equal(tracker.isStagnant(), true, 'Should detect loop pattern');
    const pattern = tracker.describeStagnationPattern();
    assert.ok(pattern.includes('Loop'), 'Pattern should indicate loop');
    console.log('✓ Infinite loop detected correctly');
  }

  // Test 4: Simulates task recovery after error
  console.log('Test 4: Task recovery simulation...');
  {
    const tracker = new IterationProgressTracker();

    // First, an error
    tracker.record({
      actionIntent: 'read_file:/locked.txt',
      outcomeType: 'error',
      outputHash: quickHash('Permission denied'),
      novelInformationScore: 0,
    });

    // Then success with different approach
    tracker.record({
      actionIntent: 'sudo_read_file:/locked.txt',
      outcomeType: 'success',
      outputHash: quickHash('Secret content here'),
      novelInformationScore: 0.8,
    });

    // Another success
    tracker.record({
      actionIntent: 'process_content',
      outcomeType: 'success',
      outputHash: quickHash('Processed result'),
      novelInformationScore: 0.7,
    });

    assert.equal(tracker.isStagnant(), false, 'Should not stagnate after recovery');
    assert.equal(tracker.hasHealthyProgress(), true, 'Should have healthy progress');
    console.log('✓ Task recovery handled correctly');
  }

  // Test 5: Simulates dynamic limit extension
  console.log('Test 5: Dynamic limit extension simulation...');
  {
    const tracker = new IterationProgressTracker();
    const initialLimit = 8;

    // Simulate 7 iterations of healthy progress
    for (let i = 1; i <= 7; i++) {
      tracker.record({
        actionIntent: `step_${i}`,
        outcomeType: 'success',
        outputHash: quickHash(`Unique result ${i}`),
        novelInformationScore: 0.5,
      });
    }

    // At iteration 7 with healthy progress, should extend
    assert.equal(
      tracker.shouldExtendLimit(initialLimit, 7),
      true,
      'Should extend limit at iteration 7 with healthy progress'
    );

    // But not before
    assert.equal(
      tracker.shouldExtendLimit(initialLimit, 5),
      false,
      'Should not extend before limit - 1'
    );
    console.log('✓ Dynamic limit extension works correctly');
  }

  // Test 6: Simulates max iterations reached
  console.log('Test 6: Max iterations reached simulation...');
  {
    const tracker = new IterationProgressTracker();
    const maxIterations = 5;

    // Simulate 5 iterations
    for (let i = 1; i <= 5; i++) {
      tracker.record({
        actionIntent: `step_${i}`,
        outcomeType: 'success',
        outputHash: quickHash(`Result ${i}`),
        novelInformationScore: 0.4,
      });
    }

    const decision = tracker.shouldContinue(maxIterations, 5);
    assert.equal(decision.continue, false, 'Should stop at max iterations');
    assert.equal(decision.reason, 'max_iterations');
    console.log('✓ Max iterations limit enforced correctly');
  }

  // Test 7: Simulates mixed progress with eventual stagnation
  console.log('Test 7: Mixed progress with eventual stagnation...');
  {
    const tracker = new IterationProgressTracker();

    // Some healthy progress
    tracker.record({
      actionIntent: 'search',
      outcomeType: 'success',
      outputHash: quickHash('Search results A'),
      novelInformationScore: 0.6,
    });
    tracker.record({
      actionIntent: 'fetch_data',
      outcomeType: 'success',
      outputHash: quickHash('Data chunk 1'),
      novelInformationScore: 0.5,
    });

    // Then gets stuck
    for (let i = 0; i < 3; i++) {
      tracker.record({
        actionIntent: 'process_data',
        outcomeType: 'error',
        outputHash: quickHash('Processing failed'),
        novelInformationScore: 0,
      });
    }

    assert.equal(tracker.isStagnant(), true, 'Should detect stagnation in recent window');
    console.log('✓ Mixed progress with stagnation detected correctly');
  }

  // Test 8: Novelty score calculation integration
  console.log('Test 8: Novelty score integration...');
  {
    const context = 'Previous context with existing information';
    
    // New unique content should have high novelty
    const novelScore = calculateNoveltyScore(
      'Completely new information about topic XYZ that was never mentioned',
      context
    );
    
    // Similar content should have lower novelty
    const similarScore = calculateNoveltyScore(
      'Previous context with existing information and small addition',
      context
    );
    
    // Identical content should have very low novelty
    const duplicateScore = calculateNoveltyScore(context, context);
    
    assert.ok(novelScore > similarScore, 'Novel content should score higher');
    assert.ok(similarScore > duplicateScore, 'Similar content should score higher than duplicate');
    assert.ok(duplicateScore < 0.1, 'Duplicate should have very low score');
    console.log('✓ Novelty score calculation works correctly');
  }

  // Test 9: Hash collision resistance
  console.log('Test 9: Hash collision resistance...');
  {
    const hashes = new Set<string>();
    const iterations = 1000;
    
    for (let i = 0; i < iterations; i++) {
      const hash = quickHash(`test content ${i} with some randomness ${Math.random()}`);
      hashes.add(hash);
    }
    
    // Should have very few collisions for 1000 items
    const collisionRate = (iterations - hashes.size) / iterations;
    assert.ok(collisionRate < 0.01, `Hash collision rate ${collisionRate} should be < 1%`);
    console.log('✓ Hash function has good collision resistance');
  }

  console.log('\n✅ All ProgressTracking integration tests passed!');
}

void runProgressTrackingIntegrationTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
