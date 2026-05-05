/**
 * OAuth 2.0 Device Authorization Grant for Microsoft identity platform — no localhost redirect URI.
 */

import type { MicrosoftTokenExchangeResult } from './exchange.js';
import { MICROSOFT_MAIL_SCOPES, microsoftTokenResponseSuggestsPublicClientNoSecret } from './exchange.js';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** Start device flow → user opens microsoft.com/link and enters `user_code`. */
export async function requestMicrosoftDeviceCode(params: {
  tenant: string;
  clientId: string;
  /** Space-separated delegated scopes (defaults to Graph Mail + offline). */
  scope?: string;
}): Promise<{
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  message?: string;
  expires_in: number;
  interval: number;
}> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    scope: params.scope ?? MICROSOFT_MAIL_SCOPES,
  });

  const url = `https://login.microsoftonline.com/${encodeURIComponent(params.tenant)}/oauth2/v2.0/devicecode`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    const msg =
      typeof json.error_description === 'string' ? json.error_description : JSON.stringify(json);
    throw new Error(`Microsoft device code request failed: ${msg}`);
  }

  const device_code = typeof json.device_code === 'string' ? json.device_code : '';
  const user_code = typeof json.user_code === 'string' ? json.user_code : '';
  const verification_uri =
    typeof json.verification_uri === 'string' ? json.verification_uri : '';

  const expires_raw = typeof json.expires_in === 'string' ? Number(json.expires_in) : json.expires_in;
  const expires_in = typeof expires_raw === 'number' && Number.isFinite(expires_raw) ? expires_raw : 900;

  const interval_raw =
    typeof json.interval === 'string' ? Number(json.interval) : json.interval;
  const interval =
    typeof interval_raw === 'number' && Number.isFinite(interval_raw) && interval_raw >= 1
      ? interval_raw
      : 5;

  if (!device_code || !user_code || !verification_uri) {
    throw new Error('Microsoft device response missing device_code/user_code/verification_uri');
  }

  const verification_uri_complete =
    typeof json.verification_uri_complete === 'string'
      ? json.verification_uri_complete
      : undefined;
  const message = typeof json.message === 'string' ? json.message : undefined;

  return {
    device_code,
    user_code,
    verification_uri,
    ...(verification_uri_complete ? { verification_uri_complete } : {}),
    ...(message ? { message } : {}),
    expires_in,
    interval,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll Microsoft until the user finishes `device_code` flow or time runs out.
 * Secret is optional — public/native Microsoft apps use device flow without secret.
 */
export async function pollMicrosoftDeviceUntilTokens(params: {
  tenant: string;
  clientId: string;
  clientSecret: string | null;
  deviceCode: string;
  expiresInSeconds: number;
  intervalSeconds: number;
  /** Stop early (e.g. client disconnect); optional. */
  signal?: AbortSignal;
}): Promise<MicrosoftTokenExchangeResult> {
  const deadlineMs = Date.now() + Math.max(10, params.expiresInSeconds) * 1000;
  let intervalMs = Math.max(1000, params.intervalSeconds * 1000);
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(params.tenant)}/oauth2/v2.0/token`;

  const secret =
    typeof params.clientSecret === 'string' && params.clientSecret.trim().length > 0
      ? params.clientSecret.trim()
      : '';

  const postPoll = async (withSecret: boolean): Promise<Response> => {
    const body = new URLSearchParams({
      grant_type: DEVICE_GRANT,
      client_id: params.clientId,
      device_code: params.deviceCode,
    });
    if (withSecret && secret) body.set('client_secret', secret);
    return fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  };

  while (Date.now() < deadlineMs) {
    if (params.signal?.aborted) {
      throw new Error('Device login cancelled');
    }

    await sleep(intervalMs);

    if (params.signal?.aborted) {
      throw new Error('Device login cancelled');
    }

    let r = await postPoll(!!secret);
    let json = (await r.json()) as Record<string, unknown>;
    if (!r.ok && secret) {
      const desc =
        typeof json.error_description === 'string' ? json.error_description : JSON.stringify(json);
      if (microsoftTokenResponseSuggestsPublicClientNoSecret(desc)) {
        r = await postPoll(false);
        json = (await r.json()) as Record<string, unknown>;
      }
    }
    const err = typeof json.error === 'string' ? json.error : '';

    if (r.ok) {
      const access_token = typeof json.access_token === 'string' ? json.access_token : '';
      const refresh_token = typeof json.refresh_token === 'string' ? json.refresh_token : undefined;
      const expires_in = typeof json.expires_in === 'number' ? json.expires_in : undefined;
      if (!access_token) {
        throw new Error('Microsoft device token: missing access_token');
      }
      return { access_token, refresh_token, expires_in };
    }

    if (err === 'authorization_pending') {
      continue;
    }
    if (err === 'slow_down') {
      intervalMs = Math.min(intervalMs + 5000, 60_000);
      continue;
    }
    if (err === 'expired_token' || err === 'invalid_grant') {
      const desc = typeof json.error_description === 'string' ? json.error_description : err;
      throw new Error(`Microsoft device token: ${desc}`);
    }

    const msg =
      typeof json.error_description === 'string' ? json.error_description : JSON.stringify(json);
    throw new Error(`Microsoft device token failed: ${msg}`);
  }

  throw new Error('Microsoft device login timed out (no authorization before expiry)');
}
