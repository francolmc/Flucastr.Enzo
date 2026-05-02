import crypto from 'node:crypto';
import { Router, Request, Response } from 'express';
import {
  buildGoogleAuthorizationUrl,
  buildMicrosoftAuthorizationUrl,
  ConfigService,
  EmailService,
  exchangeGoogleAuthorizationCode,
  exchangeMicrosoftAuthorizationCode,
  pollMicrosoftDeviceUntilTokens,
  requestMicrosoftDeviceCode,
} from '@enzo/core';

type OAuthProvider = 'google' | 'microsoft';

interface OAuthPending {
  accountId: string;
  provider: OAuthProvider;
  expires: number;
  /** Igual que en el authorize inicial; obligatorio para el canje de código. */
  oauthRedirectUri?: string;
  /** PKCE verifier (solo Microsoft authorize → token). */
  microsoftCodeVerifier?: string;
}

const oauthPendingByState = new Map<string, OAuthPending>();
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

function pruneOAuthStates(): void {
  const now = Date.now();
  for (const [k, v] of oauthPendingByState.entries()) {
    if (v.expires <= now) oauthPendingByState.delete(k);
  }
}

function mintOAuthState(accountId: string, provider: OAuthProvider, oauthRedirectUri?: string): string {
  pruneOAuthStates();
  const token = crypto.randomBytes(24).toString('hex');
  oauthPendingByState.set(token, {
    accountId,
    provider,
    expires: Date.now() + OAUTH_STATE_TTL_MS,
    ...(oauthRedirectUri ? { oauthRedirectUri } : {}),
  });
  return token;
}

/** Microsoft authorize + PKCE (recomendado para apps tipo SPA / entra público moderno). */
function mintMicrosoftOAuthStateWithPkce(
  accountId: string,
  redirectUriExact: string
): { state: string; codeChallenge: string } {
  pruneOAuthStates();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(24).toString('hex');
  oauthPendingByState.set(state, {
    accountId,
    provider: 'microsoft',
    expires: Date.now() + OAUTH_STATE_TTL_MS,
    microsoftCodeVerifier: verifier,
    oauthRedirectUri: redirectUriExact,
  });
  return { state, codeChallenge };
}

function consumeOAuthState(stateRaw: unknown): OAuthPending | null {
  pruneOAuthStates();
  const state = typeof stateRaw === 'string' ? stateRaw.trim() : '';
  if (!state) return null;
  const row = oauthPendingByState.get(state);
  if (!row || row.expires <= Date.now()) {
    if (state) oauthPendingByState.delete(state);
    return null;
  }
  oauthPendingByState.delete(state);
  return row;
}

/** Registros Azure «solo cuenta Microsoft personal» exigen autoridad `/consumers` (AADSTS9002346 si usás `/common`). */
async function microsoftDeviceInitWithConsumersFallback(params: {
  tenant: string;
  clientId: string;
}): Promise<{
  dev: Awaited<ReturnType<typeof requestMicrosoftDeviceCode>>;
  resolvedTenant: string;
}> {
  const clientId = params.clientId;
  let tenant = (params.tenant || '').trim() || 'common';
  try {
    const dev = await requestMicrosoftDeviceCode({ tenant, clientId });
    return { dev, resolvedTenant: tenant };
  } catch (e1) {
    const m1 = e1 instanceof Error ? e1.message : String(e1);
    if (/AADSTS9002346|\/consumers endpoint/i.test(m1) && tenant !== 'consumers') {
      tenant = 'consumers';
      const dev = await requestMicrosoftDeviceCode({ tenant, clientId });
      return { dev, resolvedTenant: tenant };
    }
    throw e1;
  }
}

/**
 * URL base donde Microsoft/Google redirigirán (sin path). Orden:
 * 1. ENZO_PUBLIC_API_BASE_URL explícito
 * 2. Si ENZO_OAUTH_ORIGIN_FROM_REQUEST ≠ '0', derivar del request (Host / X-Forwarded-*)
 * 3. http://127.0.0.1:{system.port}
 */
function oauthOriginFromRequest(req: Pick<Request, 'protocol' | 'get' | 'socket'>): string | null {
  const xfProto = req.get?.('x-forwarded-proto')?.split(',')[0]?.trim()?.toLowerCase();
  let proto =
    xfProto === 'https' || xfProto === 'http'
      ? xfProto
      : (typeof req.protocol === 'string' ? req.protocol.replace(/:$/, '') : '') || '';

  const xfHost = req.get?.('x-forwarded-host')?.split(',')[0]?.trim();
  const hostRaw = xfHost || req.get?.('host')?.split(',')[0]?.trim();
  if (!hostRaw || typeof hostRaw !== 'string') {
    return null;
  }

  const socketEncrypted =
    !!(req.socket && typeof req.socket === 'object' && 'encrypted' in req.socket && req.socket.encrypted);
  if (proto !== 'https' && proto !== 'http') {
    proto = socketEncrypted ? 'https' : 'http';
  }

  try {
    return new URL(`${proto}://${hostRaw}`).origin;
  } catch {
    return null;
  }
}

function resolveOAuthRedirectBase(req: Request | undefined, configService: ConfigService): string {
  const envRaw = process.env.ENZO_PUBLIC_API_BASE_URL?.trim();
  if (envRaw) {
    return envRaw.replace(/\/$/, '');
  }

  const allowDerived = process.env.ENZO_OAUTH_ORIGIN_FROM_REQUEST !== '0';
  if (req && allowDerived) {
    const fromReq = oauthOriginFromRequest(req);
    if (fromReq) return fromReq.replace(/\/$/, '');
  }

  const port = configService.getSystemConfig().port || '3001';
  const host = process.env.ENZO_API_BIND_HOST?.trim() || '127.0.0.1';
  return `http://${host}:${port}`;
}

