import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSigningIdentity, runPrivate } from '../scripts/local-signing.js';
import { coachingRequest, sessionConfig } from '../api.js';
import { observeRequest } from '../training-api.js';
import { loadCases } from '../evaluation/runner.js';

test('continuation guidance reaches live, Assisted, Blind, demo and Observe with the actual spoken greeting', async () => {
  const cases = (await loadCases({ realism: true })).cases.filter(c => c.id.startsWith('continue-after-greeting-'));
  assert.equal(cases.length, 5);
  for (const c of cases) {
    const request = c.kind === 'observe' ? observeRequest(c.payload) : coachingRequest(c.payload);
    assert.match(request.instructions, /Once greetings have been exchanged, do not restart/);
    assert.match(request.instructions, /new participant joining/);
    assert.ok(JSON.parse(request.input).transcript.some(t => t.text.includes('Do you have a few minutes to chat?')));
    assert.ok(!JSON.stringify(request).includes(c.manual_review));
  }
  assert.doesNotMatch(sessionConfig('simulation', '', 'target-service').instructions, /Continue the exchange the rep is already in/);
});

test('missing persistent signer fails closed instead of silently using an ad-hoc identity', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'signing-config-test-'));
  try { assert.throws(() => loadSigningIdentity(directory), /No temporary signature was substituted/); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});

test('signing failures never print private command arguments', () => {
  assert.throws(() => runPrivate('/nonexistent-signing-command', ['fake-secret-do-not-print'], 'Signing'), error => {
    assert.match(error.message, /Signing failed/);
    assert.doesNotMatch(error.message, /fake-secret-do-not-print/);
    return true;
  });
});
