import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent } from '../agent.mjs';
import { MemoryHistoryStore, HistoryError } from '../history.mjs';
import { MODEL } from '../accounting.mjs';

const pair = [{ role: 'user', content: 'Кедр 🌲' }, { role: 'assistant', content: 'Запомнил.' }];
const response = (overrides = {}) => ({ status: 'completed', model: MODEL.id, output_text: 'Кедр 🌲',
  usage: { input_tokens: 56, output_tokens: 10, total_tokens: 66,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 } }, ...overrides });

function fixture({ count, create, store = new MemoryHistoryStore(pair), ...options } = {}) {
  const calls = [];
  const client = { responses: {
    inputTokens: { count: async (payload) => {
      calls.push({ type: 'count', payload: structuredClone(payload) });
      return count ? count(payload) : { input_tokens: payload.instructions ? 50 : payload.input.length === 1 ? 11 : 32 };
    } },
    create: async (payload) => {
      calls.push({ type: 'create', payload: structuredClone(payload) });
      return create ? create(payload) : response();
    },
  } };
  return { agent: new Agent({ client, store, maxOutputTokens: 32, ...options }), store, calls };
}

test('independent counts use current message, full prior history and exact generation input including instructions', async () => {
  const { agent, calls } = fixture();
  const { record } = await agent.ask('  Что помнишь?  ');
  assert.deepEqual(record.counts, { current: 11, history: 32, full: 50 });
  assert.deepEqual(calls.map((call) => call.type), ['count', 'count', 'count', 'create']);
  assert.deepEqual(calls[0].payload.input, [{ role: 'user', content: 'Что помнишь?' }]);
  assert.deepEqual(calls[1].payload.input, pair);
  assert.equal(calls[0].payload.instructions, undefined);
  assert.equal(calls[1].payload.instructions, undefined);
  const request = calls[3].payload;
  assert.deepEqual(request.input, [...pair, { role: 'user', content: 'Что помнишь?' }]);
  assert.deepEqual(calls[2].payload, {
    model: request.model, instructions: request.instructions, input: request.input, reasoning: request.reasoning,
  });
  assert.equal(request.store, false);
  assert.equal(request.truncation, 'disabled');
  assert.equal(request.service_tier, 'default');
  assert.deepEqual(record.usage, { input: 56, output: 10, total: 66, cached: 0, written: 0, reasoning: 0 });
  assert.equal(agent.getHistory().length, 4);
  // Server usage is authoritative even if the preflight count differs.
  assert.equal(agent.getTotals().input, 56);
  const snapshot = agent.getRecords();
  snapshot[0].counts.full = 999;
  assert.equal(agent.getRecords()[0].counts.full, 50);
});

test('empty history needs two counts; reset clears history but preserves session spending; restart starts a new ledger', async () => {
  const { agent, calls, store } = fixture({ store: new MemoryHistoryStore() });
  await agent.ask('Привет');
  assert.equal(calls.filter((call) => call.type === 'count').length, 2);
  assert.equal(agent.getRecords()[0].counts.history, 0);
  agent.reset();
  assert.deepEqual(agent.getHistory(), []);
  assert.equal(agent.getTotals().total, 66);
  await agent.ask('Заново');
  assert.equal(agent.getTotals().total, 132);
  assert.equal(agent.getTotals().apiCalls, 2);
  const { agent: restarted } = fixture({ store });
  assert.equal(restarted.getHistory().length, 2);
  assert.equal(restarted.getTotals().total, 0);
});

test('boundary allows exactly input + reserve; overflow blocks create and preserves store', async () => {
  const allowed = fixture({ contextLimit: 82 });
  await allowed.agent.ask('Вопрос');
  const blocked = fixture({ contextLimit: 81 });
  await assert.rejects(blocked.agent.ask('Вопрос'), { code: 'local_context_limit' });
  assert.equal(blocked.calls.filter((call) => call.type === 'create').length, 0);
  assert.deepEqual(blocked.store.load(), pair);
  assert.equal(blocked.agent.getTotals().unknownUsageCalls, 0);
  assert.equal(blocked.agent.getRecords()[0].costUsd, 0);
});

