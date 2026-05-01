import type { AssistantProfile, UserProfile } from '../config/ConfigService.js';
import type { ConversationSummaryRecord, MessageRecord } from '../memory/types.js';
import { buildConversationContext, type ConversationContext } from '../memory/ConversationContext.js';

export type PreparedConversationTurn = {
  context: ConversationContext;
  /** Sanitized KV memory block only (also embedded in `context.continuitySystemBlocks`). */
  memoryBlock: string;
};
import {
  buildConversationFlowBlock,
  detectFollowUp,
  summarizeOpenThread,
} from './ConversationFlow.js';
import type { Message } from '../providers/types.js';

export type PrepareConversationBindings = {
  loadHistoryRecords(conversationId: string): Promise<MessageRecord[]>;
  getConversationSummary(conversationId: string): Promise<ConversationSummaryRecord | null>;
  getMemoryExtractor(): { buildMemoryBlock(userId: string): Promise<string> };
  sanitizeMemoryBlock(memoryBlock: string, assistantName: string): string;
  buildUserProfileBlock(userId: string, profile: UserProfile): string;
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

  const rawMemoryBlock = await b.getMemoryExtractor().buildMemoryBlock(params.userId);
  const memoryBlock = b.sanitizeMemoryBlock(rawMemoryBlock, params.assistantProfile.name);
  const profileBlock = b.buildUserProfileBlock(params.userId, params.userProfile);
  const profileMemory = [profileBlock, memoryBlock].filter(Boolean).join('\n\n');

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

  return { context, memoryBlock };
}
