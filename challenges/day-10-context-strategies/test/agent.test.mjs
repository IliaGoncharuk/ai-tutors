import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent, Gateway, applyFactUpdates, FACT_INSTRUCTIONS, FACT_PREFIX, totals } from '../agent.mjs';
import { MemoryStore, emptyState, validateState } from '../store.mjs';
import { createOfflineClient } from '../scripts/offline-client.mjs';

function rig(strategy = 'window', options = {}) {
  const calls = []; const client = createOfflineClient();
  const gateway = new Gateway({ client, onCall: (call) => calls.push(call), ...options });
  return { client, gateway, calls, agent: new Agent({ gateway, store: new MemoryStore(emptyState(6, strategy)) }) };
}
test('window discards the prefix from storage and future requests; N counts messages, preserving pairs', async () => {
  const { agent, calls } = rig();
  const messages = Array.from({ length: 6 }, (_, i) => `Уникальный маркер ${i}.`);
  for (const message of messages) { await agent.ask(message); assert.ok(agent.getState().window.messages.length <= 6); }
  const state = agent.getState();
  assert.deepEqual(state.window.messages.filter((m) => m.role === 'user').map((m) => m.content), messages.slice(-3));
  assert.deepEqual(calls.at(-1).payload.input.filter((m) => m.role === 'user').map((m) => m.content), messages.slice(-4));
  assert.equal(calls.at(-1).payload.input.length, 7);
  assert.equal(JSON.stringify(state).includes(messages[0]), false);
  assert.ok(calls.every((c) => c.kind === 'answer' && !c.payload.previous_response_id && !c.payload.conversation && !c.payload.context_management));
  state.window.messages[0].content = 'mutation';
  assert.notEqual(agent.getState().window.messages[0].content, 'mutation');
});
test('facts are updated before each answer, survive tail eviction, and explicit corrections replace old values', async () => {
  const { agent, calls } = rig('facts');
  await agent.ask('Бюджет: 120000. Город: Пермь.');
  for (let i = 0; i < 5; i++) await agent.ask(`Нейтральное сообщение ${i}.`);
  await agent.ask('Бюджет: 90000.');
  assert.deepEqual(agent.getState().facts.values, { budget: '90000', city: 'Пермь' });
  assert.equal(calls.length, 14);
  for (let i = 0; i < calls.length; i += 2) {
    assert.equal(calls[i].kind, 'facts'); assert.equal(calls[i + 1].kind, 'answer');
    assert.ok(calls[i + 1].payload.input[0].content.startsWith(FACT_PREFIX));
  }
  assert.ok(calls.at(-1).payload.input[0].content.includes('90000'));
  assert.ok(!calls.at(-1).payload.input[0].content.includes('120000'));
  assert.equal(agent.getState().facts.messages.length, 6);
  assert.deepEqual(applyFactUpdates({ goal: 'old', city: 'Пермь' }, '{"updates":[{"key":"goal","value":null}]}'), { city: 'Пермь' });
});
test('malformed fact changes fail closed without corrupting memory or silently retaining a stale fact', async () => {
  for (const delta of ['not json', '{"updates":[{"key":"constructor","value":"x"}]}',
    '{"updates":[{"key":"budget","value":90000}]}', '{"updates":[{"key":"x","value":"a"},{"key":"x","value":"b"}]}']) {
    assert.throws(() => applyFactUpdates({ city: 'Пермь' }, delta));
  }
  const { agent, client, gateway } = rig('facts'); const create = client.responses.create;
  await agent.ask('Бюджет: 120000.'); const before = agent.getState();
  client.responses.create = async (payload) => ({ ...await create(payload), output_text: '{"updates":null}' });
  await assert.rejects(agent.ask('Бюджет: 90000.'));
  assert.deepEqual(agent.getState(), before);
  assert.equal(totals(gateway.records()).calls, 3); // Paid extraction remains accounted, answer not sent.
});
test('failed answer, incomplete extraction and failed disk commit preserve the whole turn, but spending remains', async () => {
  for (const failure of ['answer', 'extraction', 'save']) {
    const client = createOfflineClient(); const create = client.responses.create; const gateway = new Gateway({ client });
    const store = new MemoryStore(emptyState(6, 'facts')); const agent = new Agent({ gateway, store });
    await agent.ask('Бюджет: 120000.'); const before = agent.getState();
    if (failure === 'save') store.save = () => { throw new Error('simulated disk failure'); };
    else client.responses.create = async (payload) => ({ ...await create(payload),
      status: (failure === 'answer' ? payload.instructions !== FACT_INSTRUCTIONS : payload.instructions === FACT_INSTRUCTIONS) ? 'incomplete' : 'completed' });
    await assert.rejects(agent.ask('Бюджет: 90000.'));
    assert.deepEqual(agent.getState(), before); assert.deepEqual(store.load(), before);
    assert.equal(totals(gateway.records()).calls, failure === 'extraction' ? 3 : 4);
  }
});
test('branches share an immutable checkpoint; later turns and switching never mix siblings', async () => {
  const { agent, calls } = rig('branching');
  await agent.ask('Бюджет: 120000.'); agent.checkpoint('base'); agent.branch('web', 'base'); agent.branch('bot', 'base');
  const cp = agent.getState().branching.checkpoints.base;
  agent.switchBranch('web'); await agent.ask('Платформа: адаптивный сайт.');
  const web = agent.getState().branching.branches.web;
  agent.switchBranch('bot'); await agent.ask('Платформа: Telegram-бот.'); await agent.ask('Бюджет: 60000.');
  assert.equal(JSON.stringify(calls.at(-1).payload.input).includes('адаптивный сайт'), false);
  agent.switchBranch('web');
  assert.deepEqual(agent.getState().branching.branches.web, web);
  assert.deepEqual(agent.getState().branching.checkpoints.base, cp);
  await agent.ask('Продолжим сайт.');
  assert.equal(JSON.stringify(calls.at(-1).payload.input).includes('Telegram-бот'), false);
  assert.throws(() => agent.checkpoint('base')); assert.throws(() => agent.branch('web', 'base'));
  assert.throws(() => agent.switchBranch('missing')); assert.throws(() => agent.branch('__proto__', 'base'));
});
test('mode switch preserves separate sessions; controls are local and reset cannot erase spending', async () => {
  const { agent, gateway } = rig();
  await agent.ask('Бюджет: 120000.'); const window = agent.getState().window;
  agent.switchStrategy('facts'); await agent.ask('Бюджет: 60000.');
  assert.deepEqual(agent.getState().window, window);
  agent.switchStrategy('window'); assert.deepEqual(agent.getState().window, window);
  const spent = totals(gateway.records()); agent.reset();
  assert.deepEqual(agent.getState(), emptyState()); assert.deepEqual(totals(gateway.records()), spent);
  assert.throws(() => agent.checkpoint('x')); assert.throws(() => agent.switchStrategy('summary'));
  for (const n of [0, 3, -2, NaN, Infinity]) assert.throws(() => validateState(emptyState(n)));
});
test('shared token/call budget includes extraction; unknown usage stops future calls', async () => {
  const short = rig('facts', { maxCalls: 1 });
  await assert.rejects(short.agent.ask('Бюджет: 90000.'));
  assert.deepEqual(short.agent.getState(), emptyState(6, 'facts')); assert.equal(short.calls.filter((c) => c.sent).length, 1);
  const low = rig('window', { tokenBudget: 1 }); await assert.rejects(low.agent.ask('Привет.'));
  assert.equal(totals(low.gateway.records()).calls, 0);
  const unknown = rig(); const create = unknown.client.responses.create;
  unknown.client.responses.create = async (payload) => ({ ...await create(payload), usage: undefined });
  await unknown.agent.ask('Привет.'); unknown.agent.reset();
  await assert.rejects(unknown.agent.ask('Ещё.'));
  assert.equal(totals(unknown.gateway.records()).unknown, 1);
  assert.equal(totals(unknown.gateway.records()).calls, 1);
});
test('overlapping requests and mutations are rejected while a turn is running', async () => {
  const { agent, client } = rig(); const create = client.responses.create;
  let release; const wait = new Promise((resolve) => { release = resolve; });
  client.responses.create = async (payload) => { await wait; return create(payload); };
  const pending = agent.ask('Первый.');
  await assert.rejects(agent.ask('Второй.')); assert.throws(() => agent.reset()); assert.throws(() => agent.switchStrategy('facts'));
  release(); await pending;
  assert.equal(agent.getState().window.turns, 1);
});
