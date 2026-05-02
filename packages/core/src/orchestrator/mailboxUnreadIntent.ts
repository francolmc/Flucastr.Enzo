import type { ConversationContext } from '../memory/ConversationContext.js';

/**
 * Narrow ES/ES+EN heuristic: user wants HOW MANY unread messages in THEIR configured mailboxes
 * (Enzo reads via OAuth/IMAP tools — never "check it yourself").
 * Kept structural (unread + quantity/provider), not broad keyword lists per routing rules.
 */
export function messageLooksLikeMailboxUnreadStatsQuery(raw: string): boolean {
  const m = raw.trim();
  if (!m) return false;
  const n = m.toLowerCase();

  const unreadCue =
    /\b(?:correos?\s+sin\s+leer|mensajes?\s+sin\s+leer|sin\s+leer\b|no\s+le[ií](?:dos|das)\b)/iu.test(m) ||
    /\b(?:unread|non[-\s]?lus\b|messages?\s+non[-\s]?lus)\b/iu.test(n);

  const quantityCue =
    /\b(?:cu[aá]nt(?:os|as)\b|cuantos\b|cuantas\b|how\s+many\b|n[uú]mero\s+de\b|cantidad\s+de)/iu.test(m) ||
    (/\b(?:cu[aá]nto|how\s+much)\b/iu.test(m) && unreadCue);

  const mailboxCue =
    /\b(?:gmail|google\s+mail|outlook|hotmail|microsoft\s*(?:365|office)?|exchange|imap|bandeja|inbox)\b/iu.test(m) ||
    /\b(?:emails?\s+from|from\s+gmail|from\s+outlook|de\s+gmail|de\s+outlook)\b/iu.test(n);

  if (!unreadCue) return false;
  return quantityCue || mailboxCue;
}

/**
 * Listing or summarizing real unread threads (needs read_email unread_only — no invented subjects).
 */
export function messageLooksLikeMailboxUnreadSummaryQuery(raw: string): boolean {
  const m = raw.trim();
  if (!m) return false;

  const summaryCue =
    /\b(?:resum(?:ir|e|eme|emos|imos|iendo)?|summari(?:ze|sing|sed)?|lista(?:do|r)?(?:\s+de)?|mostrar|mu[eé]str(?:ame|ar)?|quiero\s+saber\s+qu[eé])\b/iu.test(
      m
    ) || /\b(?:importantes?|relevantes?|prioridad|urgentes?|prioritari| destacad)\b/iu.test(m);

  const unreadCue =
    /\b(?:sin\s+leer|no\s+le[ií](?:dos|das)\b|mensajes?\s+sin\s+leer|correos?\s+sin\s+leer|unread)\b/iu.test(m);

  const mailboxCue =
    /\b(?:gmail|outlook|microsoft|hotmail|correo|mailbox|bandeja|inbox)\b/iu.test(m);

  const listUnreadCue =
    /\b(?:list|show|enumer|detall)\b/iu.test(m) && unreadCue && mailboxCue;

  if (summaryCue && unreadCue && mailboxCue) return true;
  if (summaryCue && unreadCue) return true;
  if (listUnreadCue) return true;
  return false;
}

/**
 * Prior USER lines from {@link ConversationContext} plus this turn (`originalMessage`, `message`)
 * so short follow-ups (e.g. "sí, tienes acceso a mis correos") still match unread-summary cues from earlier in the thread.
 */
export function mailboxUnreadSummaryLockCorpus(input: {
  message: string;
  originalMessage?: string;
  conversation?: ConversationContext;
  maxPriorUserTurns?: number;
}): string {
  const maxTurns = input.maxPriorUserTurns ?? 12;
  const userLines: string[] = [];
  if (input.conversation?.recentTurns) {
    for (const m of input.conversation.recentTurns) {
      if (m.role === 'user') {
        const t = String(m.content ?? '').trim();
        if (t) userLines.push(t);
      }
    }
  }
  const tail = [input.originalMessage, input.message]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter(Boolean);

  const prior = userLines.slice(-maxTurns);
  return [...prior, ...tail].join('\n').trimEnd();
}
