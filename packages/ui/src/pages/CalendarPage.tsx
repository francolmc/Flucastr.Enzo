import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { CalendarEventDTO } from '../types';
import { useEnzoStore } from '../stores/enzoStore';
import './CalendarPage.css';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDatetimeLocalValue(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(raw: string): string {
  const [datePart, timePart] = raw.split('T');
  const [y, mo, da] = datePart!.split('-').map(Number);
  const [hh, mi] = timePart!.split(':').map(Number);
  return new Date(y!, mo! - 1, da!, hh, mi).toISOString();
}

function defaultRangeMs(): { fromMs: number; toMs: number } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  end.setHours(23, 59, 59, 999);
  return { fromMs: start.getTime(), toMs: end.getTime() };
}

type PanelMode = 'closed' | 'add' | 'edit';

export default function CalendarPage() {
  const userId = useEnzoStore((s) => s.userId);
  const [events, setEvents] = useState<CalendarEventDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeFrom, setRangeFrom] = useState(() => toDatetimeLocalValue(defaultRangeMs().fromMs));
  const [rangeTo, setRangeTo] = useState(() => toDatetimeLocalValue(defaultRangeMs().toMs));

  const [panelMode, setPanelMode] = useState<PanelMode>('closed');
  const [editId, setEditId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftStart, setDraftStart] = useState(() => toDatetimeLocalValue(Date.now()));
  const [draftEnd, setDraftEnd] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const fromIso = fromDatetimeLocal(rangeFrom);
      const toIso = fromDatetimeLocal(rangeTo);
      const { events: rows } = await apiClient.getCalendarEvents(userId, fromIso, toIso);
      setEvents(rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [userId, rangeFrom, rangeTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const closePanel = () => {
    setPanelMode('closed');
    setEditId(null);
    setDraftTitle('');
    setDraftNotes('');
    setDraftEnd('');
  };

  const openAdd = () => {
    setPanelMode('add');
    setEditId(null);
    setDraftTitle('');
    setDraftStart(toDatetimeLocalValue(Date.now()));
    setDraftEnd('');
    setDraftNotes('');
  };

  const openEdit = (ev: CalendarEventDTO) => {
    setPanelMode('edit');
    setEditId(ev.id);
    setDraftTitle(ev.title);
    setDraftStart(toDatetimeLocalValue(ev.startAt));
    setDraftEnd(ev.endAt ? toDatetimeLocalValue(ev.endAt) : '');
    setDraftNotes(ev.notes ?? '');
  };

  const handleSave = async () => {
    const title = draftTitle.trim();
    if (!title) {
      setError('El título es obligatorio.');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const startIso = fromDatetimeLocal(draftStart);
      let endIso: string | null | undefined;
      if (draftEnd.trim()) {
        endIso = fromDatetimeLocal(draftEnd.trim());
        if (Date.parse(endIso) < Date.parse(startIso)) {
          setError('La hora de fin debe ser posterior al inicio.');
          setSaving(false);
          return;
        }
      }

      if (panelMode === 'add') {
        await apiClient.createCalendarEvent(userId, {
          title,
          startIso,
          endIso: draftEnd.trim() ? endIso : undefined,
          notes: draftNotes.trim() || null,
        });
      } else if (panelMode === 'edit' && editId) {
        await apiClient.updateCalendarEvent(userId, editId, {
          title,
          startIso,
          endIso: draftEnd.trim() ? endIso : null,
          notes: draftNotes.trim() || null,
        });
      }
      closePanel();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ev: CalendarEventDTO) => {
    if (!confirm(`¿Eliminar "${ev.title}"?`)) return;
    try {
      setError(null);
      await apiClient.deleteCalendarEvent(userId, ev.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="calendar-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Agenda</h2>
          <p className="page-sub">
            Eventos persistentes (SQLite). En Telegram, configurá{' '}
            <code>telegramAgentOwnerUserId</code> igual al usuario de esta UI (<code>default-user</code> u otro)
            para ver lo mismo que en el bot.
          </p>
        </div>
        <button type="button" className="btn-primary-cal" onClick={openAdd}>
          + Nuevo evento
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="calendar-filters surface-card">
        <label>
          Desde
          <input type="datetime-local" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="datetime-local" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
        </label>
        <button type="button" className="btn-secondary-cal" onClick={() => void load()} disabled={loading}>
          Actualizar
        </button>
      </div>

      {panelMode !== 'closed' && (
        <div className="calendar-panel surface-card">
          <h3>{panelMode === 'add' ? 'Nuevo evento' : 'Editar evento'}</h3>
          <div className="form-grid">
            <label>
              Título
              <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="Ej. Reunión equipo" />
            </label>
            <label>
              Inicio
              <input type="datetime-local" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} />
            </label>
            <label>
              Fin (opcional)
              <input type="datetime-local" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} />
            </label>
            <label className="full-width">
              Notas
              <textarea value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} rows={2} />
            </label>
          </div>
          <div className="panel-actions">
            <button type="button" className="btn-secondary-cal" onClick={closePanel} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn-primary-cal" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      <div className="calendar-table-wrap surface-card">
        {loading ? (
          <p className="muted">Cargando…</p>
        ) : events.length === 0 ? (
          <p className="muted">No hay eventos en este rango.</p>
        ) : (
          <table className="calendar-table">
            <thead>
              <tr>
                <th>Inicio (UTC)</th>
                <th>Fin</th>
                <th>Título</th>
                <th>Notas</th>
                <th className="col-actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td className="mono">{new Date(ev.startAt).toISOString()}</td>
                  <td className="mono">{ev.endAt ? new Date(ev.endAt).toISOString() : '—'}</td>
                  <td>{ev.title}</td>
                  <td className="notes-cell">{ev.notes ?? '—'}</td>
                  <td className="col-actions">
                    <button type="button" className="link-action" onClick={() => openEdit(ev)}>
                      Editar
                    </button>
                    <button type="button" className="link-action danger" onClick={() => void handleDelete(ev)}>
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
