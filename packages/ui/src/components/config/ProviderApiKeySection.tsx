import { useEffect, useState } from 'react';
import { useEnzoStore } from '../../stores/enzoStore';

interface ProviderInput {
  [key: string]: {
    apiKey: string;
    isSaving: boolean;
    showInput: boolean;
  };
}

export function ProviderApiKeySection() {
  const { modelsConfig, saveProviderApiKey, toggleProvider } = useEnzoStore();
  const [inputs, setInputs] = useState<ProviderInput>({});
  const [saveStatus, setSaveStatus] = useState<{ [key: string]: 'idle' | 'success' | 'error' }>({});

  const providers = modelsConfig?.availableProviders || [];
  const nonOllamaProviders = providers.filter((p) => p.name !== 'ollama');

  useEffect(() => {
    if (nonOllamaProviders.length === 0) return;

    setInputs((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const provider of nonOllamaProviders) {
        if (!next[provider.name]) {
          next[provider.name] = { apiKey: '', isSaving: false, showInput: false };
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setSaveStatus((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const provider of nonOllamaProviders) {
        if (!next[provider.name]) {
          next[provider.name] = 'idle';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [nonOllamaProviders]);

  const handleSaveApiKey = async (provider: string) => {
    const { apiKey } = inputs[provider] || { apiKey: '' };

    if (!apiKey.trim()) {
      alert('Por favor, ingresa una API key');
      return;
    }

    setInputs((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], isSaving: true },
    }));

    try {
      await saveProviderApiKey(provider, apiKey);
      setSaveStatus((prev) => ({
        ...prev,
        [provider]: 'success',
      }));

      setInputs((prev) => ({
        ...prev,
        [provider]: { apiKey: '', isSaving: false, showInput: false },
      }));

      setTimeout(
        () =>
          setSaveStatus((prev) => ({
            ...prev,
            [provider]: 'idle',
          })),
        3000
      );
    } catch (error) {
      console.error('Error saving API key:', error);
      setSaveStatus((prev) => ({
        ...prev,
        [provider]: 'error',
      }));

      setTimeout(
        () =>
          setSaveStatus((prev) => ({
            ...prev,
            [provider]: 'idle',
          })),
        3000
      );
    } finally {
      setInputs((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], isSaving: false },
      }));
    }
  };

  const handleToggleProvider = async (provider: string, enabled: boolean) => {
    try {
      await toggleProvider(provider, !enabled);
    } catch (error) {
      console.error('Error toggling provider:', error);
    }
  };

  return (
    <div className="config-card">
      <h3>API keys de providers</h3>
      <p className="config-card-description">
        Activa providers cloud y agrega llaves cuando necesites más capacidad.
      </p>
      <div className="provider-list">
        {nonOllamaProviders.length > 0 ? (
          nonOllamaProviders.map((provider) => (
            <div
              key={provider.name}
              className="provider-item-row"
            >
              <div className="provider-name-wrap">
                <p className="provider-name">
                  {provider.name}
                </p>
              </div>

              <button
                onClick={() => handleToggleProvider(provider.name, provider.enabled)}
                className={`provider-toggle ${provider.enabled ? 'enabled' : 'disabled'}`}
              >
                {provider.enabled ? 'Activo' : 'Inactivo'}
              </button>

              {provider.hasApiKey ? (
                <div className="provider-key-state">
                  <p>API key configurada</p>
                  <button
                    onClick={() =>
                      setInputs((prev) => ({
                        ...prev,
                        [provider.name]: {
                          ...(prev[provider.name] || { apiKey: '', isSaving: false, showInput: false }),
                          showInput: !(prev[provider.name]?.showInput),
                        },
                      }))
                    }
                    className="provider-link-btn"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() =>
                    setInputs((prev) => ({
                      ...prev,
                      [provider.name]: {
                        ...(prev[provider.name] || { apiKey: '', isSaving: false, showInput: false }),
                        showInput: true,
                      },
                    }))
                  }
                  className="provider-add-btn"
                >
                  Agregar
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="config-placeholder">
            No hay providers adicionales disponibles. Solo Ollama está configurado.
          </p>
        )}

        <div className="provider-inputs">
          {nonOllamaProviders.map((provider) =>
            inputs[provider.name]?.showInput ? (
              <div key={`input-${provider.name}`} className="provider-input-row">
                <label>
                  {provider.name} API Key
                </label>
                <div className="provider-input-actions">
                  <input
                    type="password"
                    value={inputs[provider.name]?.apiKey || ''}
                    onChange={(e) =>
                      setInputs((prev) => ({
                        ...prev,
                        [provider.name]: {
                          ...(prev[provider.name] || { apiKey: '', isSaving: false, showInput: true }),
                          apiKey: e.target.value,
                        },
                      }))
                    }
                    placeholder="Ingresa la API key"
                    className="provider-input"
                  />
                  <button
                    onClick={() => handleSaveApiKey(provider.name)}
                    disabled={!!inputs[provider.name]?.isSaving}
                    className="config-save-btn"
                  >
                    {inputs[provider.name]?.isSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
                {saveStatus[provider.name] === 'success' && (
                  <p className="config-status success">Guardado</p>
                )}
                {saveStatus[provider.name] === 'error' && (
                  <p className="config-status error">Error</p>
                )}
              </div>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}
