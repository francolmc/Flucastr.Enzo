import type { Message } from '../providers/types.js';
import type { ConversationFlowKind } from '../memory/ConversationContext.js';

export type { ConversationFlowKind } from '../memory/ConversationContext.js';

export interface FlowDetection {
  kind: ConversationFlowKind;
  confidence: number;
}

const TOPIC_SHIFT_RE =
  /\b(dejemos\s+eso|olvida\s+eso|cambiemos\s+de\s+tema|otro\s+tema|hablemos\s+de\s+otra\s+cosa|new\s+topic|let'?s\s+talk\s+about|switching\s+gears|moving\s+on)\b/i;

const FOLLOW_START_RE =
  /^(y\s+eso|eso\s+qu[eé]|qu[eé]\s+es\s+eso|lo\s+anterior|lo\s+de\s+antes|segu[ií]|sigue|contin[uú]a|do\s+it|proceed|go\s+ahead|what\s+about\s+that|y\s+entonces)\b/i;

/**
 * Lightweight follow-up vs topic shift detection (heuristics + regex).
 * Does not replace the model; gives explicit hints for continuity.
 */
export function detectFollowUp(userMessage: string, recentDialogue: Message[]): FlowDetection {
  const m = userMessage.trim();
  if (TOPIC_SHIFT_RE.test(m)) {
    return { kind: 'topic_shift', confidence: 0.85 };
  }
  if (recentDialogue.length === 0) {
    return { kind: 'new_topic', confidence: 0.75 };
  }
  if (FOLLOW_START_RE.test(m.trim())) {
    return { kind: 'follow_up', confidence: 0.82 };
  }
  if (
    /\b(the\s+same|that\s+folder|those\s+files|ese\s+archivo|esa\s+carpeta|eso\s+mismo|lo\s+mismo)\b/i.test(m)
  ) {
    return { kind: 'follow_up', confidence: 0.78 };
  }
  const short = m.length < 48 && !/[.!?]{2,}/.test(m);
  if (short && /\b(why|how\s+come|y\s+eso|eso)\b/i.test(m)) {
    return { kind: 'follow_up', confidence: 0.55 };
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
