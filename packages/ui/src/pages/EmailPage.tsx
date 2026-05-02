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
      const msg = e instanceof Error ? e.message : String(e);
      // Dominio esperado: aún sin IMAP/OAuth configurado para ninguna cuenta.
      if (/no enabled email accounts|saved credentials \(imap password or oauth\)/iu.test(msg)) {
        setMessages([]);
        return;
      }
      setError(msg);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  /** No pedir vista previa hasta tener al menos una cuenta con credenciales (evita 400 y ruido en consola). */
  useEffect(() => {
    if (loadingAccounts) return;
    if (!accounts.some((a) => accountReady(a))) {
      setMessages([]);
      return;
    }
    void loadRecent();
  }, [loadingAccounts, accounts, loadRecent]);

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
    try {
      setError(null);
      const res =
        kind === 'google'
          ? await apiClient.startEmailOAuthGoogle(accountId)
          : await apiClient.startEmailOAuthMicrosoft(accountId);
      const authUrl = res.authUrl;
      if (typeof authUrl !== 'string' || !authUrl.startsWith('http')) {
        setError('La API no devolvió una URL de autorización válida.');
        return;
      }
      const w = window.open(authUrl, '_blank', 'noopener,noreferrer');
      if (!w) {
        setError(
          'El navegador bloqueó la ventana emergente. Permití popups para este sitio y reintentá, o abrí esta URL manualmente:\n\n' +
            authUrl
        );
        return;
      }
      setTimeout(() => void loadAccounts(), kind === 'google' ? 3000 : 4000);
    } catch (e) {
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

  /** Lo que la API usa en authorize + token; debe coincidir con Google/Entra (no asumir solo el origin del browser). */
  const gmailCallbackUrl =
    oauthStatus?.googleOAuthRedirectUri ?? `http://127.0.0.1:${apiPortHint}/api/email/oauth/google/callback`;
  const outlookRedirectHint =
    oauthStatus?.microsoftOAuthRedirectUri ??
    (typeof globalThis.window !== 'undefined' && globalThis.window.location?.origin
      ? `${globalThis.window.location.origin}/api/email/oauth/microsoft/callback`
      : 'https://(tu-host-público)/api/email/oauth/microsoft/callback');

  return (
    <div className="email-page page-shell">
      <h2 className="email-heading">Correo</h2>
      <p className="email-lead">
        Todo lo que guardás acá queda en este equipo (<code>~/.enzo/config.json</code>). Nadie más lo ve salvo vos.
      </p>

      <section className="email-section email-guide" aria-labelledby="email-guide-title">
        <h3 id="email-guide-title" className="email-guide-title">
          Qué tenés que hacer (orden sugerido)
        </h3>
        <ol className="email-steps">
          <li>
            <strong>Solo si usás Gmail u Outlook:</strong> en{' '}
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
              Google Cloud
            </a>{' '}
            o{' '}
            <a href="https://entra.microsoft.com/" target="_blank" rel="noreferrer">
              Microsoft Entra
            </a>{' '}
            registrá una app OAuth y obtené Client ID (y secret si aplica). Una sola vez, fuera de Enzo.
          </li>
          <li>
            <strong>Más abajo — «Paso 1»:</strong> pegá esos valores, pulsá <strong>«Guardar aplicaciones OAuth»</strong>. Sin ese
            guardado, no vas a poder conectar Gmail ni Outlook desde Enzo.
          </li>
          <li>
            <strong>«Paso 2» — Agregar cuenta:</strong> definí un <strong>id</strong> corto sólo para Enzo (ej.{' '}
            <code>mi-gmail</code>), etiqueta opcional y tipo gmail / microsoft / imap → <strong>Crear cuenta</strong>.
          </li>
          <li>
            <strong>«Paso 3» — Tarjetas:</strong> Gmail → «Conectar Gmail». Outlook → «Solicitar código» (sin localhost) o
            alternativa redirect. IMAP → contraseña + «Guardar». Luego «Probar conexión» si querés confirmar.
          </li>
        </ol>
        <p className="email-muted email-guide-foot">
          Si un campo dice <strong>(ENV)</strong>, el valor viene de variables de entorno y Enzo usará ese; lo que pongas en pantalla puede ser sólo visual.
        </p>
        <details className="email-details-tech">
          <summary className="email-details-summary">Consolas externos, redirects y ayuda rápida</summary>
          <div className="email-details-body">
            <ul className="email-details-list">
              <li>
                <strong>Gmail (Google Cloud):</strong>{' '}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                  Credenciales
                </a>
                . Tipo habitual: OAuth client &quot;Web application&quot;. Agregá como redirect autorizado{' '}
                <code className="email-code-inline">{gmailCallbackUrl}</code>.
              </li>
              <li>
                <strong>Outlook (Microsoft Entra ID):</strong>{' '}
                <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer">
                  Registro de aplicaciones
                </a>
                . Con <strong>Client ID</strong> guardado acá podés usar el flujo por <strong>código en el navegador</strong> sin
                depender de redirect en localhost. Si usás login por pestaña/redirección, en <strong>Authentication → Web → Redirect URIs</strong>{' '}
                registrá exactamente{' '}
                <code className="email-code-inline">{outlookRedirectHint}</code> (copiado desde la respuesta de la API abajo cuando cargue la página).
              </li>
              <li>
                <strong>Secretos:</strong> si dejás el secret vacío al guardar, no se borra el ya guardado; si escribís y guardás,
                reemplaza. En campos deshabilitados por ENV, no podés cambiar desde la UI.
              </li>
            </ul>
          </div>
        </details>
      </section>

      {error && <div className="email-error">{error}</div>}

      {loadingAccounts && !oauthStatus ? (
        <p className="email-muted email-loading-hint">Cargando valores guardados y formulario OAuth…</p>
      ) : null}

      {oauthStatus && (
        <section className="email-section email-setup-card">
          <h3 className="email-section-title">Paso 1 — Client ID y secret (Gmail / Microsoft)</h3>
          <p className="email-muted email-small-print email-section-hint">
            Copiá desde la consola del proveedor. Guardá antes de abrir la ventana de login de Gmail o de pedir el código de
            Microsoft.
          </p>
          {(oauthStatus.oauthRedirectBase || oauthStatus.googleOAuthRedirectUri || oauthStatus.microsoftOAuthRedirectUri) && (
            <p className="email-muted email-small-print">
              Redirects OAuth que está usando esta instancia de la API:{oauthStatus.oauthRedirectBase ? (
                <>
                  {' '}
                  base <code className="email-code-inline">{oauthStatus.oauthRedirectBase}</code>
                  {oauthStatus.oauthOriginUsesPublicEnvVar ? ' (via ENZO_PUBLIC_API_BASE_URL)' : ''}.
                </>
              ) : null}{' '}
              Gmail: <code className="email-code-inline">{gmailCallbackUrl}</code>. Microsoft:{' '}
              <code className="email-code-inline">{outlookRedirectHint}</code>.
            </p>
          )}
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
              Microsoft Client secret{' '}
              <span className="email-muted email-small-print">
                Si en Entra tu app es <strong>pública</strong> (solo personal + flujo SPA/dispositivo, sin secreto web), dejalo vacío; Enzo igual puede intercambiar el código sin secret si Azure lo permite.
              </span>
              {oauthStatus.microsoft.envClientSecret ? <span className="email-muted"> (ENV)</span> : null}
              <input
                type="password"
                className="email-wide-input"
                disabled={oauthStatus.microsoft.envClientSecret}
                placeholder={
                  oauthStatus.microsoft.persistedHasClientSecret ? '••• dejá vacío para no cambiar' : 'Vacío si la app Azure es cliente público'
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
        <h3 className="email-section-title">Paso 2 — Agregar una cuenta de correo</h3>
        <p className="email-muted email-small-print email-section-hint">
          <strong>id</strong> es un nombre interno (sin espacios); no es tu email. Después conectás la casilla con el botón que
          aparece en la tarjeta.
        </p>
        <div className="email-add-form">
          <div className="email-add-row">
            <label className="email-field-inline">
              id (interno)
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
              Email / dirección (opcional, para mostrar)
              <input value={newAccAddress} onChange={(e) => setNewAccAddress(e.target.value)} placeholder="vos@..." />
            </label>
            {newAccProvider === 'microsoft' ? (
              <label className="email-field-inline">
                Tenant Microsoft (opcional){' '}
                <span className="email-muted email-small-print">
                  Usá <code className="email-code-inline">consumers</code> para solo cuentas personales (.com); no existe{' '}
                  <code className="email-code-inline">consumer</code>. Con Tenant <code className="email-code-inline">common</code> la app
                  en Azure debe tener audiencia «Cualquier tipo de cuenta», no sólo consumidor.
                </span>
                <input
                  value={newAccTenant}
                  onChange={(e) => setNewAccTenant(e.target.value)}
                  placeholder="common · consumers · organizations"
                />
              </label>
            ) : null}
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
        <h3 className="email-section-title">Paso 3 — Conectar cada cuenta</h3>
        <p className="email-muted email-small-print email-section-hint">
          El escudo ⚠️ significa falta autorización (OAuth) o contraseña (IMAP). Usá los botones de la tarjeta; «Probar
          conexión» confirma que ya anda.
        </p>
        {loadingAccounts ? (
          <p>Cargando…</p>
        ) : emptyConfigured ? (
          <div className="email-empty">
            Todavía no hay cuentas. Completá el <strong>Paso 1</strong>, guardá OAuth, cargá datos en{' '}
            <strong>Paso 2</strong> y pulsá <strong>Crear cuenta</strong>.
          </div>
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
                        <code className="email-code-inline">{gmailCallbackUrl}</code>.
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
                          Abrir login Microsoft (nueva pestaña)
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
                      <span className="email-muted email-oauth-note">
                        Outlook: en Entra necesitás permisos delegados Graph{' '}
                        <code className="email-code-inline">Mail.ReadWrite</code> +{' '}
                        <code className="email-code-inline">offline_access</code>; activá{' '}
                        <strong>clientes públicos / flujo de código de dispositivo</strong> si usás «Solicitar código». Redirect
                        (otra opción): registro <strong>Web</strong> en Entra con <em>exactamente</em>{' '}
                        <code className="email-code-inline">{outlookRedirectHint}</code>; si ves <code className="email-code-inline">invalid_request redirect_uri</code>, el valor en Entra no coincide con ese string (scheme, host, puerto y path). Tras un proxy, fijá{' '}
                        <code className="email-code-inline">ENZO_PUBLIC_API_BASE_URL</code> o <code className="email-code-inline">ENZO_TRUST_PROXY</code>. Para{' '}
                        <strong>@outlook.com / Hotmail personal</strong> probá Tenant <code>consumers</code> en la cuenta (Editar). Con login
                        en pestaña: no repitas «Abrir login Microsoft», no recargues la pestaña del callback ni la abras desde el historial después
                        de Authenticator — el código vence rápido y sólo sirve una vez.
                      </span>
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
                              placeholder="consumers (personal), common…"
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
        <p className="email-muted email-small-print email-section-hint" style={{ marginBottom: '0.75rem' }}>
          Después de conectar alguna cuenta, podés revisar aquí algunos mensajes entrantes como comprobación.
        </p>
        <div className="email-section-toolbar">
          <h3 className="email-section-title">Vista previa de emails recientes</h3>
          <button type="button" className="email-btn" onClick={() => void loadRecent()} disabled={loadingRecent}>
            {loadingRecent ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
        {messages.length === 0 && !loadingRecent ? (
          <p className="email-muted">
            No hay vista previa: o no hay mensajes nuevos o ninguna cuenta terminó el <strong>Paso 3</strong> (OAuth o
            contraseña IMAP). Usá «Probar conexión» en la tarjeta y volvé a <strong>Actualizar</strong>.
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
