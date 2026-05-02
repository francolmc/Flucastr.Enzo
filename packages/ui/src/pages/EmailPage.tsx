import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { EmailAccountConfigDTO, EmailMessageDTO, EmailOAuthAppsStatusDTO } from '../types';
import './EmailPage.css';

type TestState = 'idle' | 'ok' | 'error' | 'running';

function accountReady(acc: EmailAccountConfigDTO): boolean {
  if (acc.provider === 'imap') {
    return !!acc.hasPassword;
  }
  return acc.hasOAuth;
}

function badgeForAccount(
  acc: EmailAccountConfigDTO,
  testStatus: TestState
): { emoji: string; label: string } {
  if (!accountReady(acc)) {
    if (acc.provider === 'imap') return { emoji: '⚠️', label: 'Sin contraseña' };
    return { emoji: '⚠️', label: 'Sin OAuth' };
  }
  if (testStatus === 'ok') return { emoji: '✅', label: 'Conectada' };
  if (testStatus === 'error') return { emoji: '❌', label: 'Error' };
  return { emoji: '✅', label: 'Lista' };
}

function mailboxLine(acc: EmailAccountConfigDTO): string {
  const a = acc.address?.trim();
  if (a) return a;
  const u = acc.imap?.user?.trim();
  if (u) return u;
  return '—';
}

function providerLabel(p: EmailAccountConfigDTO['provider']): string {
  if (p === 'google') return 'Gmail (OAuth)';
  if (p === 'microsoft') return 'Outlook / Microsoft (OAuth)';
  return 'IMAP';
}

type Provider = EmailAccountConfigDTO['provider'];

interface EditAccountForm {
  label: string;
  provider: Provider;
  enabled: boolean;
  address: string;
  microsoftTenantId: string;
  imapHost: string;
  imapPort: string;
  imapUser: string;
}

function accountToEditForm(acc: EmailAccountConfigDTO): EditAccountForm {
  return {
    label: acc.label,
    provider: acc.provider,
    enabled: acc.enabled,
    address: acc.address ?? '',
    microsoftTenantId: acc.microsoftTenantId ?? '',
    imapHost: acc.imap?.host ?? '',
    imapPort: String(acc.imap?.port ?? 993),
    imapUser: acc.imap?.user ?? '',
  };
}

interface MicrosoftDeviceDraft {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  message?: string;
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
  const [msDeviceDraft, setMsDeviceDraft] = useState<Record<string, MicrosoftDeviceDraft>>({});
  const [msDeviceBusy, setMsDeviceBusy] = useState<string | null>(null);

  const [oauthStatus, setOauthStatus] = useState<EmailOAuthAppsStatusDTO | null>(null);
  const [oauthGoogleClientId, setOauthGoogleClientId] = useState('');
  const [oauthGoogleClientSecret, setOauthGoogleClientSecret] = useState('');
  const [oauthMsClientId, setOauthMsClientId] = useState('');
  const [oauthMsClientSecret, setOauthMsClientSecret] = useState('');
  const [oauthGoogleSecretTouched, setOauthGoogleSecretTouched] = useState(false);
  const [oauthMsSecretTouched, setOauthMsSecretTouched] = useState(false);
  const [oauthSaving, setOauthSaving] = useState(false);
  const [apiPortHint, setApiPortHint] = useState('3001');

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditAccountForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [newAccId, setNewAccId] = useState('');
  const [newAccLabel, setNewAccLabel] = useState('');
  const [newAccProvider, setNewAccProvider] = useState<Provider>('microsoft');
  const [newAccAddress, setNewAccAddress] = useState('');
  const [newAccTenant, setNewAccTenant] = useState('common');
  const [newImapHost, setNewImapHost] = useState('');
  const [newImapPort, setNewImapPort] = useState('993');
  const [newImapUser, setNewImapUser] = useState('');
  const [newAccSaving, setNewAccSaving] = useState(false);

  function applyOAuthFromApi(d: EmailOAuthAppsStatusDTO) {
    setOauthStatus(d);
    setOauthGoogleClientId(d.googleClientId ?? '');
    setOauthMsClientId(d.microsoftClientId ?? '');
    setOauthGoogleClientSecret('');
    setOauthMsClientSecret('');
    setOauthGoogleSecretTouched(false);
    setOauthMsSecretTouched(false);
  }

