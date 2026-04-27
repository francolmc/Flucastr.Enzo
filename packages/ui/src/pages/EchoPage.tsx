import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import type { EchoEngineStatus, EchoResult, EchoTaskStatus } from '../types';
import {
  formatLastRunEchoLine,
  formatNextRunEchoLine,
  formatScheduleSpanish,
} from '../utils/timeFormat';
import './EchoPage.css';

const POLL_MS = 30_000;

function taskEmoji(id: string): string {
  switch (id) {
    case 'morning-briefing':
      return '☀️';
    case 'context-refresh':
      return '🔄';
    case 'night-summary':
      return '🌙';
    default:
      return '⏱️';
  }
}

export default function EchoPage() {
  const [status, setStatus] = useState<EchoEngineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runFlash, setRunFlash] = useState<Record<string, EchoResult | null>>({});
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const load = useCallback(async () => {
    try {
      setError(null);
      const s = await apiClient.getEchoStatus();
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const clearRunTimer = (taskId: string) => {
    const t = timersRef.current.get(taskId);
    if (t) {
      window.clearTimeout(t);
      timersRef.current.delete(taskId);
    }
  };

  const showRunResult = (taskId: string, result: EchoResult) => {
    clearRunTimer(taskId);
    setRunFlash((f) => ({ ...f, [taskId]: result }));
    const t = window.setTimeout(() => {
      setRunFlash((f) => {
        const next = { ...f };
        delete next[taskId];
        return next;
      });
      timersRef.current.delete(taskId);
    }, 5000);
    timersRef.current.set(taskId, t);
  };

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const handleToggle = async (task: EchoTaskStatus) => {
    try {
      setError(null);
      await apiClient.toggleEchoTask(task.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error(e);
    }
  };

  const handleRun = async (taskId: string) => {
    try {
      setError(null);
      const result = await apiClient.runEchoTask(taskId);
      showRunResult(taskId, result);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      showRunResult(taskId, { success: false, error: msg });
    }
  };

  if (loading && !status) {
    return (
      <div className="echo-page page-shell">
        <p className="muted">Cargando Echo…</p>
      </div>
    );
  }

  const tasks = status?.tasks ?? [];

  return (
    <div className="echo-page page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Echo</h1>
          <p className="page-subtitle">Tareas programadas y ejecución manual. Actualización cada 30 s.</p>
        </div>
        <button type="button" className="btn-refresh-echo" onClick={() => void load()}>
          Actualizar ahora
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="echo-task-list">
        {tasks.length === 0 ? (
          <div className="surface-card empty-echo">No hay tasks registrados.</div>
        ) : (
          tasks.map((task) => (
            <article key={task.id} className="surface-card echo-task-card">
              <div className="echo-task-head">
                <h2 className="echo-task-title">
                  <span aria-hidden>{taskEmoji(task.id)}</span> {task.name}
                </h2>
                <div className="echo-task-controls">
                  <button
                    type="button"
                    className={`toggle-active ${task.enabled ? 'on' : 'off'}`}
                    onClick={() => void handleToggle(task)}
                    title={task.enabled ? 'Desactivar' : 'Activar'}
                  >
                    {task.enabled ? '● Activo' : '○ Inactivo'}
                  </button>
                  <button
                    type="button"
                    className="btn-run-round"
                    onClick={() => void handleRun(task.id)}
                    title="Ejecutar ahora"
                  >
                    ▶
                  </button>
                </div>
              </div>
              <p className="echo-line">
                <strong>Schedule:</strong> {formatScheduleSpanish(task.schedule)}
              </p>
              <p className="echo-line">{formatLastRunEchoLine(task.lastRun, task.lastResult)}</p>
              <p className="echo-line">{formatNextRunEchoLine(task.nextRun)}</p>
              {runFlash[task.id] != null && (
                <p className="echo-run-flash">
                  {runFlash[task.id]!.success
                    ? runFlash[task.id]!.message ||
                      (runFlash[task.id]!.notified ? '✅ Notificado por Telegram' : '✅ Completado')
                    : `❌ ${runFlash[task.id]!.error || 'Error'}`}
                </p>
              )}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
