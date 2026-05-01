import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { Project } from '../types';
import { formatRelativeTime } from '../utils/timeFormat';
import { useEnzoStore } from '../stores/enzoStore';
import './ProjectsPage.css';

export default function ProjectsPage() {
  const userId = useEnzoStore((s) => s.userId);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { projects: list } = await apiClient.getProjects(userId);
      setProjects(list ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="projects-page page-shell">
        <p className="muted">Cargando proyectos…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="projects-page page-shell">
        <div className="error-banner">{error}</div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="projects-page page-shell">
        <div className="page-header">
          <div>
            <h1 className="page-title">Proyectos</h1>
            <p className="page-subtitle">Vista derivada de la memoria de Enzo.</p>
          </div>
        </div>
        <div className="surface-card empty-projects">
          <p>
            No hay proyectos registrados en la memoria de Enzo para este usuario. Hablá del proyecto en el
            chat web o en Telegram y revisá también la página Memoria para confirmar que guardó el detalle
            bajo la categoría <strong>projects</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="projects-page page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Proyectos</h1>
          <p className="page-subtitle">
            Solo lectura — se actualiza desde la memoria de Enzo (chat web y Telegram).
          </p>
        </div>
      </div>

      <div className="project-grid">
        {projects.map((p) => (
          <article key={p.name} className="surface-card project-card">
            <h2 className="project-name">
              <span className="project-emoji" aria-hidden>
                {emojiForProject(p.name)}
              </span>{' '}
              {p.name}
            </h2>
            <p className="project-activity">
              Última actividad:{' '}
              {formatProjectActivity(p.lastActivity)}
            </p>
            <div className="project-pending">
              <strong>Pendientes:</strong>
              {p.pendingItems.length === 0 ? (
                <p className="pending-empty">(sin pendientes registrados)</p>
              ) : (
                <ul>
                  {p.pendingItems.map((item, i) => (
                    <li key={`${p.name}-${i}`}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function formatProjectActivity(iso: string): string {
  if (!iso?.trim()) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  return formatRelativeTime(t);
}

function emojiForProject(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('dash')) return '🚀';
  if (n.includes('financio')) return '💰';
  if (n.includes('andes')) return '🏔️';
  if (n.includes('enzo')) return '⚡';
  if (n.includes('consult')) return '📋';
  return '📁';
}