test('explicit diagnostic overflow exposes context error, while generic 400 and 429 are distinguished', async () => {
  for (const [status, code, expected] of [
    [400, 'context_length_exceeded', 'context_length_exceeded'],
    [400, 'invalid_request_error', 'api_failed'], [429, 'rate_limit_exceeded', 'rate_limit'],
  ]) {
    const { agent, store } = fixture({ contextLimit: 81, create: () => {
      throw Object.assign(new Error('sensitive provider echo'), { status, code });
    } });
    await assert.rejects(agent.ask('Вопрос', { allowOverflow: true }), { code: expected });
    assert.equal(agent.getRecords()[0].stage, 'генерация');
    assert.equal(agent.getTotals().unknownUsageCalls, 1);
    assert.equal(agent.getTotals().unknownCostCalls, 1);
    assert.deepEqual(store.load(), pair);
    assert.ok(!JSON.stringify(agent.getRecords()).includes('sensitive'));
  }
});

test('count endpoint failure prevents generation; lock is released for the next attempt', async () => {
  let fail = true;
  const { agent, calls } = fixture({ count: () => {
    if (fail) throw Object.assign(new Error('private echo'), { code: 'context_length_exceeded' });
    return { input_tokens: 50 };
  } });
  await assert.rejects(agent.ask('Вопрос'), { code: 'context_length_exceeded' });
  assert.equal(agent.getRecords()[0].stage, 'подсчёт');
  assert.equal(calls.length, 1);
  assert.equal(agent.getTotals().apiCalls, 0);
  fail = false;
  await agent.ask('Повтор');
  assert.equal(agent.getHistory().length, 4);
});

test('output exhaustion, invalid output and failed disk commit preserve history but retain billable usage', async () => {
  for (const kind of ['output', 'empty', 'save']) {
    const store = new MemoryHistoryStore(pair);
    if (kind === 'save') store.save = () => { throw new HistoryError('Ошибка записи.'); };
    const { agent } = fixture({ store, create: () => response(kind === 'output' ?
      { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } :
      kind === 'empty' ? { output_text: '  ' } : {}) });
    await assert.rejects(agent.ask('Вопрос'));
    assert.deepEqual(agent.getHistory(), pair);
    assert.deepEqual(store.load(), pair);
    assert.equal(agent.getTotals().total, 66);
    assert.ok(agent.getTotals().knownCostUsd > 0);
    assert.equal(agent.getRecords()[0].status, kind === 'output' ? 'output_limit' :
      kind === 'save' ? 'history_failed' : 'invalid_response');
  }
});

test('unknown usage is not substituted by preflight; finite budget stops further spending', async () => {
  const { agent, calls } = fixture({ budgetUsd: 1, create: () => response({ usage: null }) });
  await agent.ask('Вопрос');
  assert.equal(agent.getRecords()[0].usage, null);
  assert.equal(agent.getTotals().unknownUsageCalls, 1);
  await assert.rejects(agent.ask('Ещё'), { code: 'budget_limit' });
  assert.equal(calls.filter((call) => call.type === 'create').length, 1);
  const small = fixture({ budgetUsd: 0.00000001 });
  await assert.rejects(small.agent.ask('Вопрос'), { code: 'budget_limit' });
  assert.equal(small.agent.getTotals().apiCalls, 0);
});

test('concurrent asks and resets cannot mutate an in-flight conversation; failed reset preserves it', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { agent, store } = fixture({ create: () => pending });
  const first = agent.ask('Один');
  await assert.rejects(agent.ask('Два'), { code: 'busy' });
  assert.throws(() => agent.reset(), { code: 'busy' });
  release(response());
  await first;
  store.save = () => { throw new HistoryError('Ошибка записи.'); };
  assert.throws(() => agent.reset(), HistoryError);
  assert.equal(agent.getHistory().length, 4);
  assert.equal(agent.getTotals().total, 66);
});

test('non-default service tier or unknown model leaves cost unknown', async () => {
  for (const override of [{ service_tier: 'priority' }, { model: 'unknown' }]) {
    const { agent } = fixture({ create: () => response(override) });
    await agent.ask('Вопрос');
    assert.equal(agent.getTotals().total, 66);
    assert.equal(agent.getTotals().unknownCostCalls, 1);
  }
});
