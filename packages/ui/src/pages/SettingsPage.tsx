import { useState, useEffect } from 'react';
import { useEnzoStore } from '../stores/enzoStore';
import { ModelManagement } from '../components/config/ModelManagement';
import { FallbackModelSection } from '../components/config/FallbackModelSection';
import { ProviderApiKeySection } from '../components/config/ProviderApiKeySection';
import { DailyRoutineConfigSection } from '../components/config/DailyRoutineConfigSection';
import { UserConfigSection } from '../components/config/UserConfigSection';
import { ProfileConfigSection } from '../components/config/ProfileConfigSection';
import './SettingsPage.css';
import './ConfigPage.css';

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

const SUPPORTED_LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ko', 'ar', 'ru'] as const;

const DEFAULT_VOICE_TRIGGERS = [
  'respondeme por voz',
  'en audio',
  'mándame un audio',
  'mandame un audio',
  'responde en audio',
  'en voz',
] as const;

function SystemTab() {
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

  const handleUpdateClick = () => setShowConfirm(true);
  const handleCheckUpdates = async () => {
    console.log('[Settings] before checkForUpdates');
    await checkForUpdates();
    console.log('[Settings] after checkForUpdates, versionInfo:', versionInfo);
    console.log('[Settings] isUpToDate:', versionInfo?.isUpToDate, 'commitsBehind:', versionInfo?.commitsBehind);
  };
  const handleConfirmUpdate = async () => {
    setShowConfirm(false);
    await triggerUpdate();
  };
  const handleCancelUpdate = () => setShowConfirm(false);

  return (
    <div className="settings-page">
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
                <div className="version-status success">✓ Enzo está actualizado</div>
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
              <div className="update-progress-message">{updateProgress.message}</div>
            </div>
          )}

          <div className="version-actions">
            {!updateInProgress && versionInfo && !versionInfo.isUpToDate && (
              <button className="update-btn" onClick={handleUpdateClick}>Actualizar ahora</button>
            )}
            {!updateInProgress && (
              <button type="button" className="secondary" onClick={handleCheckUpdates}>
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
            <p>Se ejecutará <code>git pull</code>, <code>pnpm install</code> y <code>pnpm build</code>. Tu configuración y datos no se verán afectados.</p>
            <p className="modal-warning">La interfaz se recargará automáticamente al finalizar.</p>
            <div className="modal-actions">
              <button className="update-btn" onClick={handleConfirmUpdate}>Actualizar</button>
              <button className="secondary" onClick={handleCancelUpdate}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssistantTab() {
  const {
    config,
    configLoadError,
    systemConfig,
    agents,
    loadConfig,
    loadAgents,
    loadProfilesConfig,
    loadSystemConfig,
    updateSystemConfig,
    createAgent,
    updateAgent,
    deleteAgent,
  } = useEnzoStore();

  const [showNewAgentForm, setShowNewAgentForm] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '', description: '', provider: 'ollama', model: '',
    systemPrompt: '', assistantNameOverride: '', personaOverride: '', toneOverride: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingSystem, setIsSavingSystem] = useState(false);
  const [isSavingVoice, setIsSavingVoice] = useState(false);
  const [voiceForm, setVoiceForm] = useState<{
    whisperUrl: string;
    whisperLanguage: string;
    ttsVoiceEs: string;
    ttsVoiceEn: string;
    voiceTriggers: string[];
  }>({
    whisperUrl: 'http://localhost:9000',
    whisperLanguage: 'es',
    ttsVoiceEs: 'es-CL-CatalinaNeural',
    ttsVoiceEn: 'en-US-AriaNeural',
    voiceTriggers: [...DEFAULT_VOICE_TRIGGERS],
  });
  const [systemForm, setSystemForm] = useState({
    ollamaBaseUrl: '', anthropicModel: '', port: '', uiPort: '',
    dbPath: '', enzoWorkspacePath: '', enzoSkillsPath: '',
    enzoDebug: false, enzoSkillsFallbackRelevanceThreshold: '0.12',
    mcpAutoConnect: false, enzoNativeToolCalling: false,
    enzoMcpIncludeFullSchema: true, enzoMcpShowReasoning: false,
    defaultUserLanguage: 'es', tz: 'America/Santiago',
    telegramAllowedUsers: '', telegramAgentOwnerUserId: '',
    telegramAgentAutoroute: false, telegramBotToken: '', tavilyApiKey: '',
  });

  useEffect(() => {
    void Promise.allSettled([
      loadConfig(), loadAgents(), loadProfilesConfig(), loadSystemConfig(),
    ]);
  }, [loadConfig, loadAgents, loadProfilesConfig, loadSystemConfig]);

  useEffect(() => {
    if (!systemConfig) return;
    setSystemForm((prev) => ({
      ...prev,
      ollamaBaseUrl: systemConfig.ollamaBaseUrl || '',
      anthropicModel: systemConfig.anthropicModel || '',
      port: systemConfig.port || '',
      uiPort: systemConfig.uiPort || '5173',
      dbPath: systemConfig.dbPath || '',
      enzoWorkspacePath: systemConfig.enzoWorkspacePath || '',
      enzoSkillsPath: systemConfig.enzoSkillsPath || '',
      enzoDebug: !!systemConfig.enzoDebug,
      enzoSkillsFallbackRelevanceThreshold: String(systemConfig.enzoSkillsFallbackRelevanceThreshold ?? 0.12),
      mcpAutoConnect: !!systemConfig.mcpAutoConnect,
      enzoNativeToolCalling: !!systemConfig.enzoNativeToolCalling,
      enzoMcpIncludeFullSchema: systemConfig.enzoMcpIncludeFullSchema !== false,
      enzoMcpShowReasoning: !!systemConfig.enzoMcpShowReasoning,
      defaultUserLanguage: systemConfig.defaultUserLanguage || 'es',
      tz: systemConfig.tz || 'America/Santiago',
      telegramAllowedUsers: systemConfig.telegramAllowedUsers || '',
      telegramAgentOwnerUserId: systemConfig.telegramAgentOwnerUserId || '',
      telegramAgentAutoroute: !!systemConfig.telegramAgentAutoroute,
      telegramBotToken: '',
      tavilyApiKey: '',
    }));
  }, [systemConfig]);

  useEffect(() => {
    if (!systemConfig) return;
    setVoiceForm({
      whisperUrl: systemConfig.whisperUrl || 'http://localhost:9000',
      whisperLanguage: systemConfig.whisperLanguage || 'es',
      ttsVoiceEs: systemConfig.ttsVoiceEs || 'es-CL-CatalinaNeural',
      ttsVoiceEn: systemConfig.ttsVoiceEn || 'en-US-AriaNeural',
      voiceTriggers: systemConfig.voiceTriggers?.length > 0
                ? ([...systemConfig.voiceTriggers] as string[])
                : ([...DEFAULT_VOICE_TRIGGERS] as string[]),
    });
  }, [systemConfig]);

  const handleSubmitAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.provider || !formData.model) {
      alert('Por favor completa los campos requeridos');
      return;
    }
    setIsSubmitting(true);
    try {
      if (editingAgentId) {
        await updateAgent(editingAgentId, {
          name: formData.name, description: formData.description || undefined,
          provider: formData.provider, model: formData.model,
          systemPrompt: formData.systemPrompt || undefined,
          assistantNameOverride: formData.assistantNameOverride || undefined,
          personaOverride: formData.personaOverride || undefined,
          toneOverride: formData.toneOverride || undefined,
        });
      } else {
        await createAgent({
          name: formData.name, description: formData.description || undefined,
          provider: formData.provider, model: formData.model,
          systemPrompt: formData.systemPrompt || undefined,
          assistantNameOverride: formData.assistantNameOverride || undefined,
          personaOverride: formData.personaOverride || undefined,
          toneOverride: formData.toneOverride || undefined,
        });
      }
      setFormData({ name: '', description: '', provider: 'ollama', model: '', systemPrompt: '', assistantNameOverride: '', personaOverride: '', toneOverride: '' });
      setShowNewAgentForm(false);
      setEditingAgentId(null);
    } catch (error) {
      console.error('Error saving agent:', error);
      alert(editingAgentId ? 'Error al actualizar el agente' : 'Error al crear el agente');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditAgent = (agent: typeof agents[number]) => {
    setEditingAgentId(agent.id);
    setFormData({
      name: agent.name, description: agent.description || '',
      provider: agent.provider, model: agent.model,
      systemPrompt: agent.systemPrompt || '',
      assistantNameOverride: agent.assistantNameOverride || '',
      personaOverride: agent.personaOverride || '',
      toneOverride: agent.toneOverride || '',
    });
    setShowNewAgentForm(true);
  };

  const handleDeleteAgent = async (id: string) => {
    if (confirm('¿Estás seguro de que deseas eliminar este agente?')) {
      try { await deleteAgent(id); }
      catch (error) { console.error('Error deleting agent:', error); alert('Error al eliminar el agente'); }
    }
  };

  const handleSaveSystemConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSystem(true);
    try {
      await updateSystemConfig({
        ollamaBaseUrl: systemForm.ollamaBaseUrl,
        anthropicModel: systemForm.anthropicModel,
        port: systemForm.port,
        uiPort: systemForm.uiPort,
        dbPath: systemForm.dbPath,
        enzoWorkspacePath: systemForm.enzoWorkspacePath,
        enzoSkillsPath: systemForm.enzoSkillsPath,
        enzoDebug: systemForm.enzoDebug,
        enzoSkillsFallbackRelevanceThreshold: Number(systemForm.enzoSkillsFallbackRelevanceThreshold),
        mcpAutoConnect: systemForm.mcpAutoConnect,
        enzoNativeToolCalling: systemForm.enzoNativeToolCalling,
        enzoMcpIncludeFullSchema: systemForm.enzoMcpIncludeFullSchema,
        enzoMcpShowReasoning: systemForm.enzoMcpShowReasoning,
        defaultUserLanguage: systemForm.defaultUserLanguage,
        tz: systemForm.tz,
        telegramAllowedUsers: systemForm.telegramAllowedUsers,
        telegramAgentOwnerUserId: systemForm.telegramAgentOwnerUserId,
        telegramAgentAutoroute: systemForm.telegramAgentAutoroute,
        telegramBotToken: systemForm.telegramBotToken || undefined,
        tavilyApiKey: systemForm.tavilyApiKey || undefined,
      });
      alert('Configuración de sistema guardada');
      setSystemForm((prev) => ({ ...prev, telegramBotToken: '', tavilyApiKey: '' }));
    } catch (error) {
      console.error('Error saving system config:', error);
      alert('Error al guardar configuración de sistema');
    } finally {
      setIsSavingSystem(false);
    }
  };

  const handleSaveVoiceConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingVoice(true);
    try {
      await updateSystemConfig({
        whisperUrl: voiceForm.whisperUrl,
        whisperLanguage: voiceForm.whisperLanguage,
        ttsVoiceEs: voiceForm.ttsVoiceEs,
        ttsVoiceEn: voiceForm.ttsVoiceEn,
        voiceTriggers: voiceForm.voiceTriggers.map((s) => s.trim()).filter((s) => s.length > 0),
      });
      alert('Configuración de voz guardada');
    } catch (error) {
      console.error('Error saving voice config:', error);
      alert('Error al guardar configuración de voz');
    } finally {
      setIsSavingVoice(false);
    }
  };

  if (!config) {
    if (configLoadError) {
      return (
        <div className="config-page page-shell">
          <div className="error-banner" role="alert">{configLoadError}</div>
          <p style={{ marginTop: '1rem', lineHeight: 1.55 }}>
            Revisá que el servidor Enzo (`/api/config`) esté accesible.
          </p>
          <div className="form-actions">
            <button type="button" onClick={() => void loadConfig()}>Reintentar</button>
          </div>
        </div>
      );
    }
    return <div className="config-page page-shell">Cargando configuración…</div>;
  }

  return (
    <div className="config-page">
      <section className="config-section">
        <div className="config-section-header">
          <span className="badge">Paso 1 · Conectar</span>
          <h2>Modelos y providers</h2>
        </div>
        <div className="config-grid">
          <ModelManagement />
          <FallbackModelSection />
          <ProviderApiKeySection />
        </div>
      </section>

      <section className="config-section">
        <div className="config-section-header">
          <span className="badge">Paso 2 · Personalizar</span>
          <h2>Configuración de Usuario y Perfiles</h2>
        </div>
        <div className="config-grid">
          <UserConfigSection />
          <ProfileConfigSection />
        </div>
      </section>

      <section className="config-section">
        <div className="config-section-header">
          <span className="badge">Paso 3 · Sistema</span>
          <h2>Parámetros globales de runtime</h2>
        </div>
        <form className="agent-form surface-card" onSubmit={handleSaveSystemConfig}>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysOllamaBaseUrl">OLLAMA_BASE_URL</label>
              <input id="sysOllamaBaseUrl" type="text" value={systemForm.ollamaBaseUrl}
                onChange={(e) => setSystemForm({ ...systemForm, ollamaBaseUrl: e.target.value })}
                placeholder="http://localhost:11434" />
            </div>
            <div className="form-group">
              <label htmlFor="sysAnthropicModel">ANTHROPIC_MODEL</label>
              <input id="sysAnthropicModel" type="text" value={systemForm.anthropicModel}
                onChange={(e) => setSystemForm({ ...systemForm, anthropicModel: e.target.value })}
                placeholder="claude-haiku-4-5" />
            </div>
          </div>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysPort">PORT</label>
              <input id="sysPort" type="text" value={systemForm.port}
                onChange={(e) => setSystemForm({ ...systemForm, port: e.target.value })} placeholder="3001" />
            </div>
            <div className="form-group">
              <label htmlFor="sysUiPort">ENZO_UI_PORT</label>
              <input id="sysUiPort" type="text" value={systemForm.uiPort}
                onChange={(e) => setSystemForm({ ...systemForm, uiPort: e.target.value })} placeholder="5173" />
            </div>
          </div>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysDbPath">DB_PATH</label>
              <input id="sysDbPath" type="text" value={systemForm.dbPath}
                onChange={(e) => setSystemForm({ ...systemForm, dbPath: e.target.value })} />
            </div>
          </div>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysSkillsPath">ENZO_SKILLS_PATH</label>
              <input id="sysSkillsPath" type="text" value={systemForm.enzoSkillsPath}
                onChange={(e) => setSystemForm({ ...systemForm, enzoSkillsPath: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="sysWorkspacePath">ENZO_WORKSPACE_PATH</label>
              <input id="sysWorkspacePath" type="text" value={systemForm.enzoWorkspacePath}
                onChange={(e) => setSystemForm({ ...systemForm, enzoWorkspacePath: e.target.value })} />
            </div>
          </div>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysDefaultLanguage">DEFAULT_USER_LANGUAGE</label>
              <select id="sysDefaultLanguage" value={systemForm.defaultUserLanguage}
                onChange={(e) => setSystemForm({ ...systemForm, defaultUserLanguage: e.target.value })}>
                {SUPPORTED_LANGUAGES.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="sysTimezone">TZ</label>
              <input id="sysTimezone" type="text" value={systemForm.tz}
                onChange={(e) => setSystemForm({ ...systemForm, tz: e.target.value })} placeholder="America/Santiago" />
            </div>
          </div>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysSkillsFallbackThreshold">ENZO_SKILLS_FALLBACK_RELEVANCE_THRESHOLD</label>
              <input id="sysSkillsFallbackThreshold" type="number" min="0" max="1" step="0.01"
                value={systemForm.enzoSkillsFallbackRelevanceThreshold}
                onChange={(e) => setSystemForm({ ...systemForm, enzoSkillsFallbackRelevanceThreshold: e.target.value })} />
            </div>
            <div className="form-group">
              <label>ENZO_SECRET</label>
              <input type="text" value={systemConfig?.secretStoragePath || '~/.enzo/secret.key'} readOnly />
              <p className="config-card-description">Gestionado automáticamente.</p>
            </div>
          </div>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysAllowedUsers">TELEGRAM_ALLOWED_USERS</label>
              <input id="sysAllowedUsers" type="text" value={systemForm.telegramAllowedUsers}
                onChange={(e) => setSystemForm({ ...systemForm, telegramAllowedUsers: e.target.value })}
                placeholder="12345,67890" />
            </div>
            <div className="form-group">
              <label htmlFor="sysOwnerUserId">TELEGRAM_AGENT_OWNER_USER_ID</label>
              <input id="sysOwnerUserId" type="text" value={systemForm.telegramAgentOwnerUserId}
                onChange={(e) => setSystemForm({ ...systemForm, telegramAgentOwnerUserId: e.target.value })}
                placeholder="Opcional" />
            </div>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="checkbox" checked={systemForm.telegramAgentAutoroute}
                onChange={(e) => setSystemForm({ ...systemForm, telegramAgentAutoroute: e.target.checked })} />
              TELEGRAM_AGENT_AUTOROUTE
            </label>
          </div>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysBotToken">TELEGRAM_BOT_TOKEN {systemConfig?.hasTelegramBotToken ? '(configurado)' : '(sin configurar)'}</label>
              <input id="sysBotToken" type="password" value={systemForm.telegramBotToken}
                onChange={(e) => setSystemForm({ ...systemForm, telegramBotToken: e.target.value })}
                placeholder="Dejar vacío para no cambiar" />
            </div>
            <div className="form-group">
              <label htmlFor="sysTavilyKey">TAVILY_API_KEY {systemConfig?.hasTavilyApiKey ? '(configurada)' : '(sin configurar)'}</label>
              <input id="sysTavilyKey" type="password" value={systemForm.tavilyApiKey}
                onChange={(e) => setSystemForm({ ...systemForm, tavilyApiKey: e.target.value })}
                placeholder="Dejar vacío para no cambiar" />
            </div>
          </div>
          <div className="form-group-row">
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="checkbox" checked={systemForm.mcpAutoConnect}
                onChange={(e) => setSystemForm({ ...systemForm, mcpAutoConnect: e.target.checked })} />
              MCP_AUTO_CONNECT
            </label>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="checkbox" checked={systemForm.enzoDebug}
                onChange={(e) => setSystemForm({ ...systemForm, enzoDebug: e.target.checked })} />
              ENZO_DEBUG
            </label>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="checkbox" checked={systemForm.enzoNativeToolCalling}
                onChange={(e) => setSystemForm({ ...systemForm, enzoNativeToolCalling: e.target.checked })} />
              Native Tool Calling
            </label>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="checkbox" checked={systemForm.enzoMcpIncludeFullSchema}
                onChange={(e) => setSystemForm({ ...systemForm, enzoMcpIncludeFullSchema: e.target.checked })} />
              MCP Full Schema
            </label>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="checkbox" checked={systemForm.enzoMcpShowReasoning}
                onChange={(e) => setSystemForm({ ...systemForm, enzoMcpShowReasoning: e.target.checked })} />
              MCP Show Reasoning
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" disabled={isSavingSystem}>
              {isSavingSystem ? 'Guardando...' : 'Guardar configuración de sistema'}
            </button>
          </div>
        </form>
      </section>

      <section className="config-section">
        <div className="config-section-header">
          <span className="badge">Paso 4 · Rutina Diaria</span>
          <h2>Notificaciones automáticas de tu asistente</h2>
        </div>
        <DailyRoutineConfigSection />
      </section>

      <section className="config-section">
        <div className="config-section-header">
          <span className="badge">Paso 5 · Voz</span>
          <h2>Whisper, TTS y respuestas en audio (Telegram)</h2>
        </div>
        <form className="agent-form surface-card" onSubmit={handleSaveVoiceConfig}>
          <p className="config-card-description">
            Transcripción con servicio ASR y Edge TTS. Los cambios aplican sin reiniciar.
          </p>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="voiceWhisperUrl">URL de Whisper (ASR)</label>
              <input id="voiceWhisperUrl" type="text" value={voiceForm.whisperUrl}
                onChange={(e) => setVoiceForm({ ...voiceForm, whisperUrl: e.target.value })}
                placeholder="http://localhost:9000" />
            </div>
            <div className="form-group">
              <label htmlFor="voiceWhisperLanguage">Idioma de transcripción</label>
              <input id="voiceWhisperLanguage" type="text" value={voiceForm.whisperLanguage}
                onChange={(e) => setVoiceForm({ ...voiceForm, whisperLanguage: e.target.value })} placeholder="es" />
            </div>
          </div>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="voiceTtsEs">Voz TTS (español)</label>
              <input id="voiceTtsEs" type="text" value={voiceForm.ttsVoiceEs}
                onChange={(e) => setVoiceForm({ ...voiceForm, ttsVoiceEs: e.target.value })}
                placeholder="es-CL-CatalinaNeural" />
            </div>
            <div className="form-group">
              <label htmlFor="voiceTtsEn">Voz TTS (inglés)</label>
              <input id="voiceTtsEn" type="text" value={voiceForm.ttsVoiceEn}
                onChange={(e) => setVoiceForm({ ...voiceForm, ttsVoiceEn: e.target.value })}
                placeholder="en-US-AriaNeural" />
            </div>
          </div>
          <div className="form-group">
            <label>Triggers de respuesta por voz</label>
            <p className="config-card-description">Si el mensaje contiene una de estas frases, se responde también en audio.</p>
            {voiceForm.voiceTriggers.map((phrase, index) => (
              <div key={index} className="form-group-row" style={{ marginBottom: '8px' }}>
                <input type="text" value={phrase}
                  onChange={(e) => {
                    const next = [...voiceForm.voiceTriggers];
                    next[index] = e.target.value;
                    setVoiceForm({ ...voiceForm, voiceTriggers: next });
                  }}
                  placeholder="Frase disparadora" style={{ flex: 1 }} />
                <button type="button" onClick={() => setVoiceForm({
                  ...voiceForm, voiceTriggers: voiceForm.voiceTriggers.filter((_, i) => i !== index),
                })}>Quitar</button>
              </div>
            ))}
            <button type="button" className="new-agent-btn" onClick={() =>
              setVoiceForm({ ...voiceForm, voiceTriggers: [...voiceForm.voiceTriggers, ''] })}>
              + Agregar frase
            </button>
          </div>
          <div className="form-actions">
            <button type="submit" disabled={isSavingVoice}>
              {isSavingVoice ? 'Guardando...' : 'Guardar voz'}
            </button>
          </div>
        </form>
      </section>

      <section className="config-section">
        <div className="config-section-header">
          <span className="badge">Paso 5 · Configurar</span>
          <h2>Presets conversacionales ("agentes")</h2>
        </div>
        <p className="config-card-description">
          Cada entrada define proveedor, modelo y, si quieres, instrucciones o tono para el asistente.
        </p>
        {!showNewAgentForm && (
          <button className="new-agent-btn" onClick={() => setShowNewAgentForm(true)}>+ Nuevo preset</button>
        )}
        {showNewAgentForm && (
          <form id="agent-editor-form" className="agent-form surface-card" onSubmit={handleSubmitAgent}>
            {editingAgentId && <p className="config-card-description">Editando agente existente.</p>}
            <div className="form-group">
              <label htmlFor="name">Nombre *</label>
              <input id="name" type="text" value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Nombre del agente" required />
            </div>
            <div className="form-group">
              <label htmlFor="description">Descripción</label>
              <textarea id="description" value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Descripción del agente" />
            </div>
            <div className="form-group">
              <label htmlFor="provider">Provider *</label>
              <select id="provider" value={formData.provider}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value })} required>
                {config.availableProviders.map((provider) => (
                  <option key={provider} value={provider}>{provider}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="model">Modelo *</label>
              <input id="model" type="text" value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                placeholder="Nombre del modelo" required />
            </div>
            <div className="form-group">
              <label htmlFor="systemPrompt">System Prompt</label>
              <textarea id="systemPrompt" value={formData.systemPrompt}
                onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                placeholder="Instrucciones del sistema para el agente" />
            </div>
            <div className="form-group-row">
              <div className="form-group">
                <label htmlFor="assistantNameOverride">Nombre del asistente (override)</label>
                <input id="assistantNameOverride" type="text" value={formData.assistantNameOverride}
                  onChange={(e) => setFormData({ ...formData, assistantNameOverride: e.target.value })}
                  placeholder="Opcional" />
              </div>
              <div className="form-group">
                <label htmlFor="toneOverride">Tono (override)</label>
                <input id="toneOverride" type="text" value={formData.toneOverride}
                  onChange={(e) => setFormData({ ...formData, toneOverride: e.target.value })}
                  placeholder="Opcional" />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="personaOverride">Personalidad (override)</label>
              <textarea id="personaOverride" value={formData.personaOverride}
                onChange={(e) => setFormData({ ...formData, personaOverride: e.target.value })}
                placeholder="Opcional" />
            </div>
            <div className="form-actions">
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Guardando...' : editingAgentId ? 'Guardar cambios' : 'Crear preset'}
              </button>
              <button type="button" className="secondary" onClick={() => {
                setShowNewAgentForm(false);
                setEditingAgentId(null);
                setFormData({ name: '', description: '', provider: 'ollama', model: '', systemPrompt: '', assistantNameOverride: '', personaOverride: '', toneOverride: '' });
              }}>Cancelar</button>
            </div>
          </form>
        )}
        {agents.length === 0 ? (
          <p className="empty-state">Sin presets conversacionales configurados</p>
        ) : (
          <div className="agents-list">
            {agents.map((agent) => (
              <div key={agent.id} className="agent-card surface-card">
                <div className="agent-header">
                  <h3>{agent.name}</h3>
                  <div className="agent-actions">
                    <button type="button" className="secondary" onClick={() => handleEditAgent(agent)}>Editar</button>
                    <button type="button" className="danger" onClick={() => handleDeleteAgent(agent.id)}>Eliminar</button>
                  </div>
                </div>
                {agent.description && <p className="agent-description">{agent.description}</p>}
                <div className="agent-details">
                  <span><strong>Provider:</strong> {agent.provider}</span>
                  <span><strong>Modelo:</strong> {agent.model}</span>
                </div>
                {agent.systemPrompt && (
                  <div className="agent-prompt"><strong>System Prompt:</strong><p>{agent.systemPrompt}</p></div>
                )}
                {(agent.assistantNameOverride || agent.toneOverride || agent.personaOverride) && (
                  <div className="agent-overrides">
                    <strong>Overrides de identidad:</strong>
                    {agent.assistantNameOverride && <p>Nombre: {agent.assistantNameOverride}</p>}
                    {agent.toneOverride && <p>Tono: {agent.toneOverride}</p>}
                    {agent.personaOverride && <p>Personalidad: {agent.personaOverride}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsPage() {
  const [tab, setTab] = useState<'system' | 'assistant'>('system');

  return (
    <div className="settings-page page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuración</h1>
          <p className="page-subtitle">Gestiona la configuración general de Enzo</p>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'system' ? 'active' : ''}`} onClick={() => setTab('system')}>
          Sistema
        </button>
        <button className={`tab ${tab === 'assistant' ? 'active' : ''}`} onClick={() => setTab('assistant')}>
          Asistente
        </button>
      </div>

      {tab === 'system' && <SystemTab />}
      {tab === 'assistant' && <AssistantTab />}
    </div>
  );
}

export default SettingsPage;