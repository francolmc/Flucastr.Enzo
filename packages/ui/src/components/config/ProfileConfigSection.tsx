import { useState, useEffect } from 'react';
import { useEnzoStore } from '../../stores/enzoStore';

export function ProfileConfigSection() {
  const { assistantProfile, userProfile, updateProfilesConfig } = useEnzoStore();
  const [profileForm, setProfileForm] = useState({
    assistantName: '',
    assistantPersona: '',
    assistantTone: '',
    userDisplayName: '',
    userLocale: '',
    userTimezone: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (assistantProfile && userProfile) {
      setProfileForm({
        assistantName: assistantProfile.name || '',
        assistantPersona: assistantProfile.persona || '',
        assistantTone: assistantProfile.tone || '',
        userDisplayName: userProfile.displayName || '',
        userLocale: userProfile.locale || '',
        userTimezone: userProfile.timezone || '',
      });
    }
  }, [assistantProfile, userProfile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileForm.assistantName.trim()) {
      alert('El nombre del asistente es obligatorio');
      return;
    }

    setIsSaving(true);
    try {
      await updateProfilesConfig({
        assistantProfile: {
          name: profileForm.assistantName,
          persona: profileForm.assistantPersona,
          tone: profileForm.assistantTone,
          styleGuidelines: '',
        },
        userProfile: {
          displayName: profileForm.userDisplayName,
          importantInfo: '',
          preferences: '',
          locale: profileForm.userLocale,
          timezone: profileForm.userTimezone,
        },
      });
      alert('Perfil guardado exitosamente');
    } catch (error) {
      console.error('Error saving profiles:', error);
      alert('Error al guardar perfil');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="surface-card">
      <h3>Perfiles de Usuario y Asistente</h3>
      <p className="config-card-description">
        Personaliza cómo interactúa el asistente contigo.
      </p>

      <form onSubmit={handleSave}>
        <div className="form-section">
          <h4>Asistente</h4>
          <div className="form-group">
            <label htmlFor="assistantName">Nombre *</label>
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
            <label htmlFor="assistantTone">Tono de comunicación</label>
            <input
              id="assistantTone"
              type="text"
              value={profileForm.assistantTone}
              onChange={(e) => setProfileForm({ ...profileForm, assistantTone: e.target.value })}
              placeholder="Ej. directo, claro y cercano"
            />
          </div>

          <button
            type="button"
            className="secondary"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? 'Ocultar' : 'Mostrar'} opciones avanzadas
          </button>

          {showAdvanced && (
            <div className="form-group">
              <label htmlFor="assistantPersona">Personalidad detallada</label>
              <textarea
                id="assistantPersona"
                value={profileForm.assistantPersona}
                onChange={(e) => setProfileForm({ ...profileForm, assistantPersona: e.target.value })}
                placeholder="Describe cómo debe comportarse el asistente"
                rows={3}
              />
            </div>
          )}
        </div>

        <div className="form-section">
          <h4>Usuario</h4>
          <div className="form-group">
            <label htmlFor="userDisplayName">Tu nombre</label>
            <input
              id="userDisplayName"
              type="text"
              value={profileForm.userDisplayName}
              onChange={(e) => setProfileForm({ ...profileForm, userDisplayName: e.target.value })}
              placeholder="Cómo debe llamarte el asistente"
            />
          </div>

          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="userLocale">Idioma</label>
              <input
                id="userLocale"
                type="text"
                value={profileForm.userLocale}
                onChange={(e) => setProfileForm({ ...profileForm, userLocale: e.target.value })}
                placeholder="es-CL"
              />
            </div>
            <div className="form-group">
              <label htmlFor="userTimezone">Zona horaria</label>
              <input
                id="userTimezone"
                type="text"
                value={profileForm.userTimezone}
                onChange={(e) => setProfileForm({ ...profileForm, userTimezone: e.target.value })}
                placeholder="America/Santiago"
              />
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" disabled={isSaving}>
            {isSaving ? 'Guardando...' : 'Guardar perfiles'}
          </button>
        </div>
      </form>
    </div>
  );
}
