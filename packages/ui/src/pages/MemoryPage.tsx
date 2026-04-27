import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { UIMemory } from '../types';
import { CANONICAL_MEMORY_KEYS } from '../constants/memoryKeys';
import { formatRelativeTime } from '../utils/timeFormat';
import { useEnzoStore } from '../stores/enzoStore';
import './MemoryPage.css';

type PanelMode = 'closed' | 'add' | 'edit';

export default function MemoryPage() {
  const userId = useEnzoStore((s) => s.userId);
  const [rows, setRows] = useState<UIMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('closed');
  const [editKey, setEditKey] = useState<string>('');
  const [newKey, setNewKey] = useState<string>(CANONICAL_MEMORY_KEYS[0]);
  const [draftValue, setDraftValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { memories } = await apiClient.getMemory(userId);
      setRows(memories ?? []);
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

  const openAdd = () => {
    setError(null);
    setPanelMode('add');
    setNewKey(CANONICAL_MEMORY_KEYS[0]);
    setDraftValue('');
    setEditKey('');
  };

  const openEdit = (m: UIMemory) => {
    setPanelMode('edit');
    setEditKey(m.key);
    setDraftValue(m.value);
  };

  const closePanel = () => {
    setPanelMode('closed');
    setDraftValue('');
    setEditKey('');
    setPendingDeleteKey(null);
  };

  const handleSaveAdd = async () => {
    try {
      setSaving(true);
      setError(null);
      await apiClient.createMemory(userId, newKey, draftValue);
      closePanel();
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already exists|Conflict|409/i.test(msg)) {
        setError('Ya existe memoria para esa clave. Usa editar o elige otra clave.');
      } else {
        setError(msg);
      }
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    try {
      setSaving(true);
      setError(null);
      await apiClient.updateMemory(userId, editKey, draftValue);
      closePanel();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (key: string) => {
    try {
      setError(null);
      await apiClient.deleteMemory(userId, key);
      setPendingDeleteKey(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error(e);
    }
  };

  const sorted = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="memory-page page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Memoria</h1>
          <p className="page-subtitle">Contexto persistente por clave canónica.</p>
        </div>
        <button type="button" className="btn-add-memory" onClick={openAdd}>
          ＋ Agregar memoria
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="memory-layout">
        <div className="surface-card memory-table-wrap">
          {loading && !rows.length ? (
            <p className="muted-pad">Cargando…</p>
          ) : (
            <table className="memory-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Actualizado</th>
                  <th className="col-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      Sin memorias para este usuario.
                    </td>
                  </tr>
                ) : (
                  sorted.map((m) => (
                    <tr key={m.id}>
                      <td className="td-key">{m.key}</td>
                      <td className="td-value">{m.value}</td>
                      <td className="td-time">{formatRelativeTime(m.updatedAt)}</td>
                      <td className="col-actions">
                        {pendingDeleteKey === m.key ? (
                          <span className="inline-confirm">
                            ¿Eliminar?{' '}
                            <button type="button" className="link-yes" onClick={() => void confirmDelete(m.key)}>
                              Sí
                            </button>{' '}
                            <button type="button" className="link-no" onClick={() => setPendingDeleteKey(null)}>
                              No
                            </button>
                          </span>
                        ) : (
                          <span className="action-btns">
                            <button
                              type="button"
                              className="icon-btn"
                              title="Editar"
                              onClick={() => openEdit(m)}
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Eliminar"
                              onClick={() => setPendingDeleteKey(m.key)}
                            >
                              🗑️
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {panelMode !== 'closed' && (
        <div className="memory-panel-backdrop" role="presentation" onClick={closePanel}>
          <aside
            className="memory-panel surface-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="memory-panel-title"
          >
            <h2 id="memory-panel-title" className="panel-title">
              {panelMode === 'add' ? 'Nueva memoria' : `Editar: ${editKey}`}
            </h2>
            {panelMode === 'add' && (
              <label className="field-block">
                <span>Key</span>
                <select
                  className="field-input"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                >
                  {CANONICAL_MEMORY_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field-block">
              <span>Value</span>
              <textarea
                className="field-textarea"
                rows={10}
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
              />
            </label>
            <div className="panel-actions">
              <button type="button" className="btn-secondary" onClick={closePanel} disabled={saving}>
                Cancelar
              </button>
              {panelMode === 'add' ? (
                <button type="button" className="btn-primary" onClick={() => void handleSaveAdd()} disabled={saving}>
                  {saving ? 'Guardando…' : 'Crear'}
                </button>
              ) : (
                <button type="button" className="btn-primary" onClick={() => void handleSaveEdit()} disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
