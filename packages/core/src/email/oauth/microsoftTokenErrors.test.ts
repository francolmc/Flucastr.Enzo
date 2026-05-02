import test from 'node:test';
import assert from 'node:assert/strict';
import { microsoftTokenResponseSuggestsPublicClientNoSecret } from './exchange.js';

test('microsoftTokenResponseSuggestsPublicClientNoSecret', () => {
  assert.equal(
    microsoftTokenResponseSuggestsPublicClientNoSecret(
      "AADSTS900232: Public clients can't send a client secret."
    ),
    true
  );
  assert.equal(microsoftTokenResponseSuggestsPublicClientNoSecret('AADSTS50126: unrelated'), false);
  assert.equal(microsoftTokenResponseSuggestsPublicClientNoSecret("Public clients can't send a client secret"), true);
});
