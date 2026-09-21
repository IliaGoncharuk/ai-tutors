import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createServer } from '../server/index.mjs';
import { Repository } from '../server/store.mjs';

const fakeAnswer = { text: 'Проверочный ответ без API.', model: 'test-provider', usage: null };

async function fixture(t, generator = async () => fakeAnswer) {
  const directory = await mkdtemp(join(tmpdir(), 'day13-http-test-'));
  let app;
  t.after(async () => {
    try { await app?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  });
  app = await createServer({ directory, port: 0, generator, production: true });
  const base = `http://127.0.0.1:${app.port}`;
  const state = async () => (await fetch(`${base}/api/state`)).json();
  const post = (path, body, options = {}) => fetch(`${base}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.raw ?? JSON.stringify(body),
  });
  return { base, directory, state, post };
}

test('HTTP отклоняет повреждённое тело и неизвестный режим без записи состояния', async (t) => {
  const app = await fixture(t);
  const before = await app.state();
  for (const request of [
    { path: 'action', body: null, options: { raw: '{"type":' }, status: 400 },
    { path: 'action', body: [], status: 400 },
    { path: 'action', body: null, status: 400 },
    { path: 'chat', body: { message: 'Тест', mode: 'automatic' }, status: 400 },
    { path: 'chat', body: { message: 'Тест' }, status: 400 },
    { path: 'context', body: { message: 'Тест', layers: ['../../system'] }, status: 400 },
    { path: 'action', body: { type: 'seed' }, options: { headers: { 'Content-Type': 'text/plain' } }, status: 415 },
    { path: 'chat', body: { message: 'x'.repeat(33000), mode: 'demo' }, status: 413 },
  ]) {
    const response = await app.post(request.path, request.body, request.options);
    assert.equal(response.status, request.status);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.deepEqual(await app.state(), before);
});

test('повреждённый request-target возвращает 400 и не завершает сервер', async (t) => {
  const app = await fixture(t);
  const before = await app.state();
  const status = await new Promise((resolve, reject) => {
    const url = new URL(app.base);
    const req = request({ hostname: url.hostname, port: url.port, path: 'http://[', method: 'GET' }, (res) => {
      res.resume();
      res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject);
    req.end();
  });
  assert.equal(status, 400);
  assert.deepEqual(await app.state(), before);
});

test('HTTP сохраняет кириллицу, когда символ UTF-8 разбит между сетевыми порциями', async (t) => {
  const app = await fixture(t);
  const value = 'Привет';
  const buffer = Buffer.from(JSON.stringify({ type: 'remember', layer: 'work', key: 'utf8', value }));
  const split = buffer.indexOf(Buffer.from(value)) + 1;
  const result = await new Promise((resolve, reject) => {
    const req = request(`${app.base}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.once('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.once('error', reject);
    req.write(buffer.subarray(0, split));
    // A separate event-loop turn makes the server receive the partial character.
    setTimeout(() => req.end(buffer.subarray(split)), 25);
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.task.entries[0].value, value);
  assert.equal((await app.state()).task.entries[0].value, value);
});

test('HTTP принимает локальный origin и отклоняет запись с другого сайта и нелокальный Host', async (t) => {
  const app = await fixture(t);
  const before = await app.state();
  const rejectedOrigin = await app.post('action', { type: 'seed' }, { headers: { Origin: 'https://external.example' } });
  assert.equal(rejectedOrigin.status, 403);
  assert.equal(rejectedOrigin.headers.get('access-control-allow-origin'), null);
  // fetch normalizes the Host header; use a raw HTTP request to exercise this boundary.
  const rejectedHostStatus = await new Promise((resolve, reject) => {
    const req = request(`${app.base}/api/action`, { method: 'POST', headers: { Host: 'external.example', 'Content-Type': 'application/json' } }, (res) => {
      res.resume();
      res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject);
    req.end(JSON.stringify({ type: 'seed' }));
  });
  assert.equal(rejectedHostStatus, 403);
  assert.deepEqual(await app.state(), before);
  const allowed = await app.post('action', { type: 'seed' }, { headers: { Origin: app.base } });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).revision, before.revision + 1);
});

