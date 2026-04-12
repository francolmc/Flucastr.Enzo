import { useState } from 'react';
import { useEnzoStore } from '../../stores/enzoStore';

export function FallbackModelSection() {
  const { modelsConfig, updateFallbackModels } = useEnzoStore();
  const [selectedFallback, setSelectedFallback] = useState<string>(
    modelsConfig?.fallbackModels?.[0] || 'ninguno'
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const models = modelsConfig?.availableOllamaModels || [];
  const primaryModel = modelsConfig?.primaryModel;

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');
    try {
      const fallbacks = selectedFallback === 'ninguno' ? [] : [selectedFallback];
      await updateFallbackModels(fallbacks);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      console.error('Error saving fallback model:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="config-card">
      <h3>Modelo fallback</h3>
      <div className="config-card-body">
        <p className="config-card-description">
          Se utilizará si el modelo principal no está disponible o falla en tareas complejas.
        </p>

        <div className="config-card-actions">
          <select
            value={selectedFallback}
            onChange={(e) => setSelectedFallback(e.target.value)}
            className="config-select"
          >
            <option value="ninguno">Ninguno</option>
            {models.map((model) => (
              <option
                key={model.name}
                value={model.name}
                disabled={model.name === primaryModel}
              >
                {model.name}
                {model.name === primaryModel ? ' (modelo actual)' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="config-save-btn secondary"
          >
            {isSaving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>

        {saveStatus === 'success' && (
          <p className="config-status success">Configuración guardada</p>
        )}
        {saveStatus === 'error' && (
          <p className="config-status error">Error al guardar</p>
        )}
      </div>
    </div>
  );
}
