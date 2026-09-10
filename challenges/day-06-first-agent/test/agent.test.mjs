import assert from 'node:assert/strict';
import test from 'node:test';

import { Agent, AgentError } from '../agent.mjs';
import {
  createInputPolicy,
  createOutputPolicy,
  PolicyError,
} from '../policies.mjs';

function completed(text, overrides = {}) {
  return {
    status: 'completed',
    model: 'gpt-5.6-luna-2026-09-01',
    output_text: text,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    ...overrides,
  };
}

function fakeClient(handler) {
  return { responses: { create: handler } };
}

test('agent owns configuration, policies, API call and normalized result', async () => {
  let request;
  const agent = new Agent({
    client: fakeClient(async (value) => {
      request = value;
      return completed('  Первый ответ  ');
    }),
    model: 'test-model',
    instructions: 'Test instructions',
    maxOutputTokens: 123,
  });

  const result = await agent.ask('  Привет  ');

  assert.deepEqual(request, {
    model: 'test-model',
    instructions: 'Test instructions',
    input: [{ role: 'user', content: 'Привет' }],
    max_output_tokens: 123,
    reasoning: { effort: 'none' },
    store: false,
  });
  assert.equal(result.text, 'Первый ответ');
  assert.equal(result.model, 'gpt-5.6-luna-2026-09-01');
  assert.deepEqual(agent.getHistory(), [
    { role: 'user', content: 'Привет' },
    { role: 'assistant', content: 'Первый ответ' },
  ]);
});

test('every turn sends the complete transcript and reset starts a new session', async () => {
  const requests = [];
  const answers = ['Меня зовут Агент.', 'Агент.', 'Новая сессия.'];
  const agent = new Agent({
    client: fakeClient(async (request) => {
      requests.push(request);
      return completed(answers[requests.length - 1]);
    }),
  });

  await agent.ask('Как тебя зовут?');
  await agent.ask('Повтори имя');

  assert.deepEqual(requests[1].input, [
    { role: 'user', content: 'Как тебя зовут?' },
    { role: 'assistant', content: 'Меня зовут Агент.' },
    { role: 'user', content: 'Повтори имя' },
  ]);

  agent.reset();
  await agent.ask('Начнём заново');
  assert.deepEqual(requests[2].input, [
    { role: 'user', content: 'Начнём заново' },
  ]);
});

test('input and output policies reject invalid values', () => {
  const input = createInputPolicy({ maxCharacters: 3 });
  const output = createOutputPolicy();

  assert.throws(() => input.apply('   '), PolicyError);
  assert.throws(() => input.apply('1234'), /3 символов/);
  assert.throws(() => output.apply(completed('')), /пустой ответ/);
  assert.throws(
    () => output.apply(completed('partial', { status: 'incomplete' })),
    /не завершила ответ/,
  );
});

test('failed calls do not change history or expose provider error details', async () => {
  const secret = 'test-only-secret';
  const agent = new Agent({
    client: fakeClient(async () => {
      throw new Error(secret);
    }),
  });

  await assert.rejects(agent.ask('Привет'), (error) => {
    assert.ok(error instanceof AgentError);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.deepEqual(agent.getHistory(), []);
});

test('one agent serializes its own conversation turns', async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const agent = new Agent({
    client: fakeClient(async () => {
      await waiting;
      return completed('Готово');
    }),
  });

  const first = agent.ask('Первый вопрос');
  await assert.rejects(agent.ask('Второй вопрос'), /предыдущего ответа/);
  release();
  await first;
});
