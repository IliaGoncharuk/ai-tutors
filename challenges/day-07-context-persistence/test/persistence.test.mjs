import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { Agent } from '../agent.mjs';
import { historyPath, HistoryError, JsonHistoryStore } from '../history-store.mjs';
import { runProcess, verifyRestart } from '../scripts/restart-demo.mjs';

const pair = [
  { role: 'user', content: 'Условное имя проекта — Кедр 🌲.' },
  { role: 'assistant', content: 'Запомнил: Кедр 🌲.' },
];
const completed = (text = 'Кедр 🌲.') => ({ status: 'completed', output_text: text });
const client = (handler = async () => completed()) => ({ responses: { create: handler } });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-tutors-day07-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'ai-tutors-day07-test-')));
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, file: join(directory, 'messages.json') };
}

test('missing history starts empty; UTF-8 messages round-trip and snapshots are isolated', (t) => {
  const { file, directory } = fixture(t);
  const store = new JsonHistoryStore(file);
  assert.deepEqual(store.load(), []);
  assert.deepEqual(readdirSync(directory), []);
  store.save(pair);
  assert.deepEqual(new JsonHistoryStore(file).load(), pair);
  const agent = new Agent({ client: client(), store });
  const snapshot = agent.getHistory();
  assert.throws(() => { snapshot[0].content = 'changed'; }, TypeError);
  snapshot.pop();
  assert.deepEqual(agent.getHistory(), pair);
  assert.deepEqual(readdirSync(directory), ['messages.json']);
});

test('restored history is sent to the API in order and the complete new turn is committed', async (t) => {
  const { file } = fixture(t);
  const store = new JsonHistoryStore(file);
  store.save(pair);
  let request;
  const agent = new Agent({
    store,
    client: client(async (input) => { request = input; return completed(); }),
  });
  await agent.ask('  Как называется проект?  ');
  assert.deepEqual(request.input, [...pair, { role: 'user', content: 'Как называется проект?' }]);
  assert.equal(request.store, false);
  assert.equal(request.previous_response_id, undefined);
  assert.deepEqual(store.load(), [...request.input, { role: 'assistant', content: 'Кедр 🌲.' }]);
  assert.deepEqual(agent.getHistory(), store.load());
});

test('reset clears memory and disk, and the next process starts with an empty context', async (t) => {
  const { file } = fixture(t);
  const store = new JsonHistoryStore(file);
  store.save(pair);
  const agent = new Agent({ client: client(), store });
  agent.reset();
  assert.deepEqual(agent.getHistory(), []);
  let request;
  const restarted = new Agent({ store: new JsonHistoryStore(file), client: client(async (r) => {
    request = r;
    return completed('Новый диалог.');
  }) });
  assert.deepEqual(restarted.getHistory(), []);
  await restarted.ask('Привет');
  assert.deepEqual(request.input, [{ role: 'user', content: 'Привет' }]);
});

test('malformed, unsupported and incomplete histories fail without overwriting the file', (t) => {
  const { file } = fixture(t);
  const cases = [
    '{broken', '', 'null',
    JSON.stringify({ version: 2, messages: pair }),
    JSON.stringify({ version: 1, messages: pair, token: 'synthetic' }),
    JSON.stringify({ version: 1, messages: [pair[0]] }),
    JSON.stringify({ version: 1, messages: [{ role: 'system', content: 'x' }, pair[1]] }),
    JSON.stringify({ version: 1, messages: [pair[1], pair[0]] }),
    JSON.stringify({ version: 1, messages: [pair[0], { role: 'assistant', content: '' }] }),
    JSON.stringify({ version: 1, messages: [pair[0], { ...pair[1], secret: 'synthetic' }] }),
  ];
  for (const content of cases) {
    writeFileSync(file, content);
    assert.throws(() => new Agent({ client: client(), store: new JsonHistoryStore(file) }), HistoryError);
    assert.equal(readFileSync(file, 'utf8'), content);
  }
});

test('unreadable history is an error, not an empty conversation', (t) => {
  const { file } = fixture(t);
  mkdirSync(file);
  assert.throws(() => new JsonHistoryStore(file).load(), /прочитать историю/);
});

test('API failures and rejected output keep the last saved transcript unchanged', async (t) => {
  const { file } = fixture(t);
  const store = new JsonHistoryStore(file);
  store.save(pair);
  const original = readFileSync(file, 'utf8');
  const handlers = [
    async () => { throw new Error('synthetic-provider-secret'); },
    async () => completed('  '),
    async () => ({ ...completed(), status: 'incomplete' }),
  ];
  for (const handler of handlers) {
    const agent = new Agent({ store, client: client(handler) });
    await assert.rejects(agent.ask('Вопрос'), (error) => !error.message.includes('synthetic-provider-secret'));
    assert.deepEqual(agent.getHistory(), pair);
    assert.equal(readFileSync(file, 'utf8'), original);
  }
});

