import type { AssistantProfile, UserProfile } from '../config/ConfigService.js';
import type { ConversationSummaryRecord, MessageRecord } from '../memory/types.js';
import { buildConversationContext, type ConversationContext } from '../memory/ConversationContext.js';
import type { MemoryExtractor } from '../memory/MemoryExtractor.js';
import type { Message } from '../providers/types.js';
import {
  buildConversationFlowBlock,
  detectFollowUp,
  summarizeOpenThread,
} from './ConversationFlow.js';

export type PreparedConversationTurn = {
  context: ConversationContext;
  /** Sanitized KV memory block only (also embedded in `context.continuitySystemBlocks`). */
  memoryBlock: string;
  /** Same ranked memory slice injected into Amplifier delegation (`userMemories`). */
  rankedMemoryFacts: Array<{ key: string; value: string }>;
};

export type PrepareConversationBindings = {
  loadHistoryRecords(conversationId: string): Promise<MessageRecord[]>;
  getConversationSummary(conversationId: string): Promise<ConversationSummaryRecord | null>;
  getMemoryExtractor(): MemoryExtractor;
  sanitizeMemoryBlock(memoryBlock: string, assistantName: string): string;
  buildUserProfileBlock(userId: string, profile: UserProfile): string;
  buildLessonsBlock(userId: string, currentUserMessage?: string): Promise<string>;
};

export async function prepareConversationTurnContext(
  b: PrepareConversationBindings,
  params: {
    conversationId: string;
    userId: string;
    message: string;
    assistantProfile: AssistantProfile;
    userProfile: UserProfile;
  }
): Promise<PreparedConversationTurn> {
  const records = await b.loadHistoryRecords(params.conversationId);
  const rolling = await b.getConversationSummary(params.conversationId);

  const { block: rawMemoryKb, facts: rankedFacts } = await b
    .getMemoryExtractor()
    .buildRankedMemoryBlock(params.userId, params.message);
  const memoryBlock = b.sanitizeMemoryBlock(rawMemoryKb, params.assistantProfile.name);

  const [profileBlock, lessonsBlock] = await Promise.all([
    Promise.resolve(b.buildUserProfileBlock(params.userId, params.userProfile)),
    b.buildLessonsBlock(params.userId, params.message),
  ]);
  const profileMemory = [profileBlock, memoryBlock, lessonsBlock].filter(Boolean).join('\n\n');

  const dialogueFlow: Message[] = records
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .slice(-8)
    .map((r) => ({ role: r.role, content: r.content }));

  const flow = detectFollowUp(params.message, dialogueFlow);
  const openThread = summarizeOpenThread(dialogueFlow);
  const flowBlock = buildConversationFlowBlock(flow, openThread);

  const budgetTokens = Number(process.env.ENZO_CONTEXT_TOKEN_BUDGET ?? 4000);
  const reservedForResponse = Number(process.env.ENZO_CONTEXT_RESERVED_OUTPUT_TOKENS ?? 1024);

  const context = buildConversationContext({
    records,
    profileMemoryBlock: profileMemory || undefined,
    rollingSummary: rolling?.summary,
    flowBlock,
    budgetTokens: Number.isFinite(budgetTokens) ? budgetTokens : 4000,
    reservedForResponse: Number.isFinite(reservedForResponse) ? reservedForResponse : 1024,
    flowKind: flow.kind,
    flowConfidence: flow.confidence,
    openThreadHint: openThread,
  });

  return {
    context,
    memoryBlock,
    rankedMemoryFacts: rankedFacts.map((f) => ({ key: f.key, value: f.value })),
  };
}