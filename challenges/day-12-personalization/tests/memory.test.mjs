import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createInitialState, buildContext, applyAction, ask, compare } from '../server/core.mjs';
import { Repository } from '../server/store.mjs';

const question = 'Составь требования к сервису записи к репетиторам.';
const markers = { short: 'SHORT_ONLY_7d290', work: 'WORK_ONLY_b85f1', long: 'LONG_ONLY_a73c4' };
const serialized = (value) => JSON.stringify(value);
const currentSession = (state) => state.sessions[state.activeSession];
const currentTask = (state) => state.tasks[state.activeTask];
const memory = (state) => ({ sessions: state.sessions, tasks: state.tasks, longTerm: state.longTerm });
const answer = async () => ({
  text: 'Ответ тестового провайдера.',
  model: 'test-provider',
  usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
});

function withMarkers() {
  let state = createInitialState();
  state = applyAction(state, { type: 'remember', layer: 'work', key: 'testWork', value: markers.work });
  state = applyAction(state, { type: 'remember', layer: 'long', key: 'testLong', value: markers.long });
  currentSession(state).messages.push({ role: 'user', content: markers.short });
  return state;
}

test('слои включаются в фактический контекст только по явному выбору', () => {
  const state = withMarkers();
  const snapshot = structuredClone(state);
  for (const selected of [[], ['short'], ['work'], ['long'], ['short', 'work', 'long']]) {
    const context = serialized(buildContext(state, question, selected));
    assert.ok(context.includes(question));
    for (const [layer, marker] of Object.entries(markers)) {
      assert.equal(context.includes(marker), selected.includes(layer), `слой ${layer}, выбор ${selected}`);
    }
  }
  assert.deepEqual(state, snapshot, 'сборка запроса не меняет память');
});

test('seed раскладывает известные данные по трём разным слоям', () => {
  const initial = createInitialState();
  const snapshot = structuredClone(initial);
  const state = applyAction(initial, { type: 'seed' });
  assert.deepEqual(initial, snapshot);
  assert.match(serialized(currentSession(state).messages), /отмене/);
  assert.match(serialized(currentTask(state).entries), /Сервис записи к репетиторам/);
  assert.match(serialized(currentTask(state).entries), /45/);
  assert.match(serialized(state.longTerm.entriesByProfile[state.activeProfile]), /Asia\/Yekaterinburg/);
  assert.doesNotMatch(serialized(currentTask(state).entries), /Asia\/Yekaterinburg/);
  assert.doesNotMatch(serialized(state.longTerm.entriesByProfile[state.activeProfile]), /отмене/);
});

test('обновление записи заменяет старое значение в запросе, удаление убирает его', () => {
  let state = applyAction(createInitialState(), { type: 'remember', layer: 'work', key: 'lessonMinutes', value: 'OLD_45_MINUTES' });
  const beforeUpdate = structuredClone(state);
  const updated = applyAction(state, { type: 'remember', layer: 'work', key: 'lessonMinutes', value: 'NEW_60_MINUTES' });
  assert.deepEqual(state, beforeUpdate);
  assert.match(serialized(buildContext(updated, question)), /NEW_60_MINUTES/);
  assert.doesNotMatch(serialized(buildContext(updated, question)), /OLD_45_MINUTES/);
  const entries = currentTask(updated).entries;
  const matching = entries.filter((entry) => entry.key === 'lessonMinutes');
  assert.equal(matching.length, 1, 'актуальное значение не конкурирует с прежней записью');
  state = applyAction(updated, { type: 'forget', layer: 'work', id: matching[0].id });
  assert.doesNotMatch(serialized(buildContext(state, question)), /NEW_60_MINUTES/);
  assert.match(serialized(buildContext(updated, question)), /NEW_60_MINUTES/, 'удаление не мутирует прошлый снимок');
});

test('новый диалог сохраняет задачу, новая задача изолирует рабочие записи, resume восстанавливает связь', () => {
  const original = withMarkers();
  const snapshot = structuredClone(original);
  const originalSession = original.activeSession;
  const originalTask = original.activeTask;
  const dialog = applyAction(original, { type: 'new-dialog' });
  assert.notEqual(dialog.activeSession, originalSession);
  assert.equal(dialog.activeTask, originalTask);
  assert.deepEqual(currentSession(dialog).messages, []);
  assert.match(serialized(buildContext(dialog, question)), new RegExp(markers.work));
  assert.doesNotMatch(serialized(buildContext(dialog, question)), new RegExp(markers.short));

  const otherTask = applyAction(dialog, { type: 'new-task', title: 'Другая задача' });
  assert.notEqual(otherTask.activeTask, originalTask);
  assert.deepEqual(currentTask(otherTask).entries, []);
  const otherContext = serialized(buildContext(otherTask, question));
  assert.ok(otherContext.includes(markers.long));
  assert.ok(!otherContext.includes(markers.work));
  assert.ok(!otherContext.includes(markers.short));

  const resumed = applyAction(otherTask, { type: 'resume', sessionId: originalSession });
  assert.equal(resumed.activeTask, originalTask);
  assert.equal(resumed.activeSession, originalSession);
  for (const marker of Object.values(markers)) assert.ok(serialized(buildContext(resumed, question)).includes(marker));
  assert.deepEqual(original, snapshot, 'дальнейшие действия не меняют исходный снимок');
});