test('save and reset failures preserve in-memory context; subsequent calls can recover', async () => {
  let fail = true;
  let saved = structuredClone(pair);
  const agent = new Agent({ client: client(), store: {
    load: () => structuredClone(saved),
    save: (messages) => {
      if (fail) throw new HistoryError('Synthetic write failure');
      saved = structuredClone(messages);
    },
  } });
  await assert.rejects(agent.ask('Вопрос'), /write failure/);
  assert.throws(() => agent.reset(), /write failure/);
  assert.deepEqual(agent.getHistory(), pair);
  assert.deepEqual(saved, pair);
  fail = false;
  await agent.ask('Ещё вопрос');
  assert.equal(saved.length, 4);
  assert.deepEqual(agent.getHistory(), saved);
});

test('failed file replacement removes the temporary file and leaves its target intact', (t) => {
  const { file, directory } = fixture(t);
  mkdirSync(file);
  writeFileSync(join(file, 'sentinel'), 'untouched');
  assert.throws(() => new JsonHistoryStore(file).save(pair), /сохранить историю/);
  assert.deepEqual(readdirSync(directory), ['messages.json']);
  assert.equal(readFileSync(join(file, 'sentinel'), 'utf8'), 'untouched');
});

test('invalid input makes no API call or file change, and in-flight turns block reset', async (t) => {
  const { file } = fixture(t);
  let release;
  let calls = 0;
  const waiting = new Promise((resolveWait) => { release = resolveWait; });
  const agent = new Agent({ store: new JsonHistoryStore(file), client: client(async () => {
    calls += 1;
    await waiting;
    return completed();
  }) });
  await assert.rejects(agent.ask(' '), /непустое/);
  await assert.rejects(agent.ask('a'.repeat(8001)), /8000/);
  assert.equal(calls, 0);
  const first = agent.ask('Первый');
  await assert.rejects(agent.ask('Второй'), /предыдущего/);
  assert.throws(() => agent.reset(), /во время ответа/);
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(new JsonHistoryStore(file).load().length, 2);
});

test('default path is stable and a relative override is rejected', () => {
  assert.equal(historyPath({}), historyPath({ AGENT_HISTORY_FILE: ' ' }));
  assert.throws(() => historyPath({ AGENT_HISTORY_FILE: './messages.json' }), /абсолютный/);
  const absolute = join(tmpdir(), 'custom-messages.json');
  assert.equal(historyPath({ AGENT_HISTORY_FILE: absolute }), absolute);
});

test('two actual CLI processes preserve context across restart and different working directories', async () => {
  const messages = [];
  await verifyRestart({ write: (line) => messages.push(line) });
  assert.ok(messages.some((line) => line.includes('Проверка пройдена')));
});

test('CLI reset survives exit and history display does not call the API', async (t) => {
  const { file } = fixture(t);
  const script = new URL('../scripts/offline-cli.mjs', import.meta.url);
  const store = new JsonHistoryStore(file);
  store.save(pair);
  const env = { AGENT_HISTORY_FILE: file, OPENAI_API_KEY: '' };
  const first = await runProcess(script, ['/history', '/reset', '/exit'], env);
  assert.equal(first.code, 0);
  assert.equal(first.stderr, '');
  assert.match(first.stdout, /Кедр 🌲/);
  assert.deepEqual(store.load(), []);
  const second = await runProcess(script, ['/history', '/exit'], env);
  assert.equal(second.code, 0);
  assert.match(second.stdout, /Восстановлено сообщений: 0/);
  assert.match(second.stdout, /История пуста/);
  assert.deepEqual(store.load(), []);
});

test('CLI refuses corrupt history and missing API key without changing the file', async (t) => {
  const { file } = fixture(t);
  writeFileSync(file, 'broken');
  const corrupt = await runProcess(new URL('../scripts/offline-cli.mjs', import.meta.url), ['/exit'], {
    AGENT_HISTORY_FILE: file, OPENAI_API_KEY: '',
  });
  assert.equal(corrupt.code, 1);
  assert.match(corrupt.stderr, /История повреждена/);
  const missingKey = await runProcess(new URL('../cli.mjs', import.meta.url), ['/exit'], {
    AGENT_HISTORY_FILE: file, OPENAI_API_KEY: '',
  });
  assert.equal(missingKey.code, 1);
  assert.match(missingKey.stderr, /OPENAI_API_KEY недоступен/);
  assert.equal(readFileSync(file, 'utf8'), 'broken');
});