test('HTTP возвращает 409 на изменение памяти во время ответа и затем освобождает блокировку', async (t) => {
  let begin, finish;
  const started = new Promise((resolve) => { begin = resolve; });
  const pending = new Promise((resolve) => { finish = resolve; });
  const app = await fixture(t, async () => { begin(); await pending; return fakeAnswer; });
  const before = await app.state();
  const chatPromise = app.post('chat', { message: 'Начни планирование.', mode: 'live' });
  try {
    await started;
    const action = await app.post('action', { type: 'remember', layer: 'work', key: 'lessonMinutes', value: '60' });
    assert.equal(action.status, 409);
    assert.deepEqual(await app.state(), before);
  } finally {
    finish();
  }
  const chat = await chatPromise;
  assert.equal(chat.status, 200);
  const afterChat = (await chat.json()).state;
  assert.equal(afterChat.session.messages.length, 2);
  assert.deepEqual(afterChat.task.entries, []);
  const after = await app.post('action', { type: 'remember', layer: 'work', key: 'lessonMinutes', value: '60' });
  assert.equal(after.status, 200);
  assert.equal((await after.json()).task.entries[0].value, '60');
});

test('HTTP ошибка провайдера не меняет память на диске и разрешает следующий запрос', async (t) => {
  const app = await fixture(t, async () => { throw new Error('INTERNAL_PROVIDER_ERROR_DO_NOT_EXPOSE'); });
  const before = await app.state();
  const saved = new Repository(app.directory).read();
  const response = await app.post('chat', { message: 'Сохрани эту просьбу только после успеха.', mode: 'live' });
  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(await response.json()), /INTERNAL_PROVIDER_ERROR/);
  assert.deepEqual(await app.state(), before);
  assert.deepEqual(new Repository(app.directory).read(), saved);
  const next = await app.post('action', { type: 'seed' });
  assert.equal(next.status, 200);
});

test('второй сервер не получает каталог активного сервера и не повреждает его данные', async (t) => {
  const app = await fixture(t);
  await app.post('action', { type: 'seed' });
  const before = await app.state();
  await assert.rejects(createServer({ directory: app.directory, port: 0, production: true, generator: async () => fakeAnswer }), /занят|lock/);
  assert.deepEqual(await app.state(), before);
  assert.equal((await app.post('action', { type: 'new-dialog' })).status, 200);
});

test('HTTP demo не вызывает провайдера, live передаёт видимый контекст и сохраняет успешную пару', async (t) => {
  const contexts = [];
  const app = await fixture(t, async (context) => { contexts.push(structuredClone(context)); return fakeAnswer; });
  await app.post('action', { type: 'seed' });
  const demo = await app.post('chat', { message: 'Покажи данные.', mode: 'demo' });
  const simulation = await demo.json();
  assert.equal(demo.status, 200);
  assert.equal(contexts.length, 0);
  assert.equal(simulation.result.mode, 'demo');
  assert.match(simulation.result.text, /СИМУЛЯЦИЯ/);
  const context = await app.post('context', { message: 'Уточни требования.', layers: ['work'] });
  const expectedContext = await context.json();
  const live = await app.post('chat', { message: 'Уточни требования.', mode: 'live', layers: ['work'] });
  const result = await live.json();
  assert.equal(live.status, 200);
  assert.deepEqual(contexts, [expectedContext]);
  assert.deepEqual(result.result.context, expectedContext);
  assert.equal(result.state.session.messages.at(-2).content, 'Уточни требования.');
  assert.equal(result.state.session.messages.at(-1).content, fakeAnswer.text);
});

