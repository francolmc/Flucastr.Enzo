/** Parse `since` for email tools — ISO dates or relatives: today | yesterday | this week */

export function resolveSinceDate(raw: unknown, _timeZone?: string): Date | undefined {
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  if (typeof raw !== 'string') {
    const d = new Date(String(raw));
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const s = raw.trim();
  const isoTry = Date.parse(s);
  if (!Number.isNaN(isoTry)) {
    return new Date(isoTry);
  }
  const rel = s.toLowerCase();
  if (rel === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (rel === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (rel === 'this week') {
    const d = new Date();
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diffToMonday);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return undefined;
}
