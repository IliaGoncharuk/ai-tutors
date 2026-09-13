import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent, SUMMARY_INSTRUCTIONS } from '../agent.mjs';
import { emptyContext, MemoryContextStore } from '../context-store.mjs';
import { createOfflineClient } from '../scripts/offline-client.mjs';

function fixture() {
  const state = emptyContext();
  state.recentMessages = Array.from({ length: 5 }, (_, i) => [
    { role: 'user', content: `  Вопрос ${i}\nс переносом  ` },
    { role: 'assistant', content: ` Ответ ${i} ` },
  ]).flat();
  state.messagesSinceSummary = 10;
  return state;
}

function recordingClient() {
  const calls = [];
  const client = createOfflineClient();
  client.responses.create = async (body) => {
    calls.push(structuredClone(body));
    const text = body.instructions === SUMMARY_INSTRUCTIONS ? 'Сводка: сохранены ранние факты.' : '  Дословный ответ\n';
    return { status: 'completed', output_text: text, usage: {
      input_tokens: 111, output_tokens: 9, total_tokens: 120,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 },
    } };
  };
  return { client, calls };
}

test('compression replaces only the prefix, preserves N exact messages and does not send hidden full history', async () => {
  const state = fixture();
  const { client, calls } = recordingClient();
  const agent = new Agent({ client, store: new MemoryContextStore(state) });
  const prompt = '  Новый вопрос\n  ';
  await agent.ask(prompt);
  assert.equal(calls.length, 2);
  const summaryInput = JSON.parse(calls[0].input[0].content);
  assert.deepEqual(summaryInput, { previousSummary: '', messages: state.recentMessages.slice(0, 4) });
  assert.deepEqual(calls[1].input.slice(1, -1), state.recentMessages.slice(-6));
  assert.deepEqual(calls[1].input.at(-1), { role: 'user', content: prompt });
  assert.equal(calls[1].input[0].role, 'user');
  assert.ok(!JSON.stringify(calls[1]).includes('Вопрос 0'));
  for (const body of calls) {
    assert.equal(body.store, false);
    assert.equal(body.truncation, 'disabled');
    assert.ok(!('previous_response_id' in body));
    assert.ok(!('conversation' in body));
  }
  assert.deepEqual(agent.getContext().recentMessages.slice(0, 6), state.recentMessages.slice(-6));
  assert.equal(agent.getContext().recentMessages.at(-1).content, '  Дословный ответ\n');
  assert.equal(agent.getContext().summarizedMessages, 4);
  assert.equal(agent.getContext().messagesSinceSummary, 2);
  assert.equal(agent.getTotals().total, 240); // Actual usage, not preflight counts.
});

test('interval counts individual messages, updates old summary and never breaks user/assistant pairs', async () => {
  const { client, calls } = recordingClient();
  const agent = new Agent({ client, keepLatest: 4, compressEvery: 6 });
  for (let i = 0; i < 3; i++) await agent.ask(`Вопрос ${i}`);
  assert.equal(agent.getTotals('summary').calls, 0);
  await agent.ask('Вопрос 3');
  assert.equal(agent.getContext().summarizedMessages, 2);
  for (let i = 4; i < 7; i++) await agent.ask(`Вопрос ${i}`);
  const summaries = calls.filter((body) => body.instructions === SUMMARY_INSTRUCTIONS);
  assert.equal(summaries.length, 2);
  const second = JSON.parse(summaries[1].input[0].content);
  assert.equal(second.previousSummary, 'Сводка: сохранены ранние факты.');
  assert.equal(second.messages.length, 6);
  assert.equal(second.messages[0].content, 'Вопрос 1');
  assert.equal(agent.getContext().summarizedMessages, 8);
});

test('full mode keeps all pairs and makes no summary calls', async () => {
  const { client } = recordingClient();
  const agent = new Agent({ client, compression: false, store: new MemoryContextStore(fixture()) });
  await agent.ask('Новый ход');
  assert.equal(agent.getContext().recentMessages.length, 12);
  assert.equal(agent.getTotals('summary').calls, 0);
  assert.equal(agent.getContext().summary, '');
});

test('a short history or a tail larger than the history does not trigger summary', async () => {
  for (const keepLatest of [6, 20]) {
    const { client } = recordingClient();
    const agent = new Agent({ client, keepLatest });
    for (let i = 0; i < 5; i++) await agent.ask('Короткий вопрос');
    assert.equal(agent.getTotals('summary').calls, 0);
    if (keepLatest === 20) {
      await agent.ask('Ещё вопрос');
      assert.equal(agent.getTotals('summary').calls, 0);
    }
  }
});

