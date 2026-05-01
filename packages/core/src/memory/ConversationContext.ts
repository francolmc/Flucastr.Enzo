import type { Message } from '../providers/types.js';
import type { MessageRecord } from './types.js';

export type ConversationFlowKind = 'follow_up' | 'topic_shift' | 'new_topic';

/** Approximate tokenizer — good enough for budgeting (mixed ES/EN). */
export function estimateTextTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 3.5));
}

export interface ConversationContext {
  /** System blocks appended after each phase’s own system prompt (profile, memories, summary, flow). */
  continuitySystemBlocks: string[];
  /** Dialogue turns visible within the token budget (chronological). */
  recentTurns: Message[];
  recentRecords: MessageRecord[];
  droppedRecords: MessageRecord[];
  droppedTurns: number;
  estimatedTokensRecent: number;
  estimatedTokensContinuity: number;
  summaryUsed: boolean;
  rollingSummaryText?: string;
  flowKind: ConversationFlowKind;
  flowConfidence: number;
  openThreadHint?: string;
}

export interface BuildConversationContextInput {
  records: MessageRecord[];
  profileMemoryBlock?: string;
  rollingSummary?: string;
  flowBlock?: string;
  budgetTokens: number;
  reservedForResponse: number;
  flowKind: ConversationFlowKind;
  flowConfidence: number;
  openThreadHint?: string;
}

export function buildConversationContext(input: BuildConversationContextInput): ConversationContext {
  const blocks: string[] = [];
  if (input.profileMemoryBlock?.trim()) {
    blocks.push(input.profileMemoryBlock.trim());
  }
  if (input.rollingSummary?.trim()) {
    blocks.push(
      `RESUMEN DE LO YA CONVERSADO (anterior a los turnos visibles):\n${input.rollingSummary.trim()}`
    );
  }
  if (input.flowBlock?.trim()) {
    blocks.push(input.flowBlock.trim());
  }

  let continuityTokens = 0;
  for (const b of blocks) {
    continuityTokens += estimateTextTokens(b);
  }

  const available = Math.max(0, input.budgetTokens - input.reservedForResponse - continuityTokens);

  const dialogueRecords = input.records.filter((r) => r.role === 'user' || r.role === 'assistant');

  const recent: MessageRecord[] = [];
  let used = 0;

  for (let i = dialogueRecords.length - 1; i >= 0; i--) {
    const r = dialogueRecords[i]!;
    const t = estimateTextTokens(r.content ?? '');
    if (used + t > available && recent.length >= 1) {
      break;
    }
    recent.unshift(r);
    used += t;
  }

  const recentIds = new Set(recent.map((r) => r.id));
  const dropped = dialogueRecords.filter((r) => !recentIds.has(r.id));

  const recentTurns: Message[] = recent.map((r) => ({
    role: r.role,
    content: r.content,
  }));

  return {
    continuitySystemBlocks: blocks,
    recentTurns,
    recentRecords: recent,
    droppedRecords: dropped,
    droppedTurns: dropped.length,
    estimatedTokensRecent: used,
    estimatedTokensContinuity: continuityTokens,
    summaryUsed: !!input.rollingSummary?.trim(),
    rollingSummaryText: input.rollingSummary,
    flowKind: input.flowKind,
    flowConfidence: input.flowConfidence,
    openThreadHint: input.openThreadHint,
  };
}

/** Merge continuity blocks + dialogue into a single message list for LLM calls. */
export function mergeHistoryForModel(
  continuitySystemBlocks: string[],
  recentTurns: Message[],
  currentUserMessage: string
): Message[] {
  const systems = continuitySystemBlocks.map((content) => ({ role: 'system' as const, content }));
  return [...systems, ...recentTurns, { role: 'user' as const, content: currentUserMessage }];
}
