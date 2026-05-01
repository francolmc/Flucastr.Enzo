import { useState, useEffect } from 'react';
import { useEnzoStore } from '../stores/enzoStore';
import { ModelManagement } from '../components/config/ModelManagement';
import { FallbackModelSection } from '../components/config/FallbackModelSection';
import { ProviderApiKeySection } from '../components/config/ProviderApiKeySection';
import './ConfigPage.css';

const SUPPORTED_LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ko', 'ar', 'ru'] as const;

/** In sync with VOICE_RESPONSE_TRIGGERS in @enzo/core (defaults for the voice UI). */
const DEFAULT_VOICE_TRIGGERS = [
  'respondeme por voz',
  'en audio',
  'mándame un audio',
  'mandame un audio',
  'responde en audio',
  'en voz',
] as const;

function ConfigPage() {
  const {
    config,
    configLoadError,
    systemConfig,
    agents,
    assistantProfile,
    userProfile,
    userId,
    setUserId,
    loadConfig,
    loadAgents,
    loadProfilesConfig,
    loadConversations,
    updateProfilesConfig,
    createAgent,
    updateAgent,
    deleteAgent,
    loadModelsConfig,
    loadSystemConfig,
    updateSystemConfig,
  } = useEnzoStore();
  const [profileForm, setProfileForm] = useState({
    assistantName: '',
    assistantPersona: '',
    assistantTone: '',
    assistantStyleGuidelines: '',
    userDisplayName: '',
    userImportantInfo: '',
    userPreferences: '',
    userLocale: '',
    userTimezone: '',
  });
  const [showNewAgentForm, setShowNewAgentForm] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    provider: 'ollama',
    model: '',
    systemPrompt: '',
    assistantNameOverride: '',
    personaOverride: '',
    toneOverride: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingSystem, setIsSavingSystem] = useState(false);
  const [isSavingVoice, setIsSavingVoice] = useState(false);
  const [webUserIdDraft, setWebUserIdDraft] = useState(userId);

  useEffect(() => {
    setWebUserIdDraft(userId);
  }, [userId]);
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
    ollamaBaseUrl: '',
    anthropicModel: '',
    port: '',
    uiPort: '',
    dbPath: '',
    enzoWorkspacePath: '',
    enzoSkillsPath: '',
    enzoDebug: false,
    enzoSkillsFallbackRelevanceThreshold: '0.12',
    mcpAutoConnect: false,
    defaultUserLanguage: 'es',
    tz: 'America/Santiago',
    telegramAllowedUsers: '',
    telegramAgentOwnerUserId: '',
    telegramAgentAutoroute: false,
    telegramBotToken: '',
    tavilyApiKey: '',
  });

  useEffect(() => {
    void Promise.allSettled([
      loadConfig(),
      loadAgents(),
      loadProfilesConfig(),
      loadModelsConfig(),
      loadSystemConfig(),
    ]);
  }, [loadConfig, loadAgents, loadProfilesConfig, loadModelsConfig, loadSystemConfig]);

  useEffect(() => {
    if (!assistantProfile && !userProfile) {
      return;
    }

    setProfileForm({
      assistantName: assistantProfile?.name || '',
      assistantPersona: assistantProfile?.persona || '',
      assistantTone: assistantProfile?.tone || '',
      assistantStyleGuidelines: assistantProfile?.styleGuidelines || '',
      userDisplayName: userProfile?.displayName || '',
      userImportantInfo: userProfile?.importantInfo || '',
      userPreferences: userProfile?.preferences || '',
      userLocale: userProfile?.locale || '',
      userTimezone: userProfile?.timezone || '',
    });
  }, [assistantProfile, userProfile]);

  useEffect(() => {
    if (!systemConfig) {
      return;
    }
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
    if (!systemConfig) {
      return;
    }
    setVoiceForm({
      whisperUrl: systemConfig.whisperUrl || 'http://localhost:9000',
      whisperLanguage: systemConfig.whisperLanguage || 'es',
      ttsVoiceEs: systemConfig.ttsVoiceEs || 'es-CL-CatalinaNeural',
      ttsVoiceEn: systemConfig.ttsVoiceEn || 'en-US-AriaNeural',
      voiceTriggers:
        systemConfig.voiceTriggers?.length > 0
          ? [...systemConfig.voiceTriggers]
          : [...DEFAULT_VOICE_TRIGGERS],
    });
  }, [systemConfig]);

  const handleSaveProfiles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileForm.assistantName.trim()) {
      alert('El nombre del asistente es obligatorio');
      return;
    }

    setIsSavingProfile(true);
    try {
      await updateProfilesConfig({
        assistantProfile: {
          name: profileForm.assistantName,
          persona: profileForm.assistantPersona,
          tone: profileForm.assistantTone,
          styleGuidelines: profileForm.assistantStyleGuidelines,
        },
        userProfile: {
          displayName: profileForm.userDisplayName,
          importantInfo: profileForm.userImportantInfo,
          preferences: profileForm.userPreferences,
          locale: profileForm.userLocale,
          timezone: profileForm.userTimezone,
        },
      });
      alert('Perfil guardado');
    } catch (error) {
      console.error('Error saving profiles config:', error);
      alert('Error al guardar perfil');
    } finally {
      setIsSavingProfile(false);
    }
  };

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
          name: formData.name,
          description: formData.description || undefined,
          provider: formData.provider,
          model: formData.model,
          systemPrompt: formData.systemPrompt || undefined,
          assistantNameOverride: formData.assistantNameOverride || undefined,
          personaOverride: formData.personaOverride || undefined,
          toneOverride: formData.toneOverride || undefined,
        });
      } else {
        await createAgent({
          name: formData.name,
          description: formData.description || undefined,
          provider: formData.provider,
          model: formData.model,
          systemPrompt: formData.systemPrompt || undefined,
          assistantNameOverride: formData.assistantNameOverride || undefined,
          personaOverride: formData.personaOverride || undefined,
          toneOverride: formData.toneOverride || undefined,
        });
      }

      setFormData({
        name: '',
        description: '',
        provider: 'ollama',
        model: '',
        systemPrompt: '',
        assistantNameOverride: '',
        personaOverride: '',
        toneOverride: '',
      });
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
    console.log('[ConfigPage] Editing agent:', agent.id, agent.name);
    setEditingAgentId(agent.id);
    setFormData({
      name: agent.name,
      description: agent.description || '',
      provider: agent.provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt || '',
      assistantNameOverride: agent.assistantNameOverride || '',
      personaOverride: agent.personaOverride || '',
      toneOverride: agent.toneOverride || '',
    });
    setShowNewAgentForm(true);
    setTimeout(() => {
      const form = document.getElementById('agent-editor-form');
      form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const handleDeleteAgent = async (id: string) => {
    if (confirm('¿Estás seguro de que deseas eliminar este agente?')) {
      try {
        await deleteAgent(id);
      } catch (error) {
        console.error('Error deleting agent:', error);
        alert('Error al eliminar el agente');
      }
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
          <div className="page-header">
            <div>
              <h1 className="page-title">ControlCenter</h1>
              <p className="page-subtitle">No se pudo cargar la configuración desde la API.</p>
            </div>
          </div>
          <div className="error-banner" role="alert">
            {configLoadError}
          </div>
          <p className="muted" style={{ marginTop: '1rem', lineHeight: 1.55 }}>
            Revisá que el servidor Enzo (`/api/config`) esté accesible, el proxy reverso correcto y que no haga falta más tiempo (`VITE_API_QUICK_TIMEOUT_MS`). Error 524: timeout en Cloudflare antes de llegar al origen.
          </p>
          <div className="form-actions">
            <button type="button" onClick={() => void loadConfig()}>
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return <div className="config-page page-shell">Cargando configuración…</div>;
  }

  return (
    <div className="config-page page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">ControlCenter</h1>
          <p className="page-subtitle">
            Configura modelos, providers y agentes con un flujo guiado de conexión, ajuste y validación.
          </p>
        </div>
      </div>

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
          <h2>Identidad del asistente y perfil de usuario</h2>
        </div>

        <div className="surface-card" style={{ marginBottom: '1rem', padding: '1rem 1.25rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>ID de usuario (memoria, proyectos y chat)</h3>
          <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', lineHeight: 1.5 }}>
            En <strong>Telegram</strong> tus datos van guardados con tu ID numérico (ej. <code>123456789</code>). En la web,
            antes se usaba fijo el nombre <code>franco</code>. Si sólo ves memoria vacía en el Dashboard o en{' '}
            <strong>Memoria</strong>, pon aquí <strong>el mismo ID que usa Telegram</strong> (podés verlo en logs al enviar{' '}
            <code>/memory</code> o en la consola del bot). Así ves conversaciones y hechos persistentes sin duplicarlos en otra cuenta.
          </p>
          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label htmlFor="webEnzoUserId">User ID (texto)</label>
            <input
              id="webEnzoUserId"
              type="text"
              value={webUserIdDraft}
              onChange={(e) => setWebUserIdDraft(e.target.value)}
              placeholder="Ej. 123456789 o franco"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="form-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              onClick={() => {
                setUserId(webUserIdDraft);
                void loadConversations();
                alert(`ID guardado: ${webUserIdDraft.trim() || 'franco'}. Lista de chats actualizada; revisá Dashboard y Memoria.`);
              }}
            >
              Guardar ID local
            </button>
          </div>
          <p className="muted" style={{ margin: '0.75rem 0 0', fontSize: '0.82rem' }}>
            Opcional: variable de build <code>VITE_ENZO_USER_ID</code> como valor inicial si no hay nada guardado en este navegador.
          </p>
        </div>

        <form className="agent-form surface-card" onSubmit={handleSaveProfiles}>
          <div className="form-group">
            <label htmlFor="assistantName">Nombre del asistente *</label>
            <input
              id="assistantName"
              type="text"
              value={profileForm.assistantName}
              onChange={(e) => setProfileForm({ ...profileForm, assistantName: e.target.value })}
              placeholder="Ej. Enzo"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="assistantPersona">Personalidad</label>
            <textarea
              id="assistantPersona"
              value={profileForm.assistantPersona}
              onChange={(e) => setProfileForm({ ...profileForm, assistantPersona: e.target.value })}
              placeholder="Cómo debe comportarse el asistente"
            />
          </div>

          <div className="form-group">
            <label htmlFor="assistantTone">Forma de hablar (tono)</label>
            <input
              id="assistantTone"
              type="text"
              value={profileForm.assistantTone}
              onChange={(e) => setProfileForm({ ...profileForm, assistantTone: e.target.value })}
              placeholder="Ej. directo, claro y cercano"
            />
          </div>

          <div className="form-group">
            <label htmlFor="assistantStyleGuidelines">Guías de estilo</label>
            <textarea
              id="assistantStyleGuidelines"
              value={profileForm.assistantStyleGuidelines}
              onChange={(e) => setProfileForm({ ...profileForm, assistantStyleGuidelines: e.target.value })}
              placeholder="Reglas adicionales de redacción o formato"
            />
          </div>

          <div className="form-group">
            <label htmlFor="userDisplayName">Nombre del usuario</label>
            <input
              id="userDisplayName"
              type="text"
              value={profileForm.userDisplayName}
              onChange={(e) => setProfileForm({ ...profileForm, userDisplayName: e.target.value })}
              placeholder="Cómo debe llamarte el asistente"
            />
          </div>

          <div className="form-group">
            <label htmlFor="userImportantInfo">Información importante del usuario</label>
            <textarea
              id="userImportantInfo"
              value={profileForm.userImportantInfo}
              onChange={(e) => setProfileForm({ ...profileForm, userImportantInfo: e.target.value })}
              placeholder="Contexto útil para personalizar respuestas"
            />
          </div>

          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="userLocale">Locale</label>
              <input
                id="userLocale"
                type="text"
                value={profileForm.userLocale}
                onChange={(e) => setProfileForm({ ...profileForm, userLocale: e.target.value })}
                placeholder="es-CL"
              />
            </div>
            <div className="form-group">
              <label htmlFor="userTimezone">Timezone</label>
              <input
                id="userTimezone"
                type="text"
                value={profileForm.userTimezone}
                onChange={(e) => setProfileForm({ ...profileForm, userTimezone: e.target.value })}
                placeholder="America/Santiago"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="userPreferences">Preferencias del usuario</label>
            <textarea
              id="userPreferences"
              value={profileForm.userPreferences}
              onChange={(e) => setProfileForm({ ...profileForm, userPreferences: e.target.value })}
              placeholder="Preferencias de comunicación o trabajo"
            />
          </div>

          <div className="form-actions">
            <button type="submit" disabled={isSavingProfile}>
              {isSavingProfile ? 'Guardando...' : 'Guardar identidad y perfil'}
            </button>
          </div>
        </form>
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
              <input
                id="sysOllamaBaseUrl"
                type="text"
                value={systemForm.ollamaBaseUrl}
                onChange={(e) => setSystemForm({ ...systemForm, ollamaBaseUrl: e.target.value })}
                placeholder="http://localhost:11434"
              />
            </div>
            <div className="form-group">
              <label htmlFor="sysAnthropicModel">ANTHROPIC_MODEL</label>
              <input
                id="sysAnthropicModel"
                type="text"
                value={systemForm.anthropicModel}
                onChange={(e) => setSystemForm({ ...systemForm, anthropicModel: e.target.value })}
                placeholder="claude-haiku-4-5"
              />
            </div>
          </div>

          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysPort">PORT</label>
              <input
                id="sysPort"
                type="text"
                value={systemForm.port}
                onChange={(e) => setSystemForm({ ...systemForm, port: e.target.value })}
                placeholder="3001"
              />
            </div>
            <div className="form-group">
              <label htmlFor="sysUiPort">ENZO_UI_PORT</label>
              <input
                id="sysUiPort"
                type="text"
                value={systemForm.uiPort}
                onChange={(e) => setSystemForm({ ...systemForm, uiPort: e.target.value })}
                placeholder="5173"
              />
            </div>
          </div>

          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysDbPath">DB_PATH</label>
              <input
                id="sysDbPath"
                type="text"
                value={systemForm.dbPath}
                onChange={(e) => setSystemForm({ ...systemForm, dbPath: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysSkillsPath">ENZO_SKILLS_PATH</label>
              <input
                id="sysSkillsPath"
                type="text"
                value={systemForm.enzoSkillsPath}
                onChange={(e) => setSystemForm({ ...systemForm, enzoSkillsPath: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="sysWorkspacePath">ENZO_WORKSPACE_PATH</label>
              <input
                id="sysWorkspacePath"
                type="text"
                value={systemForm.enzoWorkspacePath}
                onChange={(e) => setSystemForm({ ...systemForm, enzoWorkspacePath: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysDefaultLanguage">DEFAULT_USER_LANGUAGE</label>
              <select
                id="sysDefaultLanguage"
                value={systemForm.defaultUserLanguage}
                onChange={(e) => setSystemForm({ ...systemForm, defaultUserLanguage: e.target.value })}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="sysTimezone">TZ</label>
              <input
                id="sysTimezone"
                type="text"
                value={systemForm.tz}
                onChange={(e) => setSystemForm({ ...systemForm, tz: e.target.value })}
                placeholder="America/Santiago"
              />
            </div>
          </div>

          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysSkillsFallbackThreshold">ENZO_SKILLS_FALLBACK_RELEVANCE_THRESHOLD</label>
              <input
                id="sysSkillsFallbackThreshold"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={systemForm.enzoSkillsFallbackRelevanceThreshold}
                onChange={(e) =>
                  setSystemForm({ ...systemForm, enzoSkillsFallbackRelevanceThreshold: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>ENZO_SECRET</label>
              <input
                type="text"
                value={systemConfig?.secretStoragePath || '~/.enzo/secret.key'}
                readOnly
              />
              <p className="config-card-description">
                Gestionado automáticamente. No se muestra ni se edita desde la UI.
              </p>
            </div>
          </div>

          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysAllowedUsers">TELEGRAM_ALLOWED_USERS</label>
              <input
                id="sysAllowedUsers"
                type="text"
                value={systemForm.telegramAllowedUsers}
                onChange={(e) => setSystemForm({ ...systemForm, telegramAllowedUsers: e.target.value })}
                placeholder="12345,67890"
              />
            </div>
            <div className="form-group">
              <label htmlFor="sysOwnerUserId">TELEGRAM_AGENT_OWNER_USER_ID</label>
              <input
                id="sysOwnerUserId"
                type="text"
                value={systemForm.telegramAgentOwnerUserId}
                onChange={(e) => setSystemForm({ ...systemForm, telegramAgentOwnerUserId: e.target.value })}
                placeholder="Opcional"
              />
            </div>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={systemForm.telegramAgentAutoroute}
                onChange={(e) => setSystemForm({ ...systemForm, telegramAgentAutoroute: e.target.checked })}
              />
              TELEGRAM_AGENT_AUTOROUTE (elegir agente automáticamente según el mensaje; por defecto desactivado)
            </label>
          </div>

          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="sysBotToken">
                TELEGRAM_BOT_TOKEN {systemConfig?.hasTelegramBotToken ? '(actualmente configurado)' : '(sin configurar)'}
              </label>
              <input
                id="sysBotToken"
                type="password"
                value={systemForm.telegramBotToken}
                onChange={(e) => setSystemForm({ ...systemForm, telegramBotToken: e.target.value })}
                placeholder="Dejar vacío para no cambiar"
              />
            </div>
            <div className="form-group">
              <label htmlFor="sysTavilyKey">
                TAVILY_API_KEY {systemConfig?.hasTavilyApiKey ? '(actualmente configurada)' : '(sin configurar)'}
              </label>
              <input
                id="sysTavilyKey"
                type="password"
                value={systemForm.tavilyApiKey}
                onChange={(e) => setSystemForm({ ...systemForm, tavilyApiKey: e.target.value })}
                placeholder="Dejar vacío para no cambiar"
              />
            </div>
          </div>

          <div className="form-group-row">
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={systemForm.mcpAutoConnect}
                onChange={(e) => setSystemForm({ ...systemForm, mcpAutoConnect: e.target.checked })}
              />
              MCP_AUTO_CONNECT
            </label>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={systemForm.enzoDebug}
                onChange={(e) => setSystemForm({ ...systemForm, enzoDebug: e.target.checked })}
              />
              ENZO_DEBUG
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
          <span className="badge">Paso 4 · Voz</span>
          <h2>Whisper, TTS y respuestas en audio (Telegram)</h2>
        </div>
        <form className="agent-form surface-card" onSubmit={handleSaveVoiceConfig}>
          <p className="config-card-description">
            Transcripción con el servicio ASR (p. ej. <code>onerahmet/openai-whisper-asr-webservice</code>) y
            Edge TTS. Los cambios se guardan en <code>config.json</code> y aplican en la siguiente operación
            sin reiniciar.
          </p>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="voiceWhisperUrl">URL de Whisper (ASR)</label>
              <input
                id="voiceWhisperUrl"
                type="text"
                value={voiceForm.whisperUrl}
                onChange={(e) => setVoiceForm({ ...voiceForm, whisperUrl: e.target.value })}
                placeholder="http://localhost:9000"
              />
            </div>
            <div className="form-group">
              <label htmlFor="voiceWhisperLanguage">Idioma de transcripción (query language)</label>
              <input
                id="voiceWhisperLanguage"
                type="text"
                value={voiceForm.whisperLanguage}
                onChange={(e) => setVoiceForm({ ...voiceForm, whisperLanguage: e.target.value })}
                placeholder="es"
              />
            </div>
          </div>
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="voiceTtsEs">Voz TTS (español)</label>
              <input
                id="voiceTtsEs"
                type="text"
                value={voiceForm.ttsVoiceEs}
                onChange={(e) => setVoiceForm({ ...voiceForm, ttsVoiceEs: e.target.value })}
                placeholder="es-CL-CatalinaNeural"
              />
            </div>
            <div className="form-group">
              <label htmlFor="voiceTtsEn">Voz TTS (inglés)</label>
              <input
                id="voiceTtsEn"
                type="text"
                value={voiceForm.ttsVoiceEn}
                onChange={(e) => setVoiceForm({ ...voiceForm, ttsVoiceEn: e.target.value })}
                placeholder="en-US-AriaNeural"
              />
            </div>
          </div>
          <div className="form-group">
            <label>Triggers de respuesta por voz</label>
            <p className="config-card-description">
              Si el mensaje de texto del usuario contiene una de estas frases, se responde también en audio.
            </p>
            {voiceForm.voiceTriggers.map((phrase, index) => (
              <div key={index} className="form-group-row" style={{ marginBottom: '8px' }}>
                <input
                  type="text"
                  value={phrase}
                  onChange={(e) => {
                    const next = [...voiceForm.voiceTriggers];
                    next[index] = e.target.value;
                    setVoiceForm({ ...voiceForm, voiceTriggers: next });
                  }}
                  placeholder="Frase disparadora"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setVoiceForm({
                      ...voiceForm,
                      voiceTriggers: voiceForm.voiceTriggers.filter((_, i) => i !== index),
                    });
                  }}
                >
                  Quitar
                </button>
              </div>
            ))}
            <button
              type="button"
              className="new-agent-btn"
              onClick={() =>
                setVoiceForm({ ...voiceForm, voiceTriggers: [...voiceForm.voiceTriggers, ''] })
              }
            >
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
          <h2>Agentes personalizados</h2>
        </div>

        {!showNewAgentForm && (
          <button
            className="new-agent-btn"
            onClick={() => setShowNewAgentForm(true)}
          >
            + Nuevo Agente
          </button>
        )}

        {showNewAgentForm && (
          <form id="agent-editor-form" className="agent-form surface-card" onSubmit={handleSubmitAgent}>
            {editingAgentId && (
              <p className="config-card-description">
                Editando agente existente. Los cambios aplican al guardar.
              </p>
            )}
            <div className="form-group">
              <label htmlFor="name">Nombre *</label>
              <input
                id="name"
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Nombre del agente"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="description">Descripción</label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Descripción del agente"
              />
            </div>

            <div className="form-group">
              <label htmlFor="provider">Provider *</label>
              <select
                id="provider"
                value={formData.provider}
                onChange={(e) =>
                  setFormData({ ...formData, provider: e.target.value })
                }
                required
              >
                {config.availableProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="model">Modelo *</label>
              <input
                id="model"
                type="text"
                value={formData.model}
                onChange={(e) =>
                  setFormData({ ...formData, model: e.target.value })
                }
                placeholder="Nombre del modelo"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="systemPrompt">System Prompt</label>
              <textarea
                id="systemPrompt"
                value={formData.systemPrompt}
                onChange={(e) =>
                  setFormData({ ...formData, systemPrompt: e.target.value })
                }
                placeholder="Instrucciones del sistema para el agente"
              />
            </div>

            <div className="form-group-row">
              <div className="form-group">
                <label htmlFor="assistantNameOverride">Nombre del asistente (override)</label>
                <input
                  id="assistantNameOverride"
                  type="text"
                  value={formData.assistantNameOverride}
                  onChange={(e) =>
                    setFormData({ ...formData, assistantNameOverride: e.target.value })
                  }
                  placeholder="Opcional: reemplaza el nombre global"
                />
              </div>

              <div className="form-group">
                <label htmlFor="toneOverride">Tono (override)</label>
                <input
                  id="toneOverride"
                  type="text"
                  value={formData.toneOverride}
                  onChange={(e) =>
                    setFormData({ ...formData, toneOverride: e.target.value })
                  }
                  placeholder="Opcional: reemplaza el tono global"
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="personaOverride">Personalidad (override)</label>
              <textarea
                id="personaOverride"
                value={formData.personaOverride}
                onChange={(e) =>
                  setFormData({ ...formData, personaOverride: e.target.value })
                }
                placeholder="Opcional: reemplaza la personalidad global"
              />
            </div>

            <div className="form-actions">
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Guardando...' : editingAgentId ? 'Guardar cambios' : 'Crear Agente'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setShowNewAgentForm(false);
                  setEditingAgentId(null);
                  setFormData({
                    name: '',
                    description: '',
                    provider: 'ollama',
                    model: '',
                    systemPrompt: '',
                    assistantNameOverride: '',
                    personaOverride: '',
                    toneOverride: '',
                  });
                }}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {agents.length === 0 ? (
          <p className="empty-state">Sin agentes configurados</p>
        ) : (
          <div className="agents-list">
            {agents.map((agent) => (
              <div key={agent.id} className="agent-card surface-card">
                <div className="agent-header">
                  <h3>{agent.name}</h3>
                  <div className="agent-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => handleEditAgent(agent)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => handleDeleteAgent(agent.id)}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
                {agent.description && (
                  <p className="agent-description">{agent.description}</p>
                )}
                <div className="agent-details">
                  <span>
                    <strong>Provider:</strong> {agent.provider}
                  </span>
                  <span>
                    <strong>Modelo:</strong> {agent.model}
                  </span>
                </div>
                {agent.systemPrompt && (
                  <div className="agent-prompt">
                    <strong>System Prompt:</strong>
                    <p>{agent.systemPrompt}</p>
                  </div>
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

export default ConfigPage;
