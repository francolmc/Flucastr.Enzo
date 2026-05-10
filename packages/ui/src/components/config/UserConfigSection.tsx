import { useState } from 'react';
import { useEnzoStore } from '../../stores/enzoStore';

export function UserConfigSection() {
  const { userId, setUserId, loadConversations } = useEnzoStore();
  const [webUserIdDraft, setWebUserIdDraft] = useState(userId);
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveUserId = async () => {
    setIsSaving(true);
    try {
      setUserId(webUserIdDraft);
      await loadConversations();
      // Mostrar éxito brevemente
      setTimeout(() => setIsSaving(false), 1000);
    } catch (error) {
      console.error('Error saving user ID:', error);
      setIsSaving(false);
    }
  };

  return (
    <div className="surface-card">
      <h3>ID de Usuario</h3>
      <p className="config-card-description">
        Configura tu ID para sincronizar conversaciones entre Telegram y la web.
      </p>
      
      <div className="form-group">
        <label htmlFor="webEnzoUserId">User ID</label>
        <input
          id="webEnzoUserId"
          type="text"
          value={webUserIdDraft}
          onChange={(e) => setWebUserIdDraft(e.target.value)}
          placeholder="Ej. 123456789 o franco"
          autoComplete="off"
          spellCheck={false}
        />
        <small className="form-hint">
          Usa el mismo ID que en Telegram para ver tus conversaciones
        </small>
      </div>
      
      <div className="form-actions">
        <button
          type="button"
          onClick={handleSaveUserId}
          disabled={isSaving || webUserIdDraft === userId}
          className="primary"
        >
          {isSaving ? 'Guardando...' : 'Guardar ID'}
        </button>
      </div>
    </div>
  );
}
