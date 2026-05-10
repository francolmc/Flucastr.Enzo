/**
 * Tracks iteration progress to distinguish between genuine multi-step tasks
 * and stagnation (repeated errors or lack of progress).
 */

export interface ProgressSignature {
  /** What action was attempted in this iteration */
  actionIntent: string;

  /** Type of outcome from the action */
  outcomeType: 'success' | 'partial' | 'error' | 'no_change';

  /** Hash of the output (for detecting repetition) */
  outputHash: string;

  /** Score 0-1 indicating how much novel information was added */
  novelInformationScore: number;
}

export interface ContinueDecision {
  continue: boolean;
  reason: 'progress_healthy' | 'stagnation_detected' | 'max_iterations' | 'task_complete';
  stagnationPattern?: string;
}

export class IterationProgressTracker {
  private signatures: ProgressSignature[] = [];
  private stagnationWindow = 3;

  record(signature: ProgressSignature): void {
    this.signatures.push(signature);
  }

  /**
   * Detects if the loop is stuck:
   * - Same error repeated
   * - Same action with same result (infinite loop)
   * - No new information gained
   */
  isStagnant(): boolean {
    if (this.signatures.length < this.stagnationWindow) {
      return false;
    }

    const recent = this.signatures.slice(-this.stagnationWindow);

    const allErrors = recent.every((s) => s.outcomeType === 'error');
    if (allErrors) {
      return true;
    }

    const sameIntent = recent.every((s) => s.actionIntent === recent[0].actionIntent);
    const sameOutcome = recent.every((s) => s.outputHash === recent[0].outputHash);
    if (sameIntent && sameOutcome) {
      return true;
    }

    const noNovelInfo = recent.every((s) => s.novelInformationScore < 0.1);
    if (noNovelInfo) {
      return true;
    }

    return false;
  }

  /**
   * Describes the detected stagnation pattern for logging/debugging.
   */
  describeStagnationPattern(): string {
    if (this.signatures.length < this.stagnationWindow) {
      return 'Insufficient iterations to detect pattern';
    }

    const recent = this.signatures.slice(-this.stagnationWindow);

    const allErrors = recent.every((s) => s.outcomeType === 'error');
    if (allErrors) {
      return `Repeated errors: ${recent[0].actionIntent} failing consistently`;
    }

    const sameIntent = recent.every((s) => s.actionIntent === recent[0].actionIntent);
    const sameOutcome = recent.every((s) => s.outputHash === recent[0].outputHash);
    if (sameIntent && sameOutcome) {
      return `Loop: trying ${recent[0].actionIntent} repeatedly without success`;
    }

    const noNovelInfo = recent.every((s) => s.novelInformationScore < 0.1);
    if (noNovelInfo) {
      return 'No new information gained in recent iterations';
    }

    return 'Unknown stagnation pattern';
  }

  /**
   * Checks if recent iterations show healthy progress.
   */
  hasHealthyProgress(): boolean {
    if (this.signatures.length < 2) {
      return true;
    }

    const last = this.signatures[this.signatures.length - 1];
    return last.outcomeType === 'success' && last.novelInformationScore > 0.3;
  }

  /**
   * Determines whether to continue iterating based on progress analysis.
   */
  shouldContinue(maxIterations: number, currentIteration: number): ContinueDecision {
    if (currentIteration >= maxIterations) {
      return { continue: false, reason: 'max_iterations' };
    }

    if (this.isStagnant()) {
      return {
        continue: false,
        reason: 'stagnation_detected',
        stagnationPattern: this.describeStagnationPattern(),
      };
    }

    if (this.hasHealthyProgress()) {
      return { continue: true, reason: 'progress_healthy' };
    }

    return { continue: true, reason: 'progress_healthy' };
  }

  /**
   * Checks if we should extend the iteration limit for a genuinely complex task.
   */
  shouldExtendLimit(currentLimit: number, currentIteration: number): boolean {
    if (currentIteration < currentLimit - 1) {
      return false;
    }
    return this.hasHealthyProgress();
  }

  getRecentSignatures(count = 3): ProgressSignature[] {
    return this.signatures.slice(-count);
  }

  getAllSignatures(): ProgressSignature[] {
    return [...this.signatures];
  }

  getHistory(): ProgressSignature[] {
    return [...this.signatures];
  }
}

/**
 * Computes a simple hash for detecting repeated outputs.
 */
export function quickHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

/**
 * Calculates a novelty score by comparing output against accumulated context.
 * Returns 0-1 where 1 means completely novel and 0 means already known.
 */
export function calculateNoveltyScore(output: string, context: string): number {
  if (!output || output.length === 0) {
    return 0;
  }
  if (!context || context.length === 0) {
    return 1;
  }

  const outputWords = new Set(output.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const contextWords = new Set(context.toLowerCase().split(/\s+/).filter((w) => w.length > 3));

  if (outputWords.size === 0) {
    return 0;
  }

  let novelCount = 0;
  for (const word of outputWords) {
    if (!contextWords.has(word)) {
      novelCount++;
    }
  }

  return novelCount / outputWords.size;
}

/**
 * Determines the outcome type based on output text analysis.
 */
export function determineOutcomeType(output: string, hasError: boolean): ProgressSignature['outcomeType'] {
  if (hasError) {
    return 'error';
  }

  const trimmed = output?.trim() ?? '';
  if (trimmed.length === 0) {
    return 'no_change';
  }

  if (trimmed.length < 100) {
    return 'partial';
  }

  return 'success';
}
