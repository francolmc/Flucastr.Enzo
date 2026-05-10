import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMicrosoftTenantId } from './emailConfig.js';

test('normalizeMicrosoftTenantId', () => {
  assert.equal(normalizeMicrosoftTenantId(undefined), 'common');
  assert.equal(normalizeMicrosoftTenantId(''), 'common');
  assert.equal(normalizeMicrosoftTenantId('  '), 'common');
  assert.equal(normalizeMicrosoftTenantId('common'), 'common');
  assert.equal(normalizeMicrosoftTenantId('consumer'), 'consumers');
  assert.equal(normalizeMicrosoftTenantId('Consumer'), 'consumers');
  assert.equal(normalizeMicrosoftTenantId('consumers'), 'consumers');
  assert.equal(normalizeMicrosoftTenantId('organizations'), 'organizations');
  assert.equal(normalizeMicrosoftTenantId('11111111-1111-1111-1111-111111111111'), '11111111-1111-1111-1111-111111111111');
});
