/**
 * OAuth helpers for Gmail and Microsoft Graph (authorization code → tokens).
 * Scopes chosen for mailbox read/send/modify aligned with Gmail API + Graph Mail.ReadWrite.
 */

export const GOOGLE_MAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

export const MICROSOFT_MAIL_SCOPES = ['offline_access', 'Mail.ReadWrite', 'User.Read'].join(' ');

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
  return u.toString();
}

export async function exchangeMicrosoftAuthorizationCode(params: {
  tenant: string;
  clientId: string;
  clientSecret: string | null;
  code: string;
  redirectUri: string;
}): Promise<MicrosoftTokenExchangeResult> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  if (params.clientSecret) {
    body.set('client_secret', params.clientSecret);
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(params.tenant)}/oauth2/v2.0/token`;
  const r = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    const msg = typeof json.error_description === 'string' ? json.error_description : JSON.stringify(json);
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
  const body = new URLSearchParams({
    client_id: params.clientId,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  });
  if (params.clientSecret) {
    body.set('client_secret', params.clientSecret);
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(params.tenant)}/oauth2/v2.0/token`;
  const r = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    const msg = typeof json.error_description === 'string' ? json.error_description : JSON.stringify(json);
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
