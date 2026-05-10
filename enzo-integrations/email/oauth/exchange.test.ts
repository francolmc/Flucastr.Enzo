/**
 * Sanity checks for OAuth URL builders (no network).
 */
import assert from 'node:assert/strict';

import {
  buildGoogleAuthorizationUrl,
  buildMicrosoftAuthorizationUrl,
  GOOGLE_MAIL_SCOPE,
} from './exchange.js';

function run(): void {
  const redirectUriGoogle = 'http://127.0.0.1:3001/api/email/oauth/google/callback';
  const g = buildGoogleAuthorizationUrl({
    clientId: 'test-client-id',
    redirectUri: redirectUriGoogle,
    state: 'state-token-hex',
  });
  assert.match(g, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  const gpu = new URL(g);
  assert.equal(gpu.searchParams.get('client_id'), 'test-client-id');
  assert.equal(gpu.searchParams.get('state'), 'state-token-hex');
  assert.equal(gpu.searchParams.get('response_type'), 'code');
  assert.equal(gpu.searchParams.get('scope'), GOOGLE_MAIL_SCOPE);

  const redirectUriMs = 'http://127.0.0.1:3001/api/email/oauth/microsoft/callback';
  const mk = buildMicrosoftAuthorizationUrl({
    tenant: 'common',
    clientId: 'ms-client-id',
    redirectUri: redirectUriMs,
    state: 's2',
    pkce: {
      codeChallenge: 'CcKbyFMybTQWdkiXQXwOR9mYBQuqsMVdGer5o7JUdQY',
      codeChallengeMethod: 'S256',
    },
  });
  assert(mk.includes('/common/oauth2/v2.0/authorize'));
  const mpu = new URL(mk);
  assert.equal(mpu.searchParams.get('client_id'), 'ms-client-id');
  assert.equal(mpu.searchParams.get('state'), 's2');
  assert.equal(mpu.searchParams.get('code_challenge_method'), 'S256');
  assert(mpu.searchParams.get('code_challenge')?.length);

  console.log('Test: OAuth URL builders encode expected OAuth 2 authorize parameters');
}

run();
