import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { DeclarativeEchoJobDTO, EchoComplexityLevelOption } from '../types';
import { formatScheduleSpanish } from '../utils/timeFormat';
import './EchoDeclarativeJobsSection.css';

interface EchoDeclarativeJobsSectionProps {
  onConfigChanged: () => void;
}

type FormMode = 'closed' | 'create' | 'edit';

interface JobFormState {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  message: string;
  userId: string;
  conversationId: string;
  agentId: string;
  userLanguage: string;
  classifiedLevel: EchoComplexityLevelOption;
  maxRetries: string;
  notifyOnResult: boolean;
  notificationPreviewChars: string;
}

function emptyForm(): JobFormState {
  return {
    id: '',
    name: '',
    schedule: '0 9 * * *',
    enabled: true,
    message: '',
    userId: '',
    conversationId: '',
    agentId: '',
    userLanguage: '',
    classifiedLevel: '',
    maxRetries: '2',
    notifyOnResult: false,
    notificationPreviewChars: '800',
  };
}

function jobToForm(job: DeclarativeEchoJobDTO): JobFormState {
  const p = job.payload;
  return {
    id: job.id,
    name: job.name ?? '',
    schedule: job.schedule,
    enabled: job.enabled !== false,
    message: p.message ?? '',
    userId: p.userId ?? '',
    conversationId: p.conversationId ?? '',
    agentId: p.agentId ?? '',
    userLanguage: p.userLanguage ?? '',
    classifiedLevel: (p.classifiedLevel as EchoComplexityLevelOption) ?? '',
    maxRetries: String(p.maxRetries ?? 2),
    notifyOnResult: p.notifyOnResult === true,
    notificationPreviewChars: String(p.notificationPreviewChars ?? 800),
  };
}

function formToDTO(f: JobFormState): DeclarativeEchoJobDTO {
  const maxRetries = Number.parseInt(f.maxRetries, 10);
  const notificationPreviewChars = Number.parseInt(f.notificationPreviewChars, 10);
  const payload: DeclarativeEchoJobDTO['payload'] = {
    message: f.message.trim(),
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : 2,
    notifyOnResult: f.notifyOnResult,
    notificationPreviewChars: Number.isFinite(notificationPreviewChars) ? notificationPreviewChars : 800,
  };
  const uid = f.userId.trim();
  if (uid) payload.userId = uid;
  const cid = f.conversationId.trim();
  if (cid) payload.conversationId = cid;
  const aid = f.agentId.trim();
  if (aid) payload.agentId = aid;
  const lang = f.userLanguage.trim();
  if (lang) payload.userLanguage = lang;
  if (f.classifiedLevel) payload.classifiedLevel = f.classifiedLevel;

  return {
    id: f.id.trim(),
    name: f.name.trim() || undefined,
    kind: 'orchestrator_message',
    enabled: f.enabled,
    schedule: f.schedule.trim(),
    payload,
  };
}

