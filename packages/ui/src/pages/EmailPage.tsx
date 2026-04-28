import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { EmailAccountConfigDTO, EmailMessageDTO } from '../types';
import './EmailPage.css';

type TestState = 'idle' | 'ok' | 'error' | 'running';

function badgeForAccount(
  hasPassword: boolean,
  testStatus: TestState
): { emoji: string; label: string } {
  if (!hasPassword) return { emoji: '⚠️', label: 'Sin contraseña' };
  if (testStatus === 'ok') return { emoji: '✅', label: 'Conectada' };
  if (testStatus === 'error') return { emoji: '❌', label: 'Error' };
  return { emoji: '✅', label: 'Lista' };
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export default function EmailPage() {
  const [accounts, setAccounts] = useState<EmailAccountConfigDTO[]>([]);
  const [messages, setMessages] = useState<EmailMessageDTO[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [testUi, setTestUi] = useState<Record<string, TestState>>({});

  const loadAccounts = useCallback(async () => {
    try {
      setError(null);
      const list = await apiClient.getEmailAccounts();
      setAccounts(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      setLoadingRecent(true);
      setError(null);
      const list = await apiClient.getRecentEmails(10);
      setMessages(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const handleSavePassword = async (id: string) => {
    const pwd = passwords[id]?.trim();
    if (!pwd) return;
    try {
      setError(null);
      await apiClient.setEmailPassword(id, pwd);
      setPasswords((p) => ({ ...p, [id]: '' }));
      await loadAccounts();
      await loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleToggle = async (id: string, nextEnabled: boolean) => {
    try {
      setError(null);
      await apiClient.toggleEmailAccount(id, nextEnabled);
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleTest = async (id: string) => {
    setTestUi((t) => ({ ...t, [id]: 'running' }));
    try {
      const r = await apiClient.testEmailAccount(id);
      setTestUi((t) => ({ ...t, [id]: r.success ? 'ok' : 'error' }));
    } catch {
      setTestUi((t) => ({ ...t, [id]: 'error' }));
    }
  };

  const emptyConfigured = accounts.length === 0;

  return (
    <div className="email-page">
      <h2 className="email-heading">Correo IMAP</h2>
      <p className="email-lead">
        Gestioná cuentas (Outlook / Gmail). Las contraseñas se guardan cifradas en ~/.enzo/config.json.
      </p>
      {error && <div className="email-error">{error}</div>}

      <section className="email-section">
        <h3 className="email-section-title">Cuentas configuradas</h3>
        {loadingAccounts ? (
          <p>Cargando…</p>
        ) : emptyConfigured ? (
          <div className="email-empty">
            No hay cuentas de email configuradas. Editá ~/.enzo/config.json para agregar tus cuentas.
          </div>
        ) : (
          <div className="email-cards">
            {accounts.map((acc) => {
              const testStatus = testUi[acc.id] ?? 'idle';
              const b = badgeForAccount(acc.hasPassword, testStatus);
              return (
                <article key={acc.id} className="email-card">
                  <header className="email-card-head">
                    <div>
                      <strong>{acc.label}</strong>
                      <div className="email-card-user">{acc.imap.user}</div>
                    </div>
                    <span className="email-badge" title={b.label}>
                      {b.emoji} {b.label}
                    </span>
                  </header>
                  <div className="email-card-actions">
                    <button type="button" className="email-btn ghost" onClick={() => void handleTest(acc.id)}>
                      Probar conexión
                    </button>
                    <label className="email-toggle">
                      <input
                        type="checkbox"
                        checked={acc.enabled}
                        onChange={(e) => void handleToggle(acc.id, e.target.checked)}
                      />
                      Habilitada
                    </label>
                  </div>
                  <div className="email-password-row">
                    <input
                      type="password"
                      placeholder="Contraseña (app password)"
                      autoComplete="new-password"
                      value={passwords[acc.id] ?? ''}
                      onChange={(e) =>
                        setPasswords((p) => ({
                          ...p,
                          [acc.id]: e.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="email-btn primary"
                      onClick={() => void handleSavePassword(acc.id)}
                    >
                      Guardar
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="email-section">
        <div className="email-section-toolbar">
          <h3 className="email-section-title">Vista previa de emails recientes</h3>
          <button type="button" className="email-btn" onClick={() => void loadRecent()} disabled={loadingRecent}>
            {loadingRecent ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
        {messages.length === 0 && !loadingRecent ? (
          <p className="email-muted">
            Sin mensajes para mostrar o sin cuentas con contraseña habilitadas.
          </p>
        ) : (
          <div className="email-table-wrap">
            <table className="email-table">
              <thead>
                <tr>
                  <th>De</th>
                  <th>Asunto</th>
                  <th>Cuenta</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={`${m.accountId ?? ''}-${m.id}-${String(m.date)}`}>
                    <td className="email-cell-from">{m.from}</td>
                    <td>{m.subject}</td>
                    <td>{m.accountLabel ?? m.accountId ?? '—'}</td>
                    <td>{formatShortDate(m.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
