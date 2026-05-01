import { CronExpressionParser } from 'cron-parser';

/** node-cron usa 5 campos (min hora dom mes dow); cron-parser v5 espera 6 (seg …). */
export function normalizeCronForParser(expression: string): string {
  const t = expression.trim();
  const parts = t.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 5) {
    return `0 ${t}`;
  }
  return t;
}

/**
 * Próxima fecha de disparo para una expresión alineada con node-cron (5 o 6 campos).
 * Opcional `tz` IANA (ej. America/Argentina/Buenos_Aires).
 */
export function computeCronNextRunUtcDate(
  cronExpression: string,
  opts?: { tz?: string; fromDate?: Date }
): Date | null {
  try {
    const expr = CronExpressionParser.parse(normalizeCronForParser(cronExpression), {
      currentDate: opts?.fromDate ?? new Date(),
      ...(opts?.tz?.trim() ? { tz: opts.tz.trim() } : {}),
    });
    return expr.next().toDate();
  } catch {
    return null;
  }
}
