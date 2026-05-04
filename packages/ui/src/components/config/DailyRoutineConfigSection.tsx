import { useState, useEffect } from 'react';
import { useEnzoStore } from '../../stores/enzoStore';
import type { DailyRoutineConfigUpdate } from '../../types';

const ROUTINE_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  morningBriefing: {
    label: 'Briefing Matutino',
    description: 'Emails, calendario, tareas pendientes y top 3 prioridades',
    icon: '🌅',
  },
  middayCheckin: {
    label: 'Check-in Mediodía',
    description: 'Revisión de progreso y tareas completadas',
    icon: '🕐',
  },
  afternoonPrep: {
    label: 'Prep Tarde/Clases',
    description: 'Preparación para clases o reuniones importantes',
    icon: '🎒',
  },
  eveningRecap: {
    label: 'Recap Nocturno',
    description: 'Resumen del día y planificación para mañana',
    icon: '🌙',
  },
};

export function DailyRoutineConfigSection() {
  const { dailyRoutineConfig, loadDailyRoutineConfig, updateDailyRoutineConfig } = useEnzoStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<{
    morningBriefing: { time: string; enabled: boolean };
    middayCheckin: { time: string; enabled: boolean };
    afternoonPrep: { time: string; enabled: boolean };
    eveningRecap: { time: string; enabled: boolean };
  }>({
    morningBriefing: { time: '08:00', enabled: true },
    middayCheckin: { time: '13:00', enabled: true },
    afternoonPrep: { time: '18:00', enabled: true },
    eveningRecap: { time: '22:00', enabled: true },
  });

  useEffect(() => {
    setIsLoading(true);
    loadDailyRoutineConfig()
      .then(() => setIsLoading(false))
      .catch(() => setIsLoading(false));
  }, [loadDailyRoutineConfig]);

  useEffect(() => {
    if (dailyRoutineConfig) {
      setFormData({
        morningBriefing: { ...dailyRoutineConfig.morningBriefing },
        middayCheckin: { ...dailyRoutineConfig.middayCheckin },
        afternoonPrep: { ...dailyRoutineConfig.afternoonPrep },
        eveningRecap: { ...dailyRoutineConfig.eveningRecap },
      });
    }
  }, [dailyRoutineConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload: DailyRoutineConfigUpdate = {
        morningBriefing: { time: formData.morningBriefing.time, enabled: formData.morningBriefing.enabled },
        middayCheckin: { time: formData.middayCheckin.time, enabled: formData.middayCheckin.enabled },
        afternoonPrep: { time: formData.afternoonPrep.time, enabled: formData.afternoonPrep.enabled },
        eveningRecap: { time: formData.eveningRecap.time, enabled: formData.eveningRecap.enabled },
      };
      await updateDailyRoutineConfig(payload);
      alert('Configuración de rutina diaria guardada');
    } catch (error) {
      console.error('Error saving daily routine config:', error);
      alert('Error al guardar configuración de rutina diaria');
    } finally {
      setIsSaving(false);
    }
  };

  const updateTime = (key: keyof typeof formData, time: string) => {
    setFormData((prev) => ({
      ...prev,
      [key]: { ...prev[key], time },
    }));
  };

  const toggleEnabled = (key: keyof typeof formData) => {
    setFormData((prev) => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key].enabled },
    }));
  };

  if (isLoading) {
    return (
      <div className="surface-card" style={{ padding: '1rem 1.25rem' }}>
        <p className="muted">Cargando configuración de rutina diaria...</p>
      </div>
    );
  }

  return (
    <form className="agent-form surface-card" onSubmit={handleSave}>
      <p className="config-card-description">
        Configura las notificaciones automáticas que Enzo te enviará durante el día.
        Cada notificación usa skills específicas para ayudarte con tu rutina.
      </p>

      <div className="daily-routine-grid">
        {Object.entries(ROUTINE_LABELS).map(([key, { label, description, icon }]) => {
          const routineKey = key as keyof typeof formData;
          return (
            <div
              key={key}
              className={`routine-card ${formData[routineKey].enabled ? 'enabled' : 'disabled'}`}
              style={{
                padding: '1rem',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                marginBottom: '0.75rem',
                opacity: formData[routineKey].enabled ? 1 : 0.7,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1.5rem' }}>{icon}</span>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: '1rem' }}>{label}</h4>
                  <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                    {description}
                  </p>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formData[routineKey].enabled}
                    onChange={() => toggleEnabled(routineKey)}
                  />
                  <span>Activo</span>
                </label>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label htmlFor={`${key}-time`}>Hora</label>
                <input
                  id={`${key}-time`}
                  type="time"
                  value={formData[routineKey].time}
                  onChange={(e) => updateTime(routineKey, e.target.value)}
                  disabled={!formData[routineKey].enabled}
                  style={{ width: '120px' }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="form-actions">
        <button type="submit" disabled={isSaving}>
          {isSaving ? 'Guardando...' : 'Guardar configuración de rutina'}
        </button>
      </div>
    </form>
  );
}
