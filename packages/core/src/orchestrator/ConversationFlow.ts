import type { Message } from '../providers/types.js';
import type { ConversationFlowKind } from '../memory/ConversationContext.js';

export type { ConversationFlowKind } from '../memory/ConversationContext.js';

export interface FlowDetection {
  kind: ConversationFlowKind;
  confidence: number;
}

/**
 * Structural follow-up vs topic shift detection — no language-specific keywords.
 * Uses only message length and dialogue history as signals.
 * The LLM has full conversation context and handles semantic flow detection.
 */
export function detectFollowUp(userMessage: string, recentDialogue: Message[]): FlowDetection {
  const m = userMessage.trim();
  if (recentDialogue.length === 0) {
    return { kind: 'new_topic', confidence: 0.75 };
  }
  const short = m.length < 48 && !/[.!?]{2,}/.test(m);
  if (short) {
    return { kind: 'follow_up', confidence: 0.60 };
  }
  return { kind: 'new_topic', confidence: 0.45 };
}

/** One–two line hint about the last visible exchange (for anchoring follow-ups). */
export function summarizeOpenThread(recentDialogue: Message[]): string | undefined {
  if (recentDialogue.length === 0) return undefined;
  const rev = [...recentDialogue].reverse();
  const lastAssistant = rev.find((x) => x.role === 'assistant');
  const lastUser = rev.find((x) => x.role === 'user');
  const lines: string[] = [];
  if (lastAssistant) {
    const snippet = String(lastAssistant.content ?? '')
      .slice(0, 220)
      .replace(/\s+/g, ' ')
      .trim();
    if (snippet) lines.push(`Last assistant message (excerpt): ${snippet}`);
  }
  if (lastUser) {
    const snippet = String(lastUser.content ?? '')
      .slice(0, 160)
      .replace(/\s+/g, ' ')
      .trim();
    if (snippet) lines.push(`Last user message (excerpt): ${snippet}`);
  }
  if (lines.length === 0) return undefined;
  return lines.join('\n');
}

export function buildConversationFlowBlock(flow: FlowDetection, openThread?: string): string {
  const parts = [
    'CONVERSATION FLOW HINTS:',
    `- Detected intent: ${flow.kind} (confidence: ${flow.confidence.toFixed(2)})`,
    '- If follow_up: stay anchored to the latest request and visible dialogue; do not restart unrelated topics.',
    '- If topic_shift: treat the message as a new focus; acknowledge the pivot briefly if it helps.',
    '- If new_topic: answer the question directly without assuming unstated prior context.',
  ];
  if (openThread) {
    parts.push(`OPEN THREAD:\n${openThread}`);
  }
  return parts.join('\n');
}