  const loadAccounts = useCallback(async () => {
    try {
      setLoadingAccounts(true);
      setError(null);
      const [list, oauth, sysWrap] = await Promise.all([
        apiClient.getEmailAccounts(),
        apiClient.getEmailOAuthApps(),
        apiClient.getSystemConfig().catch(() => null),
      ]);
      setAccounts(list);
      applyOAuthFromApi(oauth);
      const p = sysWrap?.system?.port;
      if (p) setApiPortHint(String(p));
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

  const openOAuthPopup = async (accountId: string, kind: 'google' | 'microsoft') => {
    let tab: Window | null = null;
    try {
      tab = window.open('about:blank', '_blank', 'noopener,noreferrer');
    } catch {
      tab = null;
    }
    try {
      setError(null);
      const { authUrl } =
        kind === 'google'
          ? await apiClient.startEmailOAuthGoogle(accountId)
          : await apiClient.startEmailOAuthMicrosoft(accountId);
      if (tab) {
        tab.location.href = authUrl;
      } else {
        window.location.assign(authUrl);
      }
      setTimeout(() => void loadAccounts(), 3000);
    } catch (e) {
      if (tab) tab.close();
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const requestMicrosoftDevice = async (id: string) => {
    try {
      setMsDeviceBusy(id);
      setError(null);
      const r = await apiClient.startMicrosoftOAuthDevice(id);
      setMsDeviceDraft((prev) => ({
        ...prev,
        [id]: {
          sessionId: r.sessionId,
          userCode: r.userCode,
          verificationUri: r.verificationUri,
          verificationUriComplete: r.verificationUriComplete,
          message: r.message,
        },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMsDeviceBusy(null);
    }
  };

  const completeMicrosoftDeviceSession = async (accountIdCard: string, sessionIdArg: string) => {
    if (!sessionIdArg.trim()) return;
    try {
      setMsDeviceBusy(accountIdCard);
      setError(null);
      await apiClient.completeMicrosoftOAuthDevice(sessionIdArg);
      setMsDeviceDraft((prev) => {
        const copy = { ...prev };
        delete copy[accountIdCard];
        return copy;
      });
      await loadAccounts();
      await loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMsDeviceBusy(null);
    }
  };

  const handleDisconnectOAuth = async (id: string) => {
    try {
      setError(null);
      await apiClient.disconnectEmailOAuth(id);
      setMsDeviceDraft((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      await loadAccounts();
      await loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveOAuthApps = async () => {
    if (!oauthStatus) return;
    try {
      setOauthSaving(true);
      setError(null);
      const payload: Partial<Record<string, string>> = {};
      if (!oauthStatus.google.envClientId) {
        payload.googleClientId = oauthGoogleClientId;
      }
      if (!oauthStatus.microsoft.envClientId) {
        payload.microsoftClientId = oauthMsClientId;
      }
      if (oauthGoogleSecretTouched) payload.googleClientSecret = oauthGoogleClientSecret;
      if (oauthMsSecretTouched) payload.microsoftClientSecret = oauthMsClientSecret;
      const next = await apiClient.saveEmailOAuthApps(payload);
      applyOAuthFromApi(next);
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOauthSaving(false);
    }
  };

  const handleSaveEditedAccount = async () => {
    if (!editingAccountId || !editForm) return;
    if (editForm.provider === 'imap' && (!editForm.imapHost.trim() || !editForm.imapUser.trim())) {
      setError('IMAP requiere host y usuario.');
      return;
    }
    try {
      setEditSaving(true);
      setError(null);
      const patch: Record<string, unknown> = {
        label: editForm.label.trim(),
        provider: editForm.provider,
        enabled: editForm.enabled,
        address: editForm.address.trim(),
        microsoftTenantId: editForm.microsoftTenantId.trim(),
      };
      const hasImapFields = !!(editForm.imapHost.trim() && editForm.imapUser.trim());
      if (editForm.provider === 'imap') {
        patch.imap = {
          host: editForm.imapHost.trim(),
          port: Number(editForm.imapPort) || 993,
          user: editForm.imapUser.trim(),
        };
      } else if (hasImapFields) {
        patch.imap = {
          host: editForm.imapHost.trim(),
          port: Number(editForm.imapPort) || 993,
          user: editForm.imapUser.trim(),
        };
      } else {
        patch.imap = null;
      }

      await apiClient.updateEmailAccount(editingAccountId, patch);
      setEditingAccountId(null);
      setEditForm(null);
      await loadAccounts();
      await loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreateAccount = async () => {
    const id = newAccId.trim();
    if (!id) {
      setError('Ingresá un identificador interno para la cuenta (campo «id»).');
      return;
    }
    if (newAccProvider === 'imap' && (!newImapHost.trim() || !newImapUser.trim())) {
      setError('Cuentas IMAP requieren host y usuario.');
      return;
    }
    try {
      setNewAccSaving(true);
      setError(null);
      const body: Record<string, unknown> = {
        id,
        label: newAccLabel.trim() || id,
        provider: newAccProvider,
        enabled: true,
      };
      if (newAccAddress.trim()) body.address = newAccAddress.trim();
      if (newAccTenant.trim()) body.microsoftTenantId = newAccTenant.trim();
      if (newAccProvider === 'imap') {
        body.imap = {
          host: newImapHost.trim(),
          port: Number(newImapPort) || 993,
          user: newImapUser.trim(),
        };
      } else if (newImapHost.trim() && newImapUser.trim()) {
        body.imap = {
          host: newImapHost.trim(),
          port: Number(newImapPort) || 993,
          user: newImapUser.trim(),
        };
      }

      await apiClient.createEmailAccount(body);
      setNewAccId('');
      setNewAccLabel('');
      setNewAccProvider('microsoft');
      setNewAccAddress('');
      setNewAccTenant('common');
      setNewImapHost('');
      setNewImapPort('993');
      setNewImapUser('');
      await loadAccounts();
      await loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNewAccSaving(false);
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    if (!globalThis.confirm(`¿Eliminar la cuenta «${accountId}» del config? Perderás credenciales asociadas.`)) {
      return;
    }
    try {
      setError(null);
      await apiClient.deleteEmailAccount(accountId);
      setEditingAccountId((cur) => (cur === accountId ? null : cur));
      await loadAccounts();
      await loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const emptyConfigured = accounts.length === 0;

  return (
    <div className="email-page">
      <h2 className="email-heading">Correo</h2>
      <p className="email-lead">
        Configurá desde aquí cuentas, client OAuth y contraseña IMAP. Los datos se persisten en{' '}
        <code>~/.enzo/config.json</code>.
        <br />
        <strong>Outlook</strong>: después de cargar Client ID aquí podés usar <em>código en el navegador</em> (sin
        redirect localhost). <strong>Gmail API</strong>: completá Client ID/Secret y registrá en Google Console el
        redirect <code>http://127.0.0.1:{apiPortHint}/api/email/oauth/google/callback</code>.
        <br />Si ves “definido por variable de entorno”, la UI muestra valores guardados pero al conectar manda ENV.
      </p>
      {error && <div className="email-error">{error}</div>}

      {oauthStatus && (
        <section className="email-section email-setup-card">
          <h3 className="email-section-title">Client ID / secret OAuth (solo este equipo)</h3>
          <p className="email-muted email-small-print">
            Secreto: dejalo vacío y no se cambia · vacío después de enfocarlo y Guardar puede borrar el secreto
            persistido si tu cliente lo permite.
          </p>
          <div className="email-oauth-fields">
            <label className="email-field-label">
              Gmail Client ID{' '}
              {oauthStatus.google.envClientId && <span className="email-muted"> (ENV)</span>}
              <input
                type="text"
                className="email-wide-input"
                disabled={oauthStatus.google.envClientId}
                value={oauthGoogleClientId}
                onChange={(e) => setOauthGoogleClientId(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="email-field-label">
              Gmail Client secret
              {oauthStatus.google.envClientSecret ? <span className="email-muted"> (ENV)</span> : null}
              <input
                type="password"
                className="email-wide-input"
                disabled={oauthStatus.google.envClientSecret}
                placeholder={
                  oauthStatus.google.persistedHasClientSecret ? '••• dejá vacío para no cambiar' : 'Opcional'
                }
                value={oauthGoogleClientSecret}
                onChange={(e) => {
                  setOauthGoogleSecretTouched(true);
                  setOauthGoogleClientSecret(e.target.value);
                }}
                autoComplete="new-password"
              />
            </label>
            <label className="email-field-label">
              Microsoft Client ID
              {oauthStatus.microsoft.envClientId ? <span className="email-muted"> (ENV)</span> : null}
              <input
                type="text"
                className="email-wide-input"
                disabled={oauthStatus.microsoft.envClientId}
                value={oauthMsClientId}
                onChange={(e) => setOauthMsClientId(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="email-field-label">
              Microsoft Client secret
              {oauthStatus.microsoft.envClientSecret ? <span className="email-muted"> (ENV)</span> : null}
              <input
                type="password"
                className="email-wide-input"
                disabled={oauthStatus.microsoft.envClientSecret}
                placeholder={
                  oauthStatus.microsoft.persistedHasClientSecret ? '••• dejá vacío para no cambiar' : 'Opcional'
                }
                value={oauthMsClientSecret}
                onChange={(e) => {
                  setOauthMsSecretTouched(true);
                  setOauthMsClientSecret(e.target.value);
                }}
                autoComplete="new-password"
              />
            </label>
          </div>
          <button type="button" className="email-btn primary" disabled={oauthSaving} onClick={() => void handleSaveOAuthApps()}>
            {oauthSaving ? 'Guardando…' : 'Guardar aplicaciones OAuth'}
          </button>
        </section>
      )}

      <section className="email-section">
        <h3 className="email-section-title">Agregar cuenta</h3>
        <div className="email-add-form">
          <div className="email-add-row">
            <label className="email-field-inline">
              id
              <input value={newAccId} onChange={(e) => setNewAccId(e.target.value)} placeholder="ej. gmail-lab" />
            </label>
            <label className="email-field-inline">
              Nombre
              <input value={newAccLabel} onChange={(e) => setNewAccLabel(e.target.value)} placeholder="Alias" />
            </label>
            <label className="email-field-inline">
              Tipo
              <select value={newAccProvider} onChange={(e) => setNewAccProvider(e.target.value as Provider)}>
                <option value="microsoft">microsoft</option>
                <option value="google">google</option>
                <option value="imap">imap</option>
              </select>
            </label>
          </div>
          <div className="email-add-row">
            <label className="email-field-inline">
              Dirección (opcional)
              <input value={newAccAddress} onChange={(e) => setNewAccAddress(e.target.value)} />
            </label>
            <label className="email-field-inline">
              Tenant MS (opcional)
              <input value={newAccTenant} onChange={(e) => setNewAccTenant(e.target.value)} />
            </label>
          </div>
          {(newAccProvider === 'imap' || newAccProvider === 'google' || newAccProvider === 'microsoft') && (
            <>
              {newAccProvider !== 'imap' ? (
                <p className="email-muted email-small-print">
                  IMAP opcional: solo si querés guardar host/usuario de referencia en el config.
                </p>
              ) : null}
              <div className="email-add-row">
                <label className="email-field-inline">
                  IMAP host
                  <input
                    value={newImapHost}
                    onChange={(e) => setNewImapHost(e.target.value)}
                    placeholder={newAccProvider === 'imap' ? '' : 'opcional'}
                  />
                </label>
                <label className="email-field-inline">
                  Puerto
                  <input value={newImapPort} onChange={(e) => setNewImapPort(e.target.value)} />
                </label>
                <label className="email-field-inline">
                  Usuario
                  <input
                    value={newImapUser}
                    onChange={(e) => setNewImapUser(e.target.value)}
                    placeholder={newAccProvider === 'imap' ? '' : 'opcional'}
                  />
                </label>
              </div>
            </>
          )}
          <button
            type="button"
            className="email-btn primary"
            disabled={newAccSaving || !newAccId.trim()}
            onClick={() => void handleCreateAccount()}
          >
            {newAccSaving ? 'Creando…' : 'Crear cuenta'}
          </button>
        </div>
      </section>

      <section className="email-section">
        <h3 className="email-section-title">Cuentas configuradas</h3>
        {loadingAccounts ? (
          <p>Cargando…</p>
        ) : emptyConfigured ? (
          <div className="email-empty">Todavía no hay cuentas. Usá «Agregar cuenta» arriba.</div>
        ) : (
          <div className="email-cards">
            {accounts.map((acc) => {
              const testStatus = testUi[acc.id] ?? 'idle';
              const b = badgeForAccount(acc, testStatus);
              return (
                <article key={acc.id} className="email-card">
                  <header className="email-card-head">
                    <div>
                      <strong>{acc.label}</strong>
                      <div className="email-card-user">{mailboxLine(acc)}</div>
                      <div className="email-muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                        {providerLabel(acc.provider)}
                        {acc.microsoftTenantId ? ` · Tenant: ${acc.microsoftTenantId}` : ''}
                      </div>
                    </div>
                    <span className="email-badge" title={b.label}>
                      {b.emoji} {b.label}
                    </span>
                  </header>
                  <div className="email-card-actions email-card-actions-spread">
                    <div className="email-card-actions-left">
                      <button type="button" className="email-btn ghost" onClick={() => void handleTest(acc.id)}>
                        Probar conexión
                      </button>
                      <label className="email-toggle">
                        <input
                          type="checkbox"
                          checked={acc.enabled}
                          disabled={editSaving && editingAccountId === acc.id}
                          onChange={(e) => void handleToggle(acc.id, e.target.checked)}
                        />
                        Habilitada
                      </label>
                    </div>
                    <div className="email-card-actions-right">
                      <button
                        type="button"
                        className="email-btn ghost"
                        onClick={() => {
                          setEditingAccountId(acc.id);
                          setEditForm(accountToEditForm(acc));
                        }}
                      >
                        Editar
                      </button>
                      <button type="button" className="email-btn ghost" onClick={() => void handleDeleteAccount(acc.id)}>
                        Eliminar
                      </button>
                    </div>
                  </div>
                  {acc.provider === 'imap' ? (
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
                  ) : acc.provider === 'google' ? (
                    <div className="email-password-row email-oauth-row">
                      <button
                        type="button"
                        className="email-btn primary"
                        onClick={() => void openOAuthPopup(acc.id, 'google')}
                      >
                        {acc.hasOAuth ? 'Reconectar Gmail (OAuth)' : 'Conectar Gmail (OAuth)'}
                      </button>
                      {acc.hasOAuth && (
                        <button
                          type="button"
                          className="email-btn ghost"
                          onClick={() => void handleDisconnectOAuth(acc.id)}
                        >
                          Desconectar
                        </button>
                      )}
                      <span className="email-muted email-oauth-note">
                        Completá Gmail Client ID arriba; en Google Console registrá el redirect{' '}
                        <code>http://127.0.0.1:{apiPortHint}/api/email/oauth/google/callback</code>.
                      </span>
                    </div>
                  ) : (
                    <div className="email-password-row email-oauth-row email-ms-oauth-stack">
                      <div className="email-ms-buttons">
                        <button
                          type="button"
                          className="email-btn primary"
                          disabled={msDeviceBusy === acc.id}
                          onClick={() => void requestMicrosoftDevice(acc.id)}
                        >
                          Solicitar código (sin redirect localhost)
                        </button>
                        {msDeviceDraft[acc.id]?.sessionId && (
                          <button
                            type="button"
                            className="email-btn"
                            disabled={msDeviceBusy === acc.id}
                            onClick={() => {
                              const sid = msDeviceDraft[acc.id]?.sessionId;
                              if (!sid) return;
                              void completeMicrosoftDeviceSession(acc.id, sid);
                            }}
                          >
                            {msDeviceBusy === acc.id ? 'Esperando a Microsoft…' : 'Ya autoricé'}
                          </button>
                        )}
                        <button type="button" className="email-btn ghost" onClick={() => void openOAuthPopup(acc.id, 'microsoft')}>
                          Alternativa redirect localhost
                        </button>
                        {acc.hasOAuth && (
                          <button
                            type="button"
                            className="email-btn ghost"
                            onClick={() => void handleDisconnectOAuth(acc.id)}
                          >
                            Desconectar OAuth
                          </button>
                        )}
                      </div>
                      {msDeviceDraft[acc.id] && (
                        <div className="email-device-instructions email-muted">
                          <p>
                            1. Abrí{' '}
                            <a href={msDeviceDraft[acc.id].verificationUriComplete ?? msDeviceDraft[acc.id].verificationUri} target="_blank" rel="noreferrer">
                              {msDeviceDraft[acc.id].verificationUri}
                            </a>
                          </p>
                          <p>
                            2. Ingresá el código{' '}
                            <code style={{ fontSize: '1.05em', letterSpacing: '0.04em' }}>{msDeviceDraft[acc.id].userCode}</code>
                          </p>
                          <p>{msDeviceDraft[acc.id].message ?? 'Luego pulsá «Ya autoricé» aquí.'}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {editingAccountId === acc.id && editForm ? (
                    <div className="email-edit-panel">
                      <h4 className="email-edit-title">Editar cuenta</h4>
                      <div className="email-add-row">
                        <label className="email-field-inline">
                          Nombre
                          <input
                            value={editForm.label}
                            onChange={(e) => setEditForm((f) => (f ? { ...f, label: e.target.value } : f))}
                          />
                        </label>
                        <label className="email-field-inline">
                          Tipo
                          <select
                            value={editForm.provider}
                            onChange={(e) =>
                              setEditForm((f) =>
                                f ? { ...f, provider: e.target.value as Provider } : f
                              )
                            }
                          >
                            <option value="microsoft">microsoft</option>
                            <option value="google">google</option>
                            <option value="imap">imap</option>
                          </select>
                        </label>
                        <label className="email-field-checkbox">
                          <input
                            type="checkbox"
                            checked={editForm.enabled}
                            onChange={(e) =>
                              setEditForm((f) => (f ? { ...f, enabled: e.target.checked } : f))
                            }
                          />
                          Habilitada
                        </label>
                      </div>
                      <div className="email-add-row">
                        <label className="email-field-inline">
                          Dirección visible
                          <input
                            value={editForm.address}
                            placeholder="usuario@..."
                            onChange={(e) => setEditForm((f) => (f ? { ...f, address: e.target.value } : f))}
                          />
                        </label>
                        {editForm.provider === 'microsoft' ? (
                          <label className="email-field-inline">
                            Tenant
                            <input
                              value={editForm.microsoftTenantId}
                              placeholder="common"
                              onChange={(e) =>
                                setEditForm((f) => (f ? { ...f, microsoftTenantId: e.target.value } : f))
                              }
                            />
                          </label>
                        ) : null}
                      </div>
                      {editForm.provider === 'imap' ? (
                        <div className="email-muted email-small-print" style={{ marginBottom: 8 }}>
                          Host / usuario obligatorios. La contraseña se cambia fuera del panel de edición.
                        </div>
                      ) : null}
                      <div className="email-add-row">
                        <label className="email-field-inline">
                          IMAP host
                          <input
                            value={editForm.imapHost}
                            onChange={(e) => setEditForm((f) => (f ? { ...f, imapHost: e.target.value } : f))}
                            placeholder={editForm.provider === 'imap' ? 'imap.ejemplo.com' : 'opcional'}
                          />
                        </label>
                        <label className="email-field-inline">
                          IMAP puerto
                          <input
                            value={editForm.imapPort}
                            onChange={(e) => setEditForm((f) => (f ? { ...f, imapPort: e.target.value } : f))}
                          />
                        </label>
                        <label className="email-field-inline">
                          IMAP usuario
                          <input
                            value={editForm.imapUser}
                            onChange={(e) => setEditForm((f) => (f ? { ...f, imapUser: e.target.value } : f))}
                            placeholder={editForm.provider === 'imap' ? 'usuario' : 'opcional'}
                          />
                        </label>
                      </div>
                      {editForm.provider !== 'imap' ? (
                        <p className="email-muted email-small-print">
                          Dejá IMAP vacío salvo que quieras guardar un servidor de referencia; vacío borra IMAP
                          opcional en el config.
                        </p>
                      ) : null}
                      <div className="email-edit-actions">
                        <button
                          type="button"
                          className="email-btn primary"
                          disabled={editSaving}
                          onClick={() => void handleSaveEditedAccount()}
                        >
                          {editSaving ? 'Guardando…' : 'Guardar cambios'}
                        </button>
                        <button
                          type="button"
                          className="email-btn ghost"
                          disabled={editSaving}
                          onClick={() => {
                            setEditingAccountId(null);
                            setEditForm(null);
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}
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
            Sin mensajes o sin ninguna cuenta con credenciales (IMAP guardada / OAuth OK).
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
