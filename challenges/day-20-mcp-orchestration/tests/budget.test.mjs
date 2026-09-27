import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Budget } from '../server/budget.mjs';
import { Store } from '../server/store.mjs';
const legacy = { reservedUsd: 1, estimatedUsd: .0029, requests: 20, inputTokens: 6800, outputTokens: 1000 };


test('HTTP app migrates an exhausted legacy ledger and completes a model flow without real API calls', async t => {
  const store = fixture(t);
  store.write('budget.json', legacy);
  const { createApp } = await import('../server/index.mjs');
  let calls = 0;
  const responder = async payload => {
    calls++;
    const outputs = payload.input.filter(item => item.type === 'function_call_output').length;
    const isOrchestration = payload.tools.some(tool => tool.name === 'data__search_issues');
    let name, args;
    if (outputs === 0) { name = isOrchestration ? 'data__search_issues' : 'search_issues'; args = { period: 'today' }; }
    else if (isOrchestration && outputs === 1) { name = 'analytics__summarize_issues'; args = {}; }
    return { status: 'completed', usage: { input_tokens: 100, output_tokens: 10 },
      output: name ? [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: 'call-' + calls }] : [],
      output_text: name ? '' : 'Срок сегодня у двух учебных задач.' };
  };
  const app = await createApp({ port: 0, production: true, directory: store.directory, responder });
  try {
    const url = `http://127.0.0.1:${app.port}`;
    const initial = await (await fetch(url + '/api/state')).json();
    assert.equal(initial.budget.reservedUsd, 0);
    assert.equal(initial.budget.requests, 20);
    const response = await fetch(url + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: 'today', mode: 'live' }) });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.ok(state.last.answer.includes('двух учебных задач'));
    assert.equal(state.budget.reservedUsd, 0);
    assert.equal(state.budget.requests, 20 + calls);
    assert.equal(state.budget.inputTokens, legacy.inputTokens + 100 * calls);
    assert.equal(state.budget.limitUsd, 1);
    assert.deepEqual(store.read('budget-v1-backup.json'), legacy);
  } finally { await app.close(); }
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-budget-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new Store(dir);
}

test('more than 20 completed requests spend tokens, not permanent five-cent reservations', t => {
  const store = fixture(t);
  for (let n = 0; n < 30; n++) {
    const budget = new Budget(store);
    const id = budget.reserve();
    assert.equal(budget.view().reservedUsd, .05);
    assert.equal(budget.finish(id, { input_tokens: 100, output_tokens: 10 }), true);
  }
  const value = new Budget(store).view();
  assert.equal(value.requests, 30);
  assert.equal(value.inputTokens, 3000);
  assert.equal(value.outputTokens, 300);
  assert.equal(value.estimatedUsd, .00111);
  assert.equal(value.reservedUsd, 0);
  assert.deepEqual(value.reservations, {});
  assert.equal(value.remainingUsd, .99889);
});

test('cap includes settled cost and pending reservations before sending another request', t => {
  const budget = new Budget(fixture(t), .1);
  budget.finish(budget.reserve(), { input_tokens: 200000, output_tokens: 0 });
  const id = budget.reserve(); // Exactly $0.05 cost + $0.05 pending.
  assert.throws(() => budget.reserve(), /Лимит расходов приложения/);
  assert.equal(budget.view().requests, 2);
  budget.finish(id, { input_tokens: 1, output_tokens: 0 });
  assert.throws(() => budget.reserve(), /локальный лимит/);
  assert.equal(budget.view().requests, 2);
});

test('unknown request keeps its own reservation across restart and another successful request', t => {
  const store = fixture(t);
  const interrupted = new Budget(store).reserve();
  const budget = new Budget(store);
  budget.finish(budget.reserve(), { input_tokens: 100, output_tokens: 10 });
  assert.equal(budget.view().reservedUsd, .05);
  assert.deepEqual(Object.keys(budget.view().reservations), [interrupted]);
  assert.equal(new Budget(store).view().reservedUsd, .05);
});

test('missing or malformed usage is not treated as a free successful request', t => {
  const budget = new Budget(fixture(t));
  const id = budget.reserve();
  for (const usage of [undefined, {}, { input_tokens: 1 }, { input_tokens: -1, output_tokens: 2 }, { input_tokens: 1, output_tokens: NaN }, { input_tokens: '1', output_tokens: 2 }]) {
    assert.equal(budget.finish(id, usage), false);
    assert.equal(budget.view().reservedUsd, .05);
    assert.equal(budget.view().estimatedUsd, 0);
  }
  budget.finish(id, { input_tokens: 0, output_tokens: 0 });
  assert.equal(budget.view().reservedUsd, 0);
  assert.throws(() => budget.finish(id, { input_tokens: 100, output_tokens: 100 }), /уже учтён/);
  assert.equal(budget.view().estimatedUsd, 0);
});

test('legacy exhausted reserve migrates once, preserves counters and keeps an exact backup', t => {
  const store = fixture(t);
  store.write('budget.json', legacy);
  const budget = new Budget(store);
  const value = budget.view();
  for (const key of ['estimatedUsd', 'requests', 'inputTokens', 'outputTokens']) assert.equal(value[key], legacy[key]);
  assert.equal(value.version, 2);
  assert.equal(value.reservedUsd, 0);
  assert.deepEqual(store.read('budget-v1-backup.json'), legacy);
  const id = budget.reserve();
  assert.equal(new Budget(store).view().reservedUsd, .05);
  budget.finish(id, { input_tokens: 10, output_tokens: 5 });
  assert.equal(budget.view().requests, 21);
  assert.deepEqual(store.read('budget-v1-backup.json'), legacy);
});

test('migration cannot bypass the cap when historical token cost already used it', t => {
  const store = fixture(t);
  store.write('budget.json', { ...legacy, estimatedUsd: 1 });
  const budget = new Budget(store);
  assert.throws(() => budget.reserve(), /Лимит/);
  assert.equal(budget.view().estimatedUsd, 1);
  assert.equal(budget.view().requests, 20);
});

test('invalid and unknown ledger formats fail closed without erasing accounting', t => {
  const store = fixture(t);
  for (const value of [{ ...legacy, estimatedUsd: -1 }, { ...legacy, version: 3 }, { ...legacy, version: 2, reservations: {} }]) {
    store.write('budget.json', value);
    assert.throws(() => new Budget(store).reserve(), /журнал|Журнал/);
    assert.deepEqual(store.read('budget.json'), value);
  }
  assert.equal(store.read('budget-v1-backup.json'), null);
});
