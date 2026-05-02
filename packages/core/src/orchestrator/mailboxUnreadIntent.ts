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
