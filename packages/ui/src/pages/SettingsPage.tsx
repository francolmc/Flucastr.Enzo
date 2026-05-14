import { useState, useEffect } from 'react';
import { useEnzoStore } from '../stores/enzoStore';
import './SettingsPage.css';

function formatDate(dateString: string): string {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'hoy';
    if (diffDays === 1) return 'ayer';
    if (diffDays < 7) return `hace ${diffDays} días`;
    if (diffDays < 30) return `hace ${Math.floor(diffDays / 7)} semanas`;
    return date.toLocaleDateString('es-CL');
  } catch {
    return dateString;
  }
}

function SettingsPage() {
  const {
    versionInfo,
    updateInProgress,
    updateProgress,
    checkForUpdates,
    triggerUpdate,
    subscribeToUpdateProgress,
  } = useEnzoStore();

  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  useEffect(() => {
    if (!updateInProgress) return;

    const unsubscribe = subscribeToUpdateProgress(() => {});
    return unsubscribe;
  }, [updateInProgress, subscribeToUpdateProgress]);

  const handleUpdateClick = () => {
    setShowConfirm(true);
  };

  const handleConfirmUpdate = async () => {
    setShowConfirm(false);
    await triggerUpdate();
  };

  const handleCancelUpdate = () => {
    setShowConfirm(false);
  };

  return (
    <div className="settings-page page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuración</h1>
          <p className="page-subtitle">
            Gestiona la configuración general de Enzo
          </p>
        </div>
      </div>

      <section className="config-section">
        <div className="config-section-header">
          <span className="badge">Sistema</span>
          <h2>Versión y actualizaciones</h2>
        </div>

        <div className="version-card surface-card">
          {versionInfo ? (
            <>
              <div className="version-info">
                <div className="version-row">
                  <span className="version-label">Versión actual:</span>
                  <span className="version-value">v{versionInfo.current}</span>
                </div>
                <div className="version-row">
                  <span className="version-label">Rama:</span>
                  <span className="version-value">{versionInfo.branch}</span>
                </div>
                {versionInfo.lastCommitDate && (
                  <div className="version-row">
                    <span className="version-label">Último commit:</span>
                    <span className="version-value">
                      hace {formatDate(versionInfo.lastCommitDate)} ({versionInfo.lastCommitDate})
                    </span>
                  </div>
                )}
              </div>

              {versionInfo.isUpToDate ? (
                <div className="version-status success">
                  ✓ Enzo está actualizado
                </div>
              ) : (
                <div className="version-update-available">
                  <div className="version-status warning">
                    ✓ Nueva versión disponible: v{versionInfo.available}
                  </div>
                  <p className="version-commit-count">
                    {versionInfo.commitsBehind} commit{versionInfo.commitsBehind !== 1 ? 's' : ''} nuevo{versionInfo.commitsBehind !== 1 ? 's' : ''}
                  </p>
                  <a
                    href="https://github.com/francolmc/Flucastr.Enzo/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="version-link"
                  >
                    Ver cambios en GitHub →
                  </a>
                </div>
              )}
            </>
          ) : (
            <div className="version-loading">Verificando...</div>
          )}

          {updateInProgress && updateProgress && (
            <div className="update-progress">
              <div className="update-progress-header">
                <span>Actualizando Enzo...</span>
                <span>{updateProgress.step}/{updateProgress.total}</span>
              </div>
              <div className="update-progress-bar">
                <div
                  className={`update-progress-fill ${updateProgress.status}`}
                  style={{ width: `${(updateProgress.step / updateProgress.total) * 100}%` }}
                />
              </div>
              <div className="update-progress-message">
                {updateProgress.message}
              </div>
            </div>
          )}

          <div className="version-actions">
            {!updateInProgress && versionInfo && !versionInfo.isUpToDate && (
              <button
                className="update-btn"
                onClick={handleUpdateClick}
              >
                Actualizar ahora
              </button>
            )}
            {!updateInProgress && (
              <button
                className="secondary"
                onClick={() => void checkForUpdates()}
              >
                Verificar actualizaciones
              </button>
            )}
          </div>
        </div>
      </section>

      {showConfirm && (
        <div className="modal-overlay">
          <div className="modal-content surface-card">
            <h3>¿Actualizar Enzo?</h3>
            <p>
              Se ejecutará <code>git pull</code>, <code>pnpm install</code> y <code>pnpm build</code>.
              Tu configuración y datos no se verán afectados.
            </p>
            <p className="modal-warning">
              La interfaz se recargará automáticamente al finalizar.
            </p>
            <div className="modal-actions">
              <button className="update-btn" onClick={handleConfirmUpdate}>
                Actualizar
              </button>
              <button className="secondary" onClick={handleCancelUpdate}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsPage;