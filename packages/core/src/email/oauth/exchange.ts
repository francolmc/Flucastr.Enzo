/**
 * OAuth helpers for Gmail and Microsoft Graph (authorization code → tokens).
 * Scopes chosen for mailbox read/send/modify aligned with Gmail API + Graph Mail.ReadWrite.
 */

export const GOOGLE_MAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

/** Microsoft v2 delegated scopes — URIs Graph (evitan rechazos con tenant / device flow). */
export const MICROSOFT_MAIL_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Mail.ReadWrite',
].join(' ');

/** Azure rechaza si el registro es cliente público y el body lleva secret (p. ej. AADSTS900232). */
export function microsoftTokenResponseSuggestsPublicClientNoSecret(description: string): boolean {
  return (
    /Public clients can't send a client secret/i.test(description) ||
    /can't send plain text secrets/i.test(description) ||
    /AADSTS900232/i.test(description)
  );
}

function microsoftTokenErrorText(json: Record<string, unknown>): string {
  const d =
    typeof json.error_description === 'string'
      ? json.error_description
      : typeof json.suberror === 'string'
        ? json.suberror
        : '';
  const raw = typeof json.error === 'string' ? `${json.error} ${d}`.trim() : d;
  return raw || JSON.stringify(json);
}

export type GoogleTokenExchangeResult = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

export type MicrosoftTokenExchangeResult = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

export function buildGoogleAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GOOGLE_MAIL_SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', params.state);
  return u.toString();
}

export async function exchangeGoogleAuthorizationCode(params: {
  clientId: string;
  clientSecret: string | null;
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenExchangeResult> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  });
  if (params.clientSecret) {
    body.set('client_secret', params.clientSecret);
  }

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    const msg = typeof json.error_description === 'string' ? json.error_description : JSON.stringify(json);
    throw new Error(`Google token exchange failed: ${msg}`);
  }
  const access_token = typeof json.access_token === 'string' ? json.access_token : '';
  const refresh_token = typeof json.refresh_token === 'string' ? json.refresh_token : undefined;
  const expires_in = typeof json.expires_in === 'number' ? json.expires_in : undefined;
  if (!access_token) {
    throw new Error('Google token exchange: missing access_token');
  }
  return { access_token, refresh_token, expires_in };
}

export function buildMicrosoftAuthorizationUrl(params: {
  tenant: string;
  clientId: string;
  redirectUri: string;
  state: string;
  /** SPA / muchas registraciones moderadas Azure exigen PKCE sobre el código. */
  pkce?: { codeChallenge: string; codeChallengeMethod: 'S256' };
}): string {
  const u = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(params.tenant)}/oauth2/v2.0/authorize`
  );
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('scope', MICROSOFT_MAIL_SCOPES);
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('state', params.state);
  if (params.pkce) {
    u.searchParams.set('code_challenge', params.pkce.codeChallenge);
    u.searchParams.set('code_challenge_method', params.pkce.codeChallengeMethod);
  }
  return u.toString();
}

export async function exchangeMicrosoftAuthorizationCode(params: {
  tenant: string;
  clientId: string;
  clientSecret: string | null;
  code: string;
  redirectUri: string;
  /** Obligatorio si el authorize se hizo con `code_challenge` (PKCE). */
  codeVerifier?: string | null;
}): Promise<MicrosoftTokenExchangeResult> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(params.tenant)}/oauth2/v2.0/token`;
  const secret =
    typeof params.clientSecret === 'string' && params.clientSecret.trim().length > 0
      ? params.clientSecret.trim()
      : '';

  const makeBody = (withSecret: boolean): URLSearchParams => {
    const body = new URLSearchParams({
      client_id: params.clientId,
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
    });
    if (withSecret && secret) body.set('client_secret', secret);
    const cv = typeof params.codeVerifier === 'string' ? params.codeVerifier.trim() : '';
    if (cv) body.set('code_verifier', cv);
    return body;
  };

  let r = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: makeBody(!!secret),
  });

  let json = (await r.json()) as Record<string, unknown>;
  if (!r.ok && secret) {
    const msg = microsoftTokenErrorText(json);
    if (microsoftTokenResponseSuggestsPublicClientNoSecret(msg)) {
      r = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: makeBody(false),
      });
      json = (await r.json()) as Record<string, unknown>;
    }
  }

  if (!r.ok) {
    const msg = microsoftTokenErrorText(json);
    throw new Error(`Microsoft token exchange failed: ${msg}`);
  }
  const access_token = typeof json.access_token === 'string' ? json.access_token : '';
  const refresh_token = typeof json.refresh_token === 'string' ? json.refresh_token : undefined;
  const expires_in = typeof json.expires_in === 'number' ? json.expires_in : undefined;
  if (!access_token) {
    throw new Error('Microsoft token exchange: missing access_token');
  }
  return { access_token, refresh_token, expires_in };
}

export async function refreshMicrosoftAccessToken(params: {
  tenant: string;
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
}): Promise<MicrosoftTokenExchangeResult> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(params.tenant)}/oauth2/v2.0/token`;
  const secret =
    typeof params.clientSecret === 'string' && params.clientSecret.trim().length > 0
      ? params.clientSecret.trim()
      : '';

  const makeBody = (withSecret: boolean): URLSearchParams => {
    const body = new URLSearchParams({
      client_id: params.clientId,
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
    });
    if (withSecret && secret) body.set('client_secret', secret);
    return body;
  };

  let r = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: makeBody(!!secret),
  });

  let json = (await r.json()) as Record<string, unknown>;
  if (!r.ok && secret) {
    const msg = microsoftTokenErrorText(json);
    if (microsoftTokenResponseSuggestsPublicClientNoSecret(msg)) {
      r = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: makeBody(false),
      });
      json = (await r.json()) as Record<string, unknown>;
    }
  }

  if (!r.ok) {
    const msg = microsoftTokenErrorText(json);
    throw new Error(`Microsoft token refresh failed: ${msg}`);
  }
  const access_token = typeof json.access_token === 'string' ? json.access_token : '';
  const refresh_token = typeof json.refresh_token === 'string' ? json.refresh_token : undefined;
  const expires_in = typeof json.expires_in === 'number' ? json.expires_in : undefined;
  if (!access_token) {
    throw new Error('Microsoft token refresh: missing access_token');
  }
  return { access_token, refresh_token, expires_in };
}
