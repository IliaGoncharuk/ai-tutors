import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialState, applyAction, buildContext, ask, compareProfiles, view } from '../server/core.mjs';
import { Repository } from '../server/store.mjs';
import { answer } from './helpers.mjs';

const question = 'Как организовать запись к репетитору?';
const currentProfile = (state) => state.longTerm.profiles[state.activeProfile];
const serialized = (value) => JSON.stringify(value);
const privateMarkers = { work: 'NOVICE_WORK_ONLY_11bd', long: 'NOVICE_LONG_ONLY_17ab', short: 'NOVICE_CHAT_ONLY_337e', title: 'NOVICE_TASK_ONLY_ee51' };

function personalState() {
  let state = createInitialState();
  state = applyAction(state, { type: 'new-task', title: privateMarkers.title });
  state = applyAction(state, { type: 'remember', layer: 'work', key: 'novice-private-work-key', value: privateMarkers.work });
  state = applyAction(state, { type: 'remember', layer: 'long', key: 'novice-private-long-key', value: privateMarkers.long });
  state.sessions[state.activeSession].messages.push({ role: 'user', content: privateMarkers.short });
  return state;
}

test('профиль автоматически включён в каждый запрос, включая запрос без слоёв памяти', async () => {
  let state = createInitialState();
  state = applyAction(state, { type: 'update-profile', profile: {
    name: 'Учебный профиль', level: 'PROFILE_LEVEL_42f', style: 'PROFILE_STYLE_863',
    format: 'PROFILE_FORMAT_515', restrictions: 'PROFILE_RESTRICTIONS_718',
  } });
  for (const layers of [[], ['short'], ['work'], ['long'], ['short', 'work', 'long']]) {
    const context = buildContext(state, question, layers);
    const profileMessage = context.input.find((message) => message.role === 'developer');
    assert.ok(profileMessage, 'профиль передаётся отдельным сообщением');
    for (const field of ['level', 'style', 'format', 'restrictions']) assert.ok(profileMessage.content.includes(currentProfile(state)[field]));
    assert.equal(context.input.at(-1).content, question);
  }
  let observed;
  const result = await ask(state, { message: question, layers: [], mode: 'live' }, async (context) => { observed = structuredClone(context); return answer(context); });
  assert.deepEqual(result.result.context, observed);
  assert.ok(observed.input.some((message) => message.role === 'developer' && message.content.includes('PROFILE_STYLE_863')));
});

test('смена профиля изолирует диалог, задачи, долговременные записи и журнал', () => {
  const novice = personalState();
  const snapshot = structuredClone(novice);
  const expert = applyAction(novice, { type: 'switch-profile', profileId: 'expert' });
  assert.equal(expert.activeProfile, 'expert');
  assert.equal(expert.sessions[expert.activeSession].profileId, 'expert');
  assert.equal(expert.tasks[expert.activeTask].profileId, 'expert');
  assert.deepEqual(expert.sessions[expert.activeSession].messages, []);
  assert.deepEqual(expert.tasks[expert.activeTask].entries, []);
  assert.deepEqual(expert.longTerm.entriesByProfile.expert, []);
  const visible = view(expert);
  const context = buildContext(expert, question);
  for (const marker of [...Object.values(privateMarkers), 'novice-private-work-key', 'novice-private-long-key']) {
    assert.ok(!serialized(visible).includes(marker), `чужие данные отсутствуют в view: ${marker}`);
    assert.ok(!serialized(context).includes(marker), `чужие данные отсутствуют в контексте: ${marker}`);
  }
  assert.ok(visible.sessions.every((session) => expert.sessions[session.id].profileId === 'expert'));
  assert.ok(visible.tasks.every((task) => expert.tasks[task.id].profileId === 'expert'));
  assert.throws(() => applyAction(expert, { type: 'resume', sessionId: novice.activeSession }));
  const ownAgain = applyAction(expert, { type: 'switch-profile', profileId: 'novice' });
  assert.equal(ownAgain.activeSession, novice.activeSession);
  assert.equal(ownAgain.activeTask, novice.activeTask);
  for (const marker of Object.values(privateMarkers).filter((value) => value !== privateMarkers.title)) assert.ok(serialized(buildContext(ownAgain, question)).includes(marker));
  assert.deepEqual(novice, snapshot);
});

test('изменение долговременной памяти одного профиля не обновляет и не удаляет запись другого', () => {
  const novice = personalState();
  const privateEntry = novice.longTerm.entriesByProfile.novice[0];
  let expert = applyAction(novice, { type: 'switch-profile', profileId: 'expert' });
  assert.throws(() => applyAction(expert, { type: 'forget', layer: 'long', id: privateEntry.id }));
  expert = applyAction(expert, { type: 'remember', layer: 'long', key: privateEntry.key, value: 'EXPERT_OWN_VALUE' });
  assert.deepEqual(expert.longTerm.entriesByProfile.novice, novice.longTerm.entriesByProfile.novice);
  assert.equal(expert.longTerm.entriesByProfile.expert[0].value, 'EXPERT_OWN_VALUE');
  assert.notEqual(expert.longTerm.entriesByProfile.expert[0].id, privateEntry.id);
});

