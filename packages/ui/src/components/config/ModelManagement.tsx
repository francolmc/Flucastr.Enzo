import { useState } from 'react';
import { useEnzoStore } from '../../stores/enzoStore';

export function ModelManagement() {
  const { modelsConfig, updatePrimaryModel } = useEnzoStore();
  const [selectedModel, setSelectedModel] = useState<string>(
    modelsConfig?.primaryModel || 'qwen2.5:7b'
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const models = modelsConfig?.availableOllamaModels || [];

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');
    setErrorMessage('');
    try {
      await updatePrimaryModel(selectedModel);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      console.error('Error saving model:', error);
      const detail = error instanceof Error ? error.message : 'Error al guardar el modelo';
      setErrorMessage(detail);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="config-card">
      <h3>Modelo principal</h3>
      <p className="config-card-description">
        Define el modelo por defecto para respuestas rápidas y de menor costo.
      </p>
      {modelsConfig?.runtimeModelSource === 'env' && (
        <p className="config-card-description">
          El modelo activo se controla desde <code>.env</code>. Cambios requieren reiniciar API/Telegram.
        </p>
      )}
      {modelsConfig?.runtimeModelSource === 'config' && (
        <p className="config-card-description">
          El modelo activo se controla desde <code>config.json</code> y se aplica sin reiniciar servicios.
        </p>
      )}

      <div className="config-card-body">
        <div className="config-card-actions">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="config-select"
          >
            {models.map((model) => (
              <option key={model.name} value={model.name}>
                {model.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="config-save-btn"
          >
            {isSaving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>

        {saveStatus === 'success' && (
          <p className="config-status success">Modelo guardado exitosamente</p>
        )}
        {saveStatus === 'error' && (
          <p className="config-status error">{errorMessage || 'Error al guardar el modelo'}</p>
        )}

        <div className="model-list">
          <p className="model-list-title">
            Modelos disponibles en Ollama
          </p>
          <div className="model-list-items">
            {models.length > 0 ? (
              models.map((model) => (
                <div
                  key={model.name}
                  className="model-list-item"
                >
                  <div>
                    <p className="model-name">{model.name}</p>
                    {model.size && (
                      <p className="model-size">
                        {(model.size / 1024 / 1024 / 1024).toFixed(1)}GB
                      </p>
                    )}
                  </div>
                  {selectedModel === model.name && (
                    <span className="model-current">Actual</span>
                  )}
                </div>
              ))
            ) : (
              <p className="config-placeholder">No hay modelos disponibles</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