export function EchoDeclarativeJobsSection({ onConfigChanged }: EchoDeclarativeJobsSectionProps) {
  const [cronTz, setCronTz] = useState('');
  const [jobs, setJobs] = useState<DeclarativeEchoJobDTO[]>([]);
  const [invalid, setInvalid] = useState<{ index: number; summary: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [savingTz, setSavingTz] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('closed');
  const [form, setForm] = useState<JobFormState>(() => emptyForm());
  const [formSubmitting, setFormSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setSectionError(null);
      const data = await apiClient.getEchoDeclarativeJobs();
      setJobs(data.jobs);
      setInvalid(data.invalidDeclarativeEntries ?? []);
      setCronTz(data.cronTimezone ?? '');
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveCronTz = async () => {
    try {
      setSavingTz(true);
      setSectionError(null);
      await apiClient.patchEchoSettings({ cronTimezone: cronTz.trim() || undefined });
      await load();
      onConfigChanged();
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingTz(false);
    }
  };

  const openCreate = () => {
    setForm(emptyForm());
    setFormMode('create');
    setSectionError(null);
  };

  const openEdit = (job: DeclarativeEchoJobDTO) => {
    setForm(jobToForm(job));
    setFormMode('edit');
    setSectionError(null);
  };

  const closeForm = () => {
    setFormMode('closed');
    setForm(emptyForm());
  };

  const submitForm = async () => {
    try {
      setFormSubmitting(true);
      setSectionError(null);
      const dto = formToDTO(form);
      if (!dto.id) {
        setSectionError('El id es obligatorio (slug minúsculas, ej. mi-tarea-semanal).');
        return;
      }
      if (formMode === 'create') {
        await apiClient.createEchoDeclarativeJob(dto);
      } else {
        await apiClient.updateEchoDeclarativeJob(dto.id, dto);
      }
      await load();
      onConfigChanged();
      closeForm();
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : String(e));
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDelete = async (job: DeclarativeEchoJobDTO) => {
    if (!window.confirm(`¿Eliminar el job “${job.name || job.id}” (${job.id})?`)) return;
    try {
      setSectionError(null);
      await apiClient.deleteEchoDeclarativeJob(job.id);
      await load();
      onConfigChanged();
      if (formMode === 'edit' && form.id === job.id) {
        closeForm();
      }
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="surface-card echo-decl-section">
      <div className="echo-decl-head">
        <h3 className="echo-decl-title">Tareas autónomas (Orchestrator)</h3>
        <button type="button" className="btn-echo-decl-new" onClick={openCreate}>
          + Nueva tarea
        </button>
      </div>
      <p className="muted echo-decl-intro">
        Se guardan en el archivo de configuración Echo del servidor. Usan el mismo modelo y herramientas que el chat;
        el mensaje se envía como turno programado.
      </p>

      <div className="echo-decl-cron-row">
        <label className="echo-decl-label" htmlFor="echo-cron-tz">
          Zona IANA para calcular “próximo run” (<code>cronTimezone</code>)
        </label>
        <div className="echo-decl-cron-inputs">
          <input
            id="echo-cron-tz"
            type="text"
            className="echo-decl-input echo-decl-input-tz"
            placeholder="America/Argentina/Buenos_Aires"
            value={cronTz}
            onChange={(ev) => setCronTz(ev.target.value)}
          />
          <button type="button" className="btn-echo-decl-secondary" disabled={savingTz} onClick={() => void handleSaveCronTz()}>
            {savingTz ? 'Guardando…' : 'Guardar zona'}
          </button>
        </div>
      </div>

      {invalid.length > 0 && (
        <div className="echo-decl-warn">
          Hay {invalid.length} entradas en <code>declarativeJobs</code> con JSON inválido (revisá el archivo en disco o
          borralas a mano).
        </div>
      )}

      {sectionError && <div className="error-banner echo-decl-error">{sectionError}</div>}

      {loading ? (
        <p className="muted">Cargando jobs…</p>
      ) : (
        <div className="echo-decl-table-wrap">
          <table className="echo-decl-table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Nombre</th>
                <th>Schedule</th>
                <th>Activo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    No hay tareas declarativas. Creá una con “Nueva tarea”.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <code>{job.id}</code>
                    </td>
                    <td>{job.name || '—'}</td>
                    <td title={job.schedule}>{formatScheduleSpanish(job.schedule)}</td>
                    <td>{job.enabled === false ? 'No' : 'Sí'}</td>
                    <td className="echo-decl-actions">
                      <button type="button" className="linklike" onClick={() => openEdit(job)}>
                        Editar
                      </button>
                      <button type="button" className="linklike danger" onClick={() => void handleDelete(job)}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {formMode !== 'closed' && (
        <div className="echo-decl-form-panel">
          <h4 className="echo-decl-form-title">{formMode === 'create' ? 'Nueva tarea' : `Editar · ${form.id}`}</h4>
          <div className="echo-decl-grid">
            <label className="echo-decl-field">
              <span>Id (slug)</span>
              <input
                className="echo-decl-input"
                value={form.id}
                disabled={formMode === 'edit'}
                onChange={(ev) => setForm((f) => ({ ...f, id: ev.target.value }))}
                placeholder="weekly-digest"
              />
            </label>
            <label className="echo-decl-field">
              <span>Nombre visible</span>
              <input
                className="echo-decl-input"
                value={form.name}
                onChange={(ev) => setForm((f) => ({ ...f, name: ev.target.value }))}
              />
            </label>
            <label className="echo-decl-field echo-decl-field-wide">
              <span>Schedule (cron 5 campos o interval:Nmin)</span>
              <input
                className="echo-decl-input"
                value={form.schedule}
                onChange={(ev) => setForm((f) => ({ ...f, schedule: ev.target.value }))}
              />
            </label>
            <label className="echo-decl-check">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(ev) => setForm((f) => ({ ...f, enabled: ev.target.checked }))}
              />
              <span>Habilitada</span>
            </label>
            <label className="echo-decl-field echo-decl-field-full">
              <span>Mensaje al Orchestrator</span>
              <textarea
                className="echo-decl-textarea"
                rows={5}
                value={form.message}
                onChange={(ev) => setForm((f) => ({ ...f, message: ev.target.value }))}
                placeholder="Instrucción que recibirá Enzo como si fuera un mensaje tuyo en el chat."
              />
            </label>
            <label className="echo-decl-field">
              <span>userId (opcional)</span>
              <input
                className="echo-decl-input"
                value={form.userId}
                onChange={(ev) => setForm((f) => ({ ...f, userId: ev.target.value }))}
              />
            </label>
            <label className="echo-decl-field">
              <span>conversationId (opcional)</span>
              <input
                className="echo-decl-input"
                value={form.conversationId}
                onChange={(ev) => setForm((f) => ({ ...f, conversationId: ev.target.value }))}
              />
            </label>
            <label className="echo-decl-field">
              <span>agentId (opcional)</span>
              <input
                className="echo-decl-input"
                value={form.agentId}
                onChange={(ev) => setForm((f) => ({ ...f, agentId: ev.target.value }))}
              />
            </label>
            <label className="echo-decl-field">
              <span>userLanguage (opcional)</span>
              <input
                className="echo-decl-input"
                value={form.userLanguage}
                onChange={(ev) => setForm((f) => ({ ...f, userLanguage: ev.target.value }))}
                placeholder="es"
              />
            </label>
            <label className="echo-decl-field">
              <span>Nivel clasificador (opcional)</span>
              <select
                className="echo-decl-input"
                value={form.classifiedLevel}
                onChange={(ev) => setForm((f) => ({ ...f, classifiedLevel: ev.target.value as EchoComplexityLevelOption }))}
              >
                <option value="">Por defecto (clasificación normal)</option>
                <option value="SIMPLE">SIMPLE</option>
                <option value="MODERATE">MODERATE</option>
                <option value="COMPLEX">COMPLEX</option>
                <option value="AGENT">AGENT</option>
              </select>
            </label>
            <label className="echo-decl-field">
              <span>maxRetries</span>
              <input
                className="echo-decl-input"
                value={form.maxRetries}
                onChange={(ev) => setForm((f) => ({ ...f, maxRetries: ev.target.value }))}
              />
            </label>
            <label className="echo-decl-check">
              <input
                type="checkbox"
                checked={form.notifyOnResult}
                onChange={(ev) => setForm((f) => ({ ...f, notifyOnResult: ev.target.checked }))}
              />
              <span>Notificar resultado por Telegram</span>
            </label>
            <label className="echo-decl-field">
              <span>Vista previa Telegram (caracteres)</span>
              <input
                className="echo-decl-input"
                value={form.notificationPreviewChars}
                onChange={(ev) => setForm((f) => ({ ...f, notificationPreviewChars: ev.target.value }))}
              />
            </label>
          </div>
          <div className="echo-decl-form-actions">
            <button type="button" className="btn-echo-decl-primary" disabled={formSubmitting} onClick={() => void submitForm()}>
              {formSubmitting ? 'Guardando…' : 'Guardar tarea'}
            </button>
            <button type="button" className="btn-echo-decl-secondary" disabled={formSubmitting} onClick={closeForm}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
