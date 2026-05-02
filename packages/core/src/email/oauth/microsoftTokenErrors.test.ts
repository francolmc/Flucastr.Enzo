import test from 'node:test';
import assert from 'node:assert/strict';
import {
  microsoftTokenResponseSuggestsMissingClientCredential,
  microsoftTokenResponseSuggestsPublicClientNoSecret,
} from './exchange.js';

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

test('microsoftTokenResponseSuggestsMissingClientCredential', () => {
  assert.equal(
    microsoftTokenResponseSuggestsMissingClientCredential(
      "AADSTS7000218: The request body must contain the following parameter: 'client_assertion' or 'client_secret'."
    ),
    true
  );
  assert.equal(microsoftTokenResponseSuggestsMissingClientCredential('invalid_grant unrelated'), false);
});
