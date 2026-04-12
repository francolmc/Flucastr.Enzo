import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { SkillRecord } from '../types';
import './SkillsPage.css';

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.getSkills();
      setSkills(data);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error('Error loading skills:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSkill = async (id: string, enabled: boolean) => {
    try {
      const result = await apiClient.toggleSkill(id, enabled);

      setSkills((previous) => previous.map((skill) => (skill.id === id ? result.skill : skill)));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error('Error toggling skill:', err);
    }
  };

  const reloadSkills = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiClient.reloadSkills();
      setSkills(result.skills);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error('Error reloading skills:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="skills-page page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Skills</h1>
          <p className="page-subtitle">
            Gestiona capacidades activas de Enzo para mantener respuestas rápidas y enfocadas.
          </p>
        </div>
        <button className="btn-reload" onClick={reloadSkills} disabled={loading}>
          {loading ? 'Cargando...' : 'Recargar skills'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="skills-kpis">
        <article className="surface-card skills-kpi-card">
          <span>Total skills</span>
          <strong>{skills.length}</strong>
        </article>
        <article className="surface-card skills-kpi-card">
          <span>Activas</span>
          <strong>{skills.filter((skill) => skill.enabled).length}</strong>
        </article>
        <article className="surface-card skills-kpi-card">
          <span>Desactivadas</span>
          <strong>{skills.filter((skill) => !skill.enabled).length}</strong>
        </article>
      </div>

      {loading && !skills.length ? (
        <div className="loading">Cargando skills...</div>
      ) : skills.length === 0 ? (
        <div className="empty-state">
          <p>No hay skills instalados</p>
          <p className="hint">Copia skills a ~/.enzo/skills/ y recarga</p>
        </div>
      ) : (
        <div className="skills-list">
          {skills.map((skill) => (
            <div key={skill.id} className="skill-card surface-card">
              <div className="skill-info">
                <div className="skill-header">
                  <h3>{skill.metadata.name}</h3>
                  {skill.metadata.version && (
                    <span className="skill-version">v{skill.metadata.version}</span>
                  )}
                </div>
                <p className="skill-description">{skill.metadata.description}</p>
                {skill.metadata.author && (
                  <p className="skill-author">Por: {skill.metadata.author}</p>
                )}
              </div>
              <div className="skill-actions">
                <button
                  className={`toggle-btn ${skill.enabled ? 'enabled' : 'disabled'}`}
                  onClick={() => toggleSkill(skill.id, skill.enabled)}
                  title={skill.enabled ? 'Deshabilitar' : 'Habilitar'}
                >
                  {skill.enabled ? 'Activo' : 'Inactivo'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