test('успешные ответы сохраняют только последние шесть сообщений, не пополняя другие слои', async () => {
  let state = withMarkers();
  const original = structuredClone(state);
  const longTerm = structuredClone(state.longTerm);
  const tasks = structuredClone(state.tasks);
  for (let number = 0; number < 4; number++) {
    const response = await ask(state, { message: `QUESTION_${number}`, mode: 'live' }, answer);
    state = response.state;
  }
  assert.deepEqual(state.tasks, tasks);
  assert.deepEqual(state.longTerm, longTerm);
  assert.equal(currentSession(state).messages.length, 6);
  const short = serialized(currentSession(state).messages);
  assert.ok(!short.includes('QUESTION_0'));
  assert.ok(short.includes('QUESTION_1'));
  assert.ok(short.includes('QUESTION_3'));
  assert.equal(currentSession(original).messages.length, 1);
});

test('ошибка провайдера не сохраняет вопрос и не меняет состояние', async () => {
  const state = withMarkers();
  const before = structuredClone(state);
  await assert.rejects(ask(state, { message: question, mode: 'live' }, async () => {
    throw new Error('provider unavailable');
  }), /provider unavailable/);
  assert.deepEqual(state, before);
});

test('сравнение использует четыре независимых контекста и не добавляет ответы в диалог', async () => {
  const state = withMarkers();
  const before = structuredClone(state);
  const seen = [];
  const comparison = await compare(state, { message: question, mode: 'live' }, async (context) => {
    seen.push(structuredClone(context));
    return { ...(await answer()), text: `COMPARE_RESPONSE_${seen.length}` };
  });
  assert.equal(comparison.results.length, 4);
  assert.equal(seen.length, 4);
  assert.deepEqual(state, before);
  assert.deepEqual(memory(comparison.state), memory(before));
  const masks = seen.map((context) => Object.values(markers).map((marker) => serialized(context).includes(marker)).join(','));
  assert.equal(new Set(masks).size, 4);
  for (const context of seen) {
    assert.ok(serialized(context).includes(question));
    assert.doesNotMatch(serialized(context), /COMPARE_RESPONSE_/);
  }
});

test('прерванное сравнение не оставляет частичный результат в исходном состоянии', async () => {
  const state = withMarkers();
  const before = structuredClone(state);
  let calls = 0;
  await assert.rejects(compare(state, { message: question, mode: 'live' }, async () => {
    if (++calls === 2) throw new Error('comparison failed');
    return answer();
  }), /comparison failed/);
  assert.deepEqual(state, before);
});

test('недопустимые слои и действия отвергаются до изменения памяти', async () => {
  const state = withMarkers();
  const before = structuredClone(state);
  for (const action of [
    { type: 'remember', layer: 'short', key: 'x', value: 'bad' },
    { type: 'remember', layer: '../../system', key: 'x', value: 'bad' },
    { type: 'remember', layer: 'work', key: '', value: 'bad' },
    { type: 'remember', layer: 'long', key: 'x', value: '' },
    { type: 'resume', sessionId: '../../other' },
    { type: 'unknown' },
  ]) assert.throws(() => applyAction(state, action));
  assert.throws(() => buildContext(state, question, ['system']));
  await assert.rejects(ask(state, { message: '', mode: 'demo' }));
  assert.deepEqual(state, before);
});

test('раздельная JSON-память восстанавливает состояние после создания нового Repository', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'day12-memory-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = new Repository(directory);
  assert.equal(await first.read(), null);
  const state = withMarkers();
  await first.write(state);
  const restarted = new Repository(directory);
  assert.deepEqual(await restarted.read(), state);

  const jsonFiles = await collectJson(directory);
  const contents = await Promise.all(jsonFiles.map((path) => readFile(path, 'utf8')));
  for (const marker of Object.values(markers)) {
    const matches = contents.filter((content) => content.includes(marker));
    assert.ok(matches.length >= 1, `данные ${marker} записаны на диск`);
    for (const content of matches) {
      for (const otherMarker of Object.values(markers).filter((value) => value !== marker)) {
        assert.ok(!content.includes(otherMarker), 'разные слои не объединены в один JSON');
      }
    }
  }
  const updated = applyAction(state, { type: 'new-task', title: 'После перезапуска' });
  await restarted.write(updated);
  assert.deepEqual(await new Repository(directory).read(), updated);
});

test('незавершённая запись нового поколения не вытесняет опубликованную память', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'day12-interrupted-store-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new Repository(directory);
  const original = withMarkers();
  repository.write(original);
  const unpublished = join(directory, 'generations', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await mkdir(unpublished, { recursive: true });
  await writeFile(join(unpublished, 'sessions.json'), '{"incomplete":true}\n');
  assert.deepEqual(new Repository(directory).read(), original, 'перезапуск игнорирует неопубликованную неполную запись');
  const updated = applyAction(original, { type: 'remember', layer: 'work', key: 'afterRestart', value: 'saved' });
  repository.write(updated);
  assert.deepEqual(new Repository(directory).read(), updated);
});

test('ошибка очистки старых поколений после commit не превращает успешную запись в отказ', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'day12-cleanup-store-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new Repository(directory);
  const original = createInitialState();
  repository.write(original);
  const updated = applyAction(original, { type: 'seed' });
  const previousReaddir = fs.readdirSync;
  try {
    fs.readdirSync = () => { throw new Error('simulated directory enumeration failure'); };
    syncBuiltinESMExports();
    assert.doesNotThrow(() => repository.write(updated));
  } finally {
    fs.readdirSync = previousReaddir;
    syncBuiltinESMExports();
  }
  assert.deepEqual(new Repository(directory).read(), updated);
});

async function collectJson(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectJson(path));
    else if (entry.name.endsWith('.json')) result.push(path);
  }
  return result;
}
