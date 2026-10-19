import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketContext } from '../server/support.mjs';
import { run } from '../server/feature.mjs';
test('ticket contexts differ and unknown ids fail before model call', async () => {
  assert.equal(ticketContext('T-101').user.emailVerified, false); assert.equal(ticketContext('T-102').user.accountLocked, true);
  assert.equal(ticketContext('T-104').ticket.observedError, null);
  await assert.rejects(run({}, { ticket: 'T-999', question: 'Вход?' }), /не найден/);
});
