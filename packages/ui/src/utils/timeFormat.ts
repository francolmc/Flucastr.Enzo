import type { EchoResult } from '../types';

export function formatRelativeTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  const deltaMinutes = Math.floor(deltaMs / 60000);
  if (deltaMinutes < 1) return 'ahora';
  if (deltaMinutes < 60) return `hace ${deltaMinutes} min`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `hace ${deltaHours} h`;
  return new Date(timestamp).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
  });
}

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** Human label for an upcoming instant (nextRun ISO). */
export function formatUpcomingLabel(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const now = Date.now();
  const diffMs = t - now;
  if (diffMs < 0) {
    return formatRelativeTime(t);
  }
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'en menos de 1 minuto';
  if (diffMin < 60) return `en ${diffMin} minutos`;

  const target = new Date(t);
  const today0 = startOfDay(new Date());
  const target0 = startOfDay(target);
  const dayDiff = Math.round((target0 - today0) / 86400000);
  const timeStr = target.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  if (dayDiff === 0) return `hoy ${timeStr}`;
  if (dayDiff === 1) return `mañana ${timeStr}`;
  if (dayDiff === -1) return `ayer ${timeStr}`;
  return target.toLocaleString('es-ES', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Short line for "last run" column (dashboard table). */
export function formatLastEchoCell(iso?: string, lastResult?: EchoResult): string {
  if (!iso && !lastResult) return '— (nunca ejecutado)';
  const timePart = iso ? formatRelativeTime(new Date(iso).getTime()) : '';
  const resultPart = summarizeEchoResult(lastResult);
  if (!iso) return resultPart || '—';
  if (!resultPart) return `✅ ${timePart}`;
  return `${resultPart} · ${timePart}`;
}

export function summarizeEchoResult(r?: EchoResult): string {
  if (!r) return '';
  if (!r.success) return r.error ? `❌ ${r.error}` : '❌ error';
  if (r.notified) return '✅ enviado';
  if (r.message?.toLowerCase().includes('novedad') || r.message?.toLowerCase().includes('sin novedad')) {
    return '✅ sin novedad';
  }
  if (r.message) return `✅ ${r.message}`;
  return '✅ ok';
}

/** Schedule line for Echo cards (Spanish). */
export function formatScheduleSpanish(schedule: string): string {
  const s = schedule.trim();
  const interval = /^interval:(\d+)min$/i.exec(s);
  if (interval) {
    return `cada ${interval[1]} minutos`;
  }
  const parts = s.split(/\s+/);
  if (parts.length >= 5) {
    const minute = parts[0];
    const hour = parts[1];
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
      const hh = hour.padStart(2, '0');
      const mm = minute.padStart(2, '0');
      if (parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
        return `todos los días a las ${hh}:${mm}`;
      }
    }
  }
  return schedule;
}

/** "Último run: hoy 07:00 — ✅ …" */
export function formatLastRunEchoLine(iso?: string, lastResult?: EchoResult): string {
  if (!iso) {
    if (!lastResult) return 'Último run: —';
    return `Último run: — — ${summarizeEchoResultFull(lastResult)}`;
  }
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const dayLabel = sameDay
    ? `hoy ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
    : `el ${d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  const tail = summarizeEchoResultFull(lastResult);
  return `Último run: ${dayLabel} — ${tail}`;
}

function summarizeEchoResultFull(r?: EchoResult): string {
  if (!r) return '—';
  if (!r.success) return r.error ? `❌ ${r.error}` : '❌ error';
  if (r.notified) return '✅ Enviado por Telegram';
  if (r.message) {
    const m = r.message.trim();
    if (/sin novedad/i.test(m)) return '✅ Sin novedades';
    if (/resumen|guardado/i.test(m)) return '✅ Resumen guardado';
    return `✅ ${m}`;
  }
  return '✅ Completado';
}

export function formatNextRunEchoLine(iso?: string): string {
  if (!iso) return 'Próximo run: —';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'Próximo run: —';
  const now = Date.now();
  const diffMs = t - now;
  if (diffMs < 0) return `Próximo run: ${formatRelativeTime(t)}`;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `Próximo run: en ${diffMin} minutos`;
  const target = new Date(t);
  const today0 = startOfDay(new Date());
  const target0 = startOfDay(target);
  const dayDiff = Math.round((target0 - today0) / 86400000);
  const timeStr = target.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (dayDiff === 0) return `Próximo run: hoy ${timeStr}`;
  if (dayDiff === 1) return `Próximo run: mañana ${timeStr}`;
  return `Próximo run: ${target.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })} ${timeStr}`;
}