test('редактор меняет только текущий профиль и сбрасывает предыдущий контекст ответа', async () => {
  const answered = (await ask(createInitialState(), { message: question, mode: 'live' }, answer)).state;
  const snapshot = structuredClone(answered);
  const updated = applyAction(answered, { type: 'update-profile', profile: {
    id: 'expert', name: 'Новый профиль', level: 'Начинающий', style: 'Спокойно и подробно',
    format: 'Нумерованный список', restrictions: 'Без сокращений',
  } });
  assert.equal(updated.activeProfile, 'novice');
  assert.equal(currentProfile(updated).id, 'novice');
  assert.equal(currentProfile(updated).name, 'Новый профиль');
  assert.deepEqual(updated.longTerm.profiles.expert, snapshot.longTerm.profiles.expert);
  assert.deepEqual(updated.longTerm.entriesByProfile, snapshot.longTerm.entriesByProfile);
  assert.equal(updated.lastRun, null);
  assert.deepEqual(answered, snapshot);
});

test('некорректные профили и значения не меняют состояние', () => {
  const state = createInitialState();
  const before = structuredClone(state);
  for (const action of [
    { type: 'switch-profile', profileId: 'missing' },
    { type: 'switch-profile', profileId: '__proto__' },
    { type: 'update-profile', profile: null },
    { type: 'update-profile', profile: { ...currentProfile(state), name: '' } },
    { type: 'update-profile', profile: { ...currentProfile(state), style: [] } },
  ]) assert.throws(() => applyAction(state, action));
  assert.deepEqual(state, before);
});

test('сравнение меняет только профиль: одинаковые факты, без истории и чужой памяти', async () => {
  let state = personalState();
  state = applyAction(state, { type: 'switch-profile', profileId: 'expert' });
  state = applyAction(state, { type: 'remember', layer: 'long', key: 'expertSecret', value: 'FOREIGN_COMPARISON_MEMORY_607a' });
  state = applyAction(state, { type: 'switch-profile', profileId: 'novice' });
  const before = structuredClone(state);
  const contexts = [];
  const comparison = await compareProfiles(state, { message: question, mode: 'live' }, async (context) => {
    contexts.push(structuredClone(context));
    return answer(context);
  });
  assert.equal(comparison.results.length, 3);
  assert.equal(contexts.length, 3);
  assert.deepEqual(state, before);
  for (const field of ['activeProfile', 'activeTask', 'activeSession', 'sessions', 'tasks', 'longTerm']) assert.deepEqual(comparison.state[field], before[field]);
  assert.equal(new Set(contexts.map((context) => context.input[0].content)).size, 1);
  assert.equal(new Set(contexts.map((context) => context.input.find((message) => message.role === 'developer').content)).size, 3);
  for (const context of contexts) {
    const raw = serialized(context);
    assert.ok(raw.includes(privateMarkers.work));
    assert.ok(raw.includes(privateMarkers.long));
    assert.ok(!raw.includes(privateMarkers.short));
    assert.ok(!raw.includes('FOREIGN_COMPARISON_MEMORY_607a'));
    assert.ok(!raw.includes('COMPARISON_RESULT_'));
    assert.equal(context.input.at(-1).content, question);
  }
});

test('ошибка сравнения профилей не сохраняет частичный результат и не переключает пользователя', async () => {
  const state = personalState();
  const before = structuredClone(state);
  let calls = 0;
  await assert.rejects(compareProfiles(state, { message: question, mode: 'live' }, async (context) => {
    if (++calls === 2) throw new Error('profile comparison failure');
    return answer(context);
  }), /profile comparison failure/);
  assert.deepEqual(state, before);
});

test('после перезапуска восстанавливаются выбранный профиль и его отдельные данные', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'day14-profiles-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let state = personalState();
  state = applyAction(state, { type: 'switch-profile', profileId: 'manager' });
  state = applyAction(state, { type: 'remember', layer: 'long', key: 'managerFact', value: 'MANAGER_RESTART_VALUE' });
  new Repository(directory).write(state);
  const restarted = new Repository(directory).read();
  assert.deepEqual(restarted, state);
  assert.equal(restarted.activeProfile, 'manager');
  assert.ok(serialized(buildContext(restarted, question)).includes('MANAGER_RESTART_VALUE'));
  assert.ok(!serialized(view(restarted)).includes(privateMarkers.long));
  const novice = applyAction(restarted, { type: 'switch-profile', profileId: 'novice' });
  assert.ok(serialized(buildContext(novice, question)).includes(privateMarkers.long));
});