test('HTTP смена профиля скрывает чужую память и запрещает прямое продолжение чужого диалога', async (t) => {
  const app = await fixture(t);
  const marker = 'HTTP_PRIVATE_NOVICE_7601';
  await app.post('action', { type: 'new-task', title: marker });
  await app.post('action', { type: 'remember', layer: 'long', key: marker, value: marker });
  const novice = await app.state();
  const switched = await app.post('action', { type: 'switch-profile', profileId: 'expert' });
  assert.equal(switched.status, 200);
  const expert = await switched.json();
  assert.equal(expert.activeProfile, 'expert');
  assert.ok(!JSON.stringify(expert).includes(marker));
  assert.ok(!JSON.stringify(await app.state()).includes(marker));
  const context = await app.post('context', { message: 'Какие данные тебе известны?' });
  assert.ok(!JSON.stringify(await context.json()).includes(marker));
  const foreignResume = await app.post('action', { type: 'resume', sessionId: novice.session.id });
  assert.equal(foreignResume.status, 403);
  assert.deepEqual(await app.state(), expert);
  const restored = await app.post('action', { type: 'switch-profile', profileId: 'novice' });
  const visible = await restored.json();
  assert.equal(visible.session.id, novice.session.id);
  assert.equal(visible.longTerm.entries[0].value, marker);
});

test('HTTP сравнение профилей отправляет три запроса с одними фактами и сохраняет текущий профиль', async (t) => {
  const contexts = [];
  const app = await fixture(t, async (context) => { contexts.push(structuredClone(context)); return fakeAnswer; });
  await app.post('action', { type: 'seed' });
  const before = await app.state();
  const response = await app.post('profiles/compare', { message: 'Объясни проект.', mode: 'live' });
  const comparison = await response.json();
  assert.equal(response.status, 200);
  assert.equal(comparison.results.length, 3);
  assert.equal(contexts.length, 3);
  assert.equal(new Set(contexts.map((context) => context.input[0].content)).size, 1);
  assert.equal(new Set(contexts.map((context) => context.input.find((message) => message.role === 'developer').content)).size, 3);
  assert.equal(comparison.state.activeProfile, before.activeProfile);
  assert.deepEqual(comparison.state.session, before.session);
  assert.deepEqual(comparison.state.task, before.task);
  assert.deepEqual(comparison.state.longTerm, before.longTerm);
  assert.equal((await app.state()).activeProfile, before.activeProfile);
});

test('HTTP пауза и перезапуск на каждом этапе сохраняют шаг и продолжение задачи', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'day13-http-restart-test-'));
  let app, calls = 0;
  const generator = async () => { calls++; return fakeAnswer; };
  const start = async () => { app = await createServer({ directory, port: 0, generator, production: true }); };
  const state = async () => (await fetch(`http://127.0.0.1:${app.port}/api/state`)).json();
  const post = (path, body) => fetch(`http://127.0.0.1:${app.port}/api/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  t.after(async () => { try { await app?.close(); } finally { await rm(directory, { recursive: true, force: true }); } });
  await start();
  for (const stage of ['planning', 'execution', 'validation', 'done']) {
    if ((await state()).workflow.stage !== stage) assert.equal((await post('action', { type: 'transition', target: stage })).status, 200);
    assert.equal((await post('action', { type: 'set-step', step: `Шаг ${stage}`, expectedAction: `Действие ${stage}` })).status, 200);
    assert.equal((await post('action', { type: 'pause-task' })).status, 200);
    const paused = await state();
    assert.equal(paused.workflow.paused, true);
    await app.close();
    app = null;
    await start();
    assert.deepEqual(await state(), paused);
    assert.equal((await post('chat', { message: 'Продолжи работу.', mode: 'live' })).status, 409);
    assert.equal((await post('workflow', { kind: 'plan', mode: 'live' })).status, 409);
    assert.deepEqual(await state(), paused);
    const resumedResponse = await post('action', { type: 'resume-task' });
    assert.equal(resumedResponse.status, 200);
    const resumed = await resumedResponse.json();
    assert.equal(resumed.workflow.paused, false);
    assert.equal(resumed.workflow.stage, stage);
    assert.equal(resumed.workflow.step, `Шаг ${stage}`);
    assert.equal(resumed.workflow.expectedAction, `Действие ${stage}`);
  }
  assert.equal(calls, 0, 'пауза отклоняет запрос до вызова провайдера');
});