function oauthSuccessHtml(provider: OAuthProvider): string {
  const name = provider === 'google' ? 'Gmail' : 'Outlook / Microsoft 365';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Listo</title></head><body>` +
    `<p><strong>${name}</strong>: conectado. Podés cerrar esta ventana y volver a Enzo.</p>` +
    `</body></html>`;
}

function oauthErrorHtml(msg: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error OAuth</title></head><body>` +
    `<p>No se pudo completar OAuth: ${escapeHtml(msg)}</p>` +
    `</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Outlook device-code flow session (secret `device_code` never leaves API). */
interface MicrosoftDevicePending {
  accountId: string;
  tenant: string;
  deviceCode: string;
  expiresAt: number;
  intervalSec: number;
}

const microsoftDeviceSessions = new Map<string, MicrosoftDevicePending>();

function pruneMicrosoftDeviceSessions(): void {
  const now = Date.now();
  for (const [k, v] of microsoftDeviceSessions.entries()) {
    if (v.expiresAt <= now) microsoftDeviceSessions.delete(k);
  }
}

function mintDeviceSession(args: {
  accountId: string;
  tenant: string;
  deviceCode: string;
  intervalSec: number;
  ttlMs: number;
}): string {
  pruneMicrosoftDeviceSessions();
  const id = crypto.randomBytes(24).toString('hex');
  microsoftDeviceSessions.set(id, {
    accountId: args.accountId,
    tenant: args.tenant,
    deviceCode: args.deviceCode,
    intervalSec: args.intervalSec,
    expiresAt: Date.now() + args.ttlMs,
  });
  return id;
}

function takeMicrosoftDeviceSession(sessionIdRaw: unknown): MicrosoftDevicePending | null {
  pruneMicrosoftDeviceSessions();
  const sessionId = typeof sessionIdRaw === 'string' ? sessionIdRaw.trim() : '';
  if (!sessionId) return null;
  const row = microsoftDeviceSessions.get(sessionId);
  if (!row || row.expiresAt <= Date.now()) {
    microsoftDeviceSessions.delete(sessionId);
    return null;
  }
  return row;
}

export function createEmailRouter(configService: ConfigService): Router {
  const router = Router();

  router.get('/api/email/accounts', (_req: Request, res: Response) => {
    try {
      const svc = new EmailService(configService);
      const accounts = svc.listAccounts();
      res.json({
        accounts: accounts.map(({ hasPassword, hasOAuth, ...rest }) => ({
          ...rest,
          hasPassword,
          hasOAuth,
        })),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  /** Estado de cliente OAuth Gmail/Graph guardado en config (variables de entorno tienen prioridad en runtime). */
  router.get('/api/email/oauth-apps', (req: Request, res: Response) => {
    try {
      const base = configService.getEmailOAuthPersistedStatus();
      const oauthRedirectBase = resolveOAuthRedirectBase(req, configService);
      res.json({
        ...base,
        googleClientId: configService.peekPersistedGoogleClientId(),
        microsoftClientId: configService.peekPersistedMicrosoftClientId(),
        oauthRedirectBase,
        googleOAuthRedirectUri: `${oauthRedirectBase}/api/email/oauth/google/callback`,
        microsoftOAuthRedirectUri: `${oauthRedirectBase}/api/email/oauth/microsoft/callback`,
        oauthOriginUsesPublicEnvVar: !!process.env.ENZO_PUBLIC_API_BASE_URL?.trim(),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  router.put('/api/email/oauth-apps', (req: Request, res: Response) => {
    try {
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
      const g: { clientId?: string; clientSecret?: string } = {};
      const m: { clientId?: string; clientSecret?: string } = {};
      if (typeof body.googleClientId === 'string') {
        g.clientId = body.googleClientId;
      }
      if (typeof body.googleClientSecret === 'string') {
        g.clientSecret = body.googleClientSecret;
      }
      if (typeof body.microsoftClientId === 'string') {
        m.clientId = body.microsoftClientId;
      }
      if (typeof body.microsoftClientSecret === 'string') {
        m.clientSecret = body.microsoftClientSecret;
      }
      if (Object.keys(g).length > 0) {
        configService.setPersistedGoogleOAuthApp(g);
      }
      if (Object.keys(m).length > 0) {
        configService.setPersistedMicrosoftOAuthApp(m);
      }
      const oauthRedirectBasePut = resolveOAuthRedirectBase(req, configService);
      res.json({
        ...configService.getEmailOAuthPersistedStatus(),
        googleClientId: configService.peekPersistedGoogleClientId(),
        microsoftClientId: configService.peekPersistedMicrosoftClientId(),
        oauthRedirectBase: oauthRedirectBasePut,
        googleOAuthRedirectUri: `${oauthRedirectBasePut}/api/email/oauth/google/callback`,
        microsoftOAuthRedirectUri: `${oauthRedirectBasePut}/api/email/oauth/microsoft/callback`,
        oauthOriginUsesPublicEnvVar: !!process.env.ENZO_PUBLIC_API_BASE_URL?.trim(),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/api/email/accounts', (req: Request, res: Response) => {
    try {
      const acc = configService.addEmailAccount(req.body);
      const svc = new EmailService(configService);
      const row = svc.listAccounts().find((a) => a.id === acc.id);
      if (!row) {
        res.status(201).json({
          account: {
            ...acc,
            ...(acc.imap ? { imap: { ...acc.imap } } : {}),
            hasPassword: false,
            hasOAuth: false,
          },
        });
        return;
      }
      const { hasPassword, hasOAuth, ...rest } = row;
      res.status(201).json({
        account: {
          ...rest,
          hasPassword,
          hasOAuth,
        },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: msg });
    }
  });

  router.put('/api/email/accounts/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const patch = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
      configService.updateEmailAccount(id, patch);
      const svc = new EmailService(configService);
      const row = svc.listAccounts().find((a) => a.id === id);
      if (!row) {
        res.status(500).json({ error: 'Cuenta no encontrada tras actualizar' });
        return;
      }
      const { hasPassword, hasOAuth, ...rest } = row;
      res.json({ account: { ...rest, hasPassword, hasOAuth } });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = /Unknown email account/i.test(msg) ? 404 : 400;
      res.status(status).json({ error: msg });
    }
  });

  router.delete('/api/email/accounts/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      configService.removeEmailAccount(id);
      res.status(204).send();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = /Unknown email account/.test(msg) ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.put('/api/email/accounts/:id/password', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const pwd = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!pwd.trim()) {
        res.status(400).json({ error: 'Missing password' });
        return;
      }
      configService.setEmailPassword(id, pwd);
      res.status(204).send();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/api/email/accounts/:id/oauth/disconnect', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const accounts = configService.getEmailConfig().accounts;
      const acc = accounts.find((a) => a.id === id);
      if (!acc) {
        res.status(404).json({ error: `Unknown account: ${id}` });
        return;
      }
      if (acc.provider !== 'google' && acc.provider !== 'microsoft') {
        res.status(400).json({ error: 'OAuth only applies to gmail or microsoft providers' });
        return;
      }
      configService.clearEmailOAuthRefreshToken(id);
      res.status(204).send();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/api/email/accounts/:id/oauth/google/start', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const accounts = configService.getEmailConfig().accounts;
      const acc = accounts.find((a) => a.id === id);
      if (!acc || acc.provider !== 'google') {
        res.status(400).json({ error: `Account ${id} is not configured as provider "google"` });
        return;
      }
      const { clientId } = configService.getGoogleOAuthCredentials();
      if (!clientId) {
        res.status(400).json({
          error: 'Configure ENZO_GOOGLE_CLIENT_ID or system.googleOAuthClientId in ~/.enzo/config.json',
        });
        return;
      }

      const redirectUri = `${resolveOAuthRedirectBase(req, configService)}/api/email/oauth/google/callback`;
      const state = mintOAuthState(id, 'google', redirectUri);
      const authUrl = buildGoogleAuthorizationUrl({ clientId, redirectUri, state });
      res.json({ authUrl, redirectUriHint: redirectUri });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/api/email/oauth/google/callback', async (req: Request, res: Response) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
      const pending = consumeOAuthState(req.query.state);
      if (!pending || pending.provider !== 'google') {
        res.status(400).type('html').send(oauthErrorHtml('Estado OAuth inválido o expirado. Volvé a iniciar desde Correo.'));
        return;
      }
      if (!code) {
        const errRaw = typeof req.query.error_description === 'string' ? req.query.error_description : String(req.query.error ?? 'cancelled');
        res.status(400).type('html').send(oauthErrorHtml(typeof errRaw === 'string' ? errRaw : 'Sin código'));
        return;
      }

      const redirectUriFallback = `${resolveOAuthRedirectBase(req, configService)}/api/email/oauth/google/callback`;
      const redirectUri = pending.oauthRedirectUri ?? redirectUriFallback;
      const { clientId, clientSecret } = configService.getGoogleOAuthCredentials();
      if (!clientId) {
        res.status(400).type('html').send(oauthErrorHtml('Cliente Google OAuth no configurado'));
        return;
      }

      const tokens = await exchangeGoogleAuthorizationCode({
        clientId,
        clientSecret,
        code,
        redirectUri,
      });
      const refresh = tokens.refresh_token;
      if (!refresh) {
        res
          .status(400)
          .type('html')
          .send(
            oauthErrorHtml(
              'Google no envió refresh_token (suele pasar si ya autorizaste esta app antes). Probá revocar el acceso de Enzo en la cuenta Google y repetir, o crear otro proyecto OAuth.'
            )
          );
        return;
      }
      configService.setEmailOAuthRefreshToken(pending.accountId, refresh);
      res.status(200).type('html').send(oauthSuccessHtml('google'));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).type('html').send(oauthErrorHtml(msg));
    }
  });

  router.post('/api/email/accounts/:id/oauth/microsoft/start', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const accounts = configService.getEmailConfig().accounts;
      const acc = accounts.find((a) => a.id === id);
      if (!acc || acc.provider !== 'microsoft') {
        res.status(400).json({ error: `Account ${id} is not configured as provider "microsoft"` });
        return;
      }
      const { clientId } = configService.getMicrosoftOAuthCredentials();
      if (!clientId) {
        res.status(400).json({
          error: 'Configure ENZO_MICROSOFT_CLIENT_ID or system.microsoftOAuthClientId in ~/.enzo/config.json',
        });
        return;
      }

      const redirectUri = `${resolveOAuthRedirectBase(req, configService)}/api/email/oauth/microsoft/callback`;
      const { state, codeChallenge } = mintMicrosoftOAuthStateWithPkce(id, redirectUri);
      const tenant = acc.microsoftTenantId?.trim() || 'common';
      const authUrl = buildMicrosoftAuthorizationUrl({
        tenant,
        clientId,
        redirectUri,
        state,
        pkce: { codeChallenge, codeChallengeMethod: 'S256' },
      });
      res.json({ authUrl, redirectUriHint: redirectUri });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  /** Microsoft OAuth without redirect URI: device login (microsoft.com/link). */
  router.post('/api/email/accounts/:id/oauth/microsoft/device/start', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const accounts = configService.getEmailConfig().accounts;
      const acc = accounts.find((a) => a.id === id);
      if (!acc || acc.provider !== 'microsoft') {
        res.status(400).json({ error: `Account ${id} is not provider "microsoft"` });
        return;
      }
      const { clientId } = configService.getMicrosoftOAuthCredentials();
      if (!clientId) {
        res.status(400).json({
          error: 'Define ENZO_MICROSOFT_CLIENT_ID (o system.microsoftOAuthClientId). Para Azure: registrar una app tipo cliente público, permisos delegados Mail.ReadWrite.',
        });
        return;
      }

      const tenantRequested = acc.microsoftTenantId?.trim() || 'common';
      const { dev, resolvedTenant } = await microsoftDeviceInitWithConsumersFallback({
        tenant: tenantRequested,
        clientId,
      });

      if (
        resolvedTenant === 'consumers' &&
        (acc.microsoftTenantId?.trim().toLowerCase() || 'common') !== 'consumers'
      ) {
        try {
          configService.updateEmailAccount(acc.id, { microsoftTenantId: 'consumers' });
        } catch (e) {
          console.warn('[email] No se pudo guardar microsoftTenantId=consumers en config:', e);
        }
      }

      const ttlMs = Math.min(Math.max(dev.expires_in - 60, 60), 920) * 1000;
      const sessionId = mintDeviceSession({
        accountId: acc.id,
        tenant: resolvedTenant,
        deviceCode: dev.device_code,
        intervalSec: dev.interval,
        ttlMs,
      });

      res.json({
        sessionId,
        userCode: dev.user_code,
        verificationUri: dev.verification_uri,
        ...(dev.verification_uri_complete ? { verificationUriComplete: dev.verification_uri_complete } : {}),
        message: dev.message,
        expiresInSeconds: dev.expires_in,
        ...(resolvedTenant !== tenantRequested ? { authorityUsed: resolvedTenant as 'consumers' } : {}),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/api/email/oauth/microsoft/device/complete', async (req: Request, res: Response) => {
    req.socket.setTimeout(920_000);
    try {
      const sessionIdBody = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
      const row = takeMicrosoftDeviceSession(sessionIdBody);
      if (!row) {
        res.status(400).json({ error: 'Sesión OAuth inválida o expirada. Iniciá de nuevo desde Correo.' });
        return;
      }

      const { clientId, clientSecret } = configService.getMicrosoftOAuthCredentials();
      if (!clientId) {
        res.status(400).json({ error: 'Cliente Microsoft OAuth no configurado' });
        return;
      }

      microsoftDeviceSessions.delete(sessionIdBody);

      const ttlSec = Math.max(30, Math.floor((row.expiresAt - Date.now()) / 1000));
      const tokens = await pollMicrosoftDeviceUntilTokens({
        tenant: row.tenant,
        clientId,
        clientSecret,
        deviceCode: row.deviceCode,
        expiresInSeconds: ttlSec,
        intervalSeconds: Math.max(row.intervalSec, 1),
      });

      const refresh = tokens.refresh_token;
      if (!refresh) {
        res.status(400).json({
          error:
            'Microsoft no devolvió refresh_token. Revisa la app Azure (delegado Mail.ReadWrite + offline_access) y que pueda ser cliente público.',
        });
        return;
      }

      configService.setEmailOAuthRefreshToken(row.accountId, refresh);
      res.json({ success: true, accountId: row.accountId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: msg });
    }
  });

  router.get('/api/email/oauth/microsoft/callback', async (req: Request, res: Response) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
      const pending = consumeOAuthState(req.query.state);
      if (!pending || pending.provider !== 'microsoft') {
        res.status(400).type('html').send(oauthErrorHtml('Estado OAuth inválido o expirado.'));
        return;
      }
      if (!code) {
        const errRaw = typeof req.query.error_description === 'string' ? req.query.error_description : String(req.query.error ?? 'cancelled');
        res.status(400).type('html').send(oauthErrorHtml(typeof errRaw === 'string' ? errRaw : 'Sin código'));
        return;
      }

      const accounts = configService.getEmailConfig().accounts;
      const acc = accounts.find((a) => a.id === pending.accountId);
      const tenant = acc?.microsoftTenantId?.trim() || 'common';

      const redirectUriFallback = `${resolveOAuthRedirectBase(req, configService)}/api/email/oauth/microsoft/callback`;
      const redirectUri = pending.oauthRedirectUri ?? redirectUriFallback;
      const { clientId, clientSecret } = configService.getMicrosoftOAuthCredentials();
      if (!clientId) {
        res.status(400).type('html').send(oauthErrorHtml('Cliente Microsoft OAuth no configurado'));
        return;
      }

      const verifier = pending.microsoftCodeVerifier ?? null;

      const tokens = await exchangeMicrosoftAuthorizationCode({
        tenant,
        clientId,
        clientSecret,
        code,
        redirectUri,
        codeVerifier: verifier,
      });
      const refresh = tokens.refresh_token;
      if (!refresh) {
        res
          .status(400)
          .type('html')
          .send(oauthErrorHtml('Microsoft no devolvió refresh_token; revisá permisos offline_access y el tipo de app en Azure'));
        return;
      }
      configService.setEmailOAuthRefreshToken(pending.accountId, refresh);
      res.status(200).type('html').send(oauthSuccessHtml('microsoft'));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).type('html').send(oauthErrorHtml(msg));
    }
  });

  router.post('/api/email/accounts/:id/test', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const svc = new EmailService(configService);
      const result = await svc.testAccountWithError(id);
      if (!result.ok) {
        res.json({ success: false, error: result.error ?? 'Unknown error' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: msg });
    }
  });

  router.put('/api/email/accounts/:id/toggle', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const enabled =
        typeof req.body?.enabled === 'boolean'
          ? req.body.enabled
          : req.body?.enabled === 'true';
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'Body must include enabled: boolean' });
        return;
      }
      configService.setEmailAccountEnabled(id, enabled);
      res.status(204).send();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = /Unknown email account/.test(msg) ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.get('/api/email/recent', async (req: Request, res: Response) => {
    try {
      const raw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 10;
      const limit = Number.isFinite(raw) ? Math.min(50, Math.max(1, raw)) : 10;
      const svc = new EmailService(configService);
      const result = await svc.getRecent({ limit });
      if (!result.success) {
        res.status(400).json({ messages: [], error: result.error });
        return;
      }
      res.json({
        messages: result.messages ?? [],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ messages: [], error: msg });
    }
  });

  return router;
}