test('summary failure preserves the old state and does not send an answer generation', async () => {
  const state = fixture();
  const { client } = recordingClient();
  let calls = 0;
  client.responses.create = async () => { calls++; throw new Error('private provider echo'); };
  const agent = new Agent({ client, store: new MemoryContextStore(state) });
  await assert.rejects(agent.ask('Вопрос'), (error) => error.code === 'api_failed' && !error.message.includes('private'));
  assert.equal(calls, 1);
  assert.deepEqual(agent.getContext(), state);
  assert.equal(agent.getTotals().unknown, 1);
});

test('incomplete/empty summary, failed answer and failed disk commit roll back both summary and messages but retain usage', async () => {
  for (const failure of ['incomplete-summary', 'empty-summary', 'incomplete-answer', 'save']) {
    const state = fixture();
    const { client } = recordingClient();
    const create = client.responses.create;
    client.responses.create = async (body) => {
      const response = await create(body);
      const isSummary = body.instructions === SUMMARY_INSTRUCTIONS;
      if (failure === 'incomplete-summary' && isSummary || failure === 'incomplete-answer' && !isSummary) response.status = 'incomplete';
      if (failure === 'empty-summary' && isSummary) response.output_text = ' ';
      return response;
    };
    const store = new MemoryContextStore(state);
    if (failure === 'save') store.save = () => { throw new Error('private path'); };
    const agent = new Agent({ client, store });
    await assert.rejects(agent.ask('Вопрос'));
    assert.deepEqual(agent.getContext(), state);
    assert.deepEqual(store.load(), state);
    assert.equal(agent.getTotals('summary').total, 120);
    assert.equal(agent.getTotals().total, ['save', 'incomplete-answer'].includes(failure) ? 240 : 120);
  }
});

test('window and token budget checks include summary, protect state and prevent excess generation', async () => {
  for (const options of [{ contextLimit: 400 }, { tokenBudget: 100 }]) {
    const { client, calls } = recordingClient();
    client.responses.inputTokens.count = async () => ({ input_tokens: 350 });
    const agent = new Agent({ client, store: new MemoryContextStore(fixture()), ...options });
    await assert.rejects(agent.ask('Вопрос'));
    assert.equal(calls.length, 0);
    assert.deepEqual(agent.getContext(), fixture());
  }
  const { client, calls } = recordingClient();
  client.responses.inputTokens.count = async () => ({ input_tokens: 50 });
  const agent = new Agent({ client, store: new MemoryContextStore(fixture()), tokenBudget: 434, maxOutputTokens: 320 });
  await assert.rejects(agent.ask('Вопрос'), { code: 'token_budget' });
  assert.equal(calls.length, 1); // Summary's 120 usage + answer's 50 + 320 exceeds the budget.
  assert.equal(agent.getTotals().total, 120);
  assert.deepEqual(agent.getContext(), fixture());
});

test('missing usage stays unknown and prevents another budgeted call; reset keeps spending', async () => {
  const { client } = recordingClient();
  const create = client.responses.create;
  client.responses.create = async (body) => ({ ...await create(body), usage: undefined });
  const agent = new Agent({ client });
  await agent.ask('Вопрос');
  assert.equal(agent.getTotals().unknown, 1);
  await assert.rejects(agent.ask('Ещё вопрос'), { code: 'token_budget' });
  agent.reset();
  assert.deepEqual(agent.getContext(), emptyContext());
  assert.equal(agent.getTotals().calls, 1);
  assert.equal(agent.getTotals().unknown, 1);
});

test('overlapping requests/reset are rejected, snapshots cannot mutate state, and invalid settings fail early', async () => {
  const { client } = recordingClient();
  let release;
  const count = client.responses.inputTokens.count;
  client.responses.inputTokens.count = (body) => new Promise((resolve) => { release = async () => resolve(await count(body)); });
  const agent = new Agent({ client });
  const pending = agent.ask('Вопрос');
  await assert.rejects(agent.ask('Параллельный вопрос'), { code: 'busy' });
  assert.throws(() => agent.reset(), { code: 'busy' });
  await release();
  await pending;
  agent.getContext().recentMessages[0].content = 'Изменено снаружи';
  assert.equal(agent.getContext().recentMessages[0].content, 'Вопрос');
  for (const options of [{ keepLatest: 0 }, { keepLatest: 3 }, { compressEvery: 3 }, { tokenBudget: -1 }]) {
    assert.throws(() => new Agent({ client, ...options }), TypeError);
  }
});
