import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { EchoEngineStatus, Notification, SkillRecord, UIMemory } from '../types';
import {
  formatLastEchoCell,
  formatRelativeTime,
  formatUpcomingLabel,
  summarizeEchoResult,
} from '../utils/timeFormat';
import { useEnzoStore } from '../stores/enzoStore';
import './DashboardPage.css';

interface DashboardPageProps {
  onNavigate: (page: 'memory' | 'calendar') => void;
}

export default function DashboardPage({ onNavigate }: DashboardPageProps) {
  const userId = useEnzoStore((s) => s.userId);
  const [loading, setLoading] = useState(true);
  const [echo, setEcho] = useState<EchoEngineStatus | null>(null);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [memories, setMemories] = useState<UIMemory[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [errors, setErrors] = useState<{ echo?: boolean; skills?: boolean; memory?: boolean; notif?: boolean }>({});
  const [apiReachable, setApiReachable] = useState(false);
  const [runFeedback, setRunFeedback] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const nextErrors: typeof errors = {};
    let reachable = false;

    const results = await Promise.allSettled([
      apiClient.getEchoStatus(),
      apiClient.getSkills(),
      apiClient.getMemory(userId),
      apiClient.getRecentNotifications(userId),
    ]);

    if (results[0].status === 'fulfilled') {
      reachable = true;
      setEcho(results[0].value);
    } else {
      nextErrors.echo = true;
      console.error(results[0].reason);
    }

    if (results[1].status === 'fulfilled') {
      reachable = true;
      setSkills(results[1].value);
    } else {
      nextErrors.skills = true;
      console.error(results[1].reason);
    }

    if (results[2].status === 'fulfilled') {
      reachable = true;
      setMemories(results[2].value.memories ?? []);
    } else {
      nextErrors.memory = true;
      console.error(results[2].reason);
    }

    if (results[3].status === 'fulfilled') {
      reachable = true;
      setNotifications(results[3].value);
    } else {
      nextErrors.notif = true;
      console.error(results[3].reason);
    }

    setApiReachable(reachable);
    setErrors(nextErrors);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const enabledEchoCount = echo?.tasks.filter((t) => t.enabled).length ?? 0;
  const enabledSkillsCount = skills.filter((s) => s.enabled).length;

  const topMemories = [...memories].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const topNotifications = notifications.slice(0, 5);

  const handleRunEcho = async (taskId: string) => {
    try {
      const result = await apiClient.runEchoTask(taskId);
      const msg = result.success
        ? summarizeEchoResult(result) || result.message || (result.notified ? 'Enviado' : 'OK')
        : result.error || 'Error';
      setRunFeedback((f) => ({ ...f, [taskId]: msg }));
      setTimeout(() => {
        setRunFeedback((f) => {
          const { [taskId]: _, ...rest } = f;
          return rest;
        });
      }, 4000);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRunFeedback((f) => ({ ...f, [taskId]: msg }));
    }
  };

  return (
    <div className="dashboard-page page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Estado del workspace y próximas acciones de Echo.</p>
        </div>
        <button type="button" className="btn-refresh-dash" onClick={() => void load()} disabled={loading}>
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      <section className="dashboard-cards">
        <article className="surface-card dash-card">
          <span className="dash-card-label">Core</span>
          <strong className="dash-card-status">{apiReachable ? '✅' : loading ? '…' : '❌'}</strong>
          <p className="dash-card-meta">
            {apiReachable ? 'API respondiendo' : loading ? 'Comprobando…' : 'Sin respuesta de API'}
          </p>
        </article>
        <article className="surface-card dash-card">
          <span className="dash-card-label">Echo</span>
          <strong className="dash-card-status">{errors.echo ? '❌' : '✅'}</strong>
          <p className="dash-card-meta">
            {!errors.echo && echo ? `${enabledEchoCount} tasks activos` : errors.echo ? 'Error al cargar' : '—'}
          </p>
          {!errors.echo && echo?.diagnostics && (
            <p className="dash-card-hint muted">
              {echo.diagnostics.runtimeRole} · TZ {echo.diagnostics.processTimezoneLabel}
              {!echo.diagnostics.echoTargetUserConfigured ? ' · sin usuario Echo' : ''}
            </p>
          )}
        </article>
        <article className="surface-card dash-card">
          <span className="dash-card-label">Skills</span>
          <strong className="dash-card-status">{errors.skills ? '❌' : '✅'}</strong>
          <p className="dash-card-meta">
            {!errors.skills ? `${enabledSkillsCount} cargados` : 'Error al cargar'}
          </p>
        </article>
        <article className="surface-card dash-card">
          <span className="dash-card-label">Memoria</span>
          <strong className="dash-card-status">{errors.memory ? '❌' : '✅'}</strong>
          <p className="dash-card-meta">
            {!errors.memory ? `${memories.length} items` : 'Error al cargar'}
          </p>
        </article>
      </section>

      <section className="dashboard-section">
        <h2 className="section-title">Echo — próximas ejecuciones</h2>
        <div className="surface-card table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Próxima ejecución</th>
                <th>Último resultado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!echo || echo.tasks.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    {errors.echo ? 'No se pudo cargar Echo.' : 'Sin tasks configurados.'}
                  </td>
                </tr>
              ) : (
                echo.tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.name}</td>
                    <td>{formatUpcomingLabel(task.nextRun)}</td>
                    <td>{formatLastEchoCell(task.lastRun, task.lastResult)}</td>
                    <td className="actions-cell">
                      <button
                        type="button"
                        className="btn-run-echo"
                        onClick={() => void handleRunEcho(task.id)}
                      >
                        ▶ Ejecutar ahora
                      </button>
                      {runFeedback[task.id] && (
                        <span className="run-hint">{runFeedback[task.id]}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-head">
          <h2 className="section-title">Agenda</h2>
          <button type="button" className="link-nav" onClick={() => onNavigate('calendar')}>
            Abrir agenda →
          </button>
        </div>
        <p className="surface-card empty-cell" style={{ margin: 0 }}>
          Consultá y editá eventos en la vista Agenda (misma base que la herramienta <code>calendar</code> del chat).
        </p>
      </section>

      <section className="dashboard-section">
        <div className="section-head">
          <h2 className="section-title">Memoria activa</h2>
          <button type="button" className="link-nav" onClick={() => onNavigate('memory')}>
            Ver toda la memoria →
          </button>
        </div>
        <ul className="surface-card memory-preview-list">
          {topMemories.length === 0 ? (
            <li className="empty-cell">Sin entradas de memoria.</li>
          ) : (
            topMemories.map((m) => (
              <li key={m.id}>
                <span className="mem-key">{m.key}</span>
                <span className="mem-val">{m.value.length > 80 ? `${m.value.slice(0, 80)}…` : m.value}</span>
                <span className="mem-time">{formatRelativeTime(m.updatedAt)}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="dashboard-section">
        <h2 className="section-title">Últimas notificaciones</h2>
        <ul className="surface-card notif-list">
          {errors.notif ? (
            <li className="empty-cell">No se pudieron cargar notificaciones.</li>
          ) : topNotifications.length === 0 ? (
            <li className="empty-cell">Sin notificaciones recientes.</li>
          ) : (
            topNotifications.map((n, i) => (
              <li key={`${n.sentAt}-${i}`}>
                <span className="notif-msg">{n.message}</span>
                <span className="notif-meta">
                  {formatRelativeTime(new Date(n.sentAt).getTime())} · {n.channel}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
