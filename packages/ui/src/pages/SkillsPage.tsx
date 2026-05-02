import { useState, useEffect, useRef } from 'react';
import { apiClient } from '../api/client';
import { SkillRecord } from '../types';
import './SkillsPage.css';

const NEW_SKILL_TEMPLATE = `---
name: mi-skill
description: Describe cuándo debe usarse esta skill (una frase clara para el clasificador).
version: 1.0.0
author:
---

# Instrucciones

Escribe aquí las instrucciones que el asistente debe seguir cuando esta skill aplique.
`;

type EditorMode = { type: 'create' } | { type: 'edit'; id: string };

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [editorMarkdown, setEditorMarkdown] = useState('');
  const [newSkillId, setNewSkillId] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const openCreate = () => {
    setError(null);
    setNewSkillId('');
    setEditorMarkdown(NEW_SKILL_TEMPLATE);
    setEditorMode({ type: 'create' });
  };

  const openEdit = async (id: string) => {
    setError(null);
    setEditorMode({ type: 'edit', id });
    setLoadingSource(true);
    setEditorMarkdown('');
    try {
      const { markdown } = await apiClient.getSkillSource(id);
      setEditorMarkdown(markdown);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      setEditorMode(null);
    } finally {
      setLoadingSource(false);
    }
  };

  const closeEditor = () => {
    setEditorMode(null);
    setEditorMarkdown('');
    setNewSkillId('');
  };

  const saveEditor = async () => {
    if (!editorMode) return;
    const md = editorMarkdown.trim();
    if (!md) {
      setError('El contenido no puede estar vacío.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editorMode.type === 'create') {
        const id = newSkillId.trim();
        if (!id) {
          setError('Indica un id de skill (carpeta), por ejemplo: mi-resumen-diario');
          setSaving(false);
          return;
        }
        const { skill } = await apiClient.createSkill(id, editorMarkdown);
        setSkills((prev) => {
          const without = prev.filter((s) => s.id !== skill.id);
          return [...without, skill].sort((a, b) => a.id.localeCompare(b.id));
        });
      } else {
        const { skill } = await apiClient.putSkillSource(editorMode.id, editorMarkdown);
        setSkills((prev) => prev.map((s) => (s.id === skill.id ? skill : s)));
      }
      closeEditor();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (id: string, displayName: string) => {
    const ok = window.confirm(
      `¿Eliminar la skill «${displayName}» (${id})? Se borrará la carpeta en disco. Esta acción no se puede deshacer.`
    );
    if (!ok) return;
    setError(null);
    try {
      await apiClient.deleteSkill(id);
      setSkills((prev) => prev.filter((s) => s.id !== id));
      if (editorMode?.type === 'edit' && editorMode.id === id) {
        closeEditor();
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      if (text) setEditorMarkdown(text);
    };
    reader.readAsText(file);
  };

  return (
    <div className="skills-page page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Skills</h1>
          <p className="page-subtitle">
            Gestiona capacidades de Enzo: activa o desactiva, edita SKILL.md desde aquí o crea nuevas skills.
          </p>
        </div>
        <div className="skills-header-actions">
          <button type="button" className="btn-secondary-outline" onClick={openCreate} disabled={loading}>
            Nueva skill
          </button>
          <button className="btn-reload" type="button" onClick={reloadSkills} disabled={loading}>
            {loading ? 'Cargando...' : 'Recargar skills'}
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {(editorMode || loadingSource) && (
        <section className="skills-editor surface-card" aria-label="Editor de skill">
          <div className="skills-editor-head">
            <h2 className="skills-editor-title">
              {editorMode?.type === 'create' ? 'Nueva skill' : editorMode ? `Editar: ${editorMode.id}` : 'Cargando…'}
            </h2>
            <div className="skills-editor-head-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,text/markdown,.markdown"
                className="skills-file-input"
                onChange={onPickFile}
              />
              <button
                type="button"
                className="btn-secondary-outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={!editorMode || loadingSource}
              >
                Importar .md
              </button>
              <button type="button" className="btn-secondary-outline" onClick={closeEditor} disabled={saving}>
                Cancelar
              </button>
              <button type="button" className="btn-reload" onClick={saveEditor} disabled={saving || loadingSource}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
          {editorMode?.type === 'create' && (
            <label className="skills-new-id-field">
              <span>Id de la skill (nombre de carpeta)</span>
              <input
                type="text"
                value={newSkillId}
                onChange={(e) => setNewSkillId(e.target.value)}
                placeholder="ej: resumen-diario"
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
              />
            </label>
          )}
          <p className="skills-editor-hint">
            Archivo íntegro <code className="inline-code">SKILL.md</code>: frontmatter YAML entre{' '}
            <code className="inline-code">---</code> y el cuerpo en markdown (placeholders como{' '}
            <code className="inline-code">{'{{CURRENT_DATETIME}}'}</code> se resuelven al cargar).
          </p>
          {loadingSource ? (
            <div className="loading skills-editor-loading">Cargando archivo…</div>
          ) : (
            <div className="skills-editor-textarea-wrap">
              <textarea
                className="skills-editor-textarea"
                value={editorMarkdown}
                onChange={(e) => setEditorMarkdown(e.target.value)}
                spellCheck={false}
                disabled={saving}
                rows={18}
                cols={1}
              />
            </div>
          )}
        </section>
      )}

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

      {loading && !skills.length && !editorMode ? (
        <div className="loading">Cargando skills...</div>
      ) : skills.length === 0 && !editorMode ? (
        <div className="empty-state">
          <p>No hay skills instalados</p>
          <p className="hint">Creá una con «Nueva skill» o copiá carpetas a ~/.enzo/skills/ y recargá</p>
        </div>
      ) : (
        <div className="skills-list">
          {skills.map((skill) => (
            <div key={skill.id} className="skill-card surface-card">
              <div className="skill-info">
                <div className="skill-header">
                  <h3>{skill.metadata.name}</h3>
                  <span className="skill-id-label">{skill.id}</span>
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
                  type="button"
                  className="btn-skill-secondary"
                  onClick={() => openEdit(skill.id)}
                  disabled={!!editorMode || saving}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="btn-skill-danger"
                  onClick={() => confirmDelete(skill.id, skill.metadata.name)}
                  disabled={!!editorMode || saving}
                >
                  Eliminar
                </button>
                <button
                  type="button"
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
