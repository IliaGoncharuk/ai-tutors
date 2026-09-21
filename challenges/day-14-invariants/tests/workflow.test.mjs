import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialState, applyAction, buildContext, ask, compare, compareProfiles, generateWorkflow, view } from '../server/core.mjs';
import { Repository } from '../server/store.mjs';
import { answer } from './helpers.mjs';

const workflow = (state) => state.workflows[state.activeTask];
const transition = (state, target) => applyAction(state, { type: 'transition', target });

test('пауза отклоняет обе серии сравнения до первого вызова провайдера', async () => {
  const state = applyAction(createInitialState(), { type: 'pause-task' });
  const before = structuredClone(state);
  let calls = 0;
  for (const compareSeries of [compare, compareProfiles]) {
    await assert.rejects(compareSeries(state, { message: 'Сравни ответы.', mode: 'live' }, async () => { calls++; throw new Error('provider must not run'); }), (error) => error.status === 409);
  }
  assert.equal(calls, 0);
  assert.deepEqual(state, before);
});

test('переходы следуют графу этапов, неверный переход не меняет состояние', () => {
  let state = createInitialState();
  const paths = [
    ['planning', ['validation', 'done', 'unknown', '__proto__'], 'execution'],
    ['execution', ['planning', 'done'], 'validation'],
    ['validation', ['planning'], 'execution'],
    ['execution', ['done'], 'validation'],
    ['validation', ['planning'], 'done'],
    ['done', ['planning', 'execution', 'validation'], null],
  ];
  for (const [stage, forbidden, next] of paths) {
    assert.equal(workflow(state).stage, stage);
    const before = structuredClone(state);
    for (const target of forbidden) assert.throws(() => transition(state, target));
    assert.deepEqual(state, before);
    if (next) state = transition(state, next);
  }
});

test('пауза на каждом этапе сохраняет шаг, запрещает работу и восстанавливается после перезапуска', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'day14-pause-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let state = createInitialState();
  for (const stage of ['planning', 'execution', 'validation', 'done']) {
    if (workflow(state).stage !== stage) state = transition(state, stage);
    state = applyAction(state, { type: 'set-step', step: `Сохранённый шаг ${stage}`, expectedAction: `Ожидаемое действие ${stage}` });
    state = applyAction(state, { type: 'pause-task' });
    const before = structuredClone(state);
    assert.equal(workflow(state).paused, true);
    let calls = 0;
    const provider = async () => { calls++; return answer(); };
    assert.throws(() => applyAction(state, { type: 'set-step', step: 'Не сохранять', expectedAction: 'Не сохранять' }));
    assert.throws(() => transition(state, stage === 'planning' ? 'execution' : 'validation'));
    await assert.rejects(ask(state, { message: 'Продолжи работу.', mode: 'live' }, provider));
    await assert.rejects(generateWorkflow(state, { kind: 'plan', mode: 'live' }, provider));
    assert.equal(calls, 0);
    assert.deepEqual(state, before);
    new Repository(directory).write(state);
    state = new Repository(directory).read();
    assert.deepEqual(state, before);
    state = applyAction(state, { type: 'resume-task' });
    assert.equal(workflow(state).paused, false);
    assert.equal(workflow(state).stage, stage);
    assert.equal(workflow(state).step, `Сохранённый шаг ${stage}`);
    assert.equal(workflow(state).expectedAction, `Ожидаемое действие ${stage}`);
  }
});

test('состояние задачи присутствует в запросе без истории и всех слоёв памяти', async () => {
  let state = createInitialState();
  state = (await generateWorkflow(state, { kind: 'plan', mode: 'live' }, answer)).state;
  state = transition(state, 'execution');
  state = (await generateWorkflow(state, { kind: 'artifact', mode: 'live' }, answer)).state;
  state = applyAction(state, { type: 'set-step', step: 'CURRENT_STEP_MARKER_2d90', expectedAction: 'NEXT_ACTION_MARKER_900e' });
  state.sessions[state.activeSession].messages.push({ role: 'user', content: 'OLD_DIALOGUE_SHOULD_NOT_BE_NEEDED' });
  const context = buildContext(state, 'Продолжи с сохранённого шага.', []);
  const stateBlock = context.input.find((message) => message.role === 'developer' && message.content.includes('CURRENT_STEP_MARKER_2d90'));
  assert.ok(stateBlock);
  const includedWorkflow = JSON.parse(stateBlock.content.split('\n').slice(1).join('\n'));
  assert.deepEqual(includedWorkflow, workflow(state));
  assert.ok(includedWorkflow.plan);
  assert.ok(includedWorkflow.artifact);
  assert.ok(!JSON.stringify(context).includes('OLD_DIALOGUE_SHOULD_NOT_BE_NEEDED'));
  assert.deepEqual(view(state).workflow, workflow(state));
});

test('новый диалог сохраняет состояние задачи, новая задача и профиль получают независимое состояние', async () => {
  let state = createInitialState();
  state = (await generateWorkflow(state, { kind: 'plan', mode: 'live' }, answer)).state;
  state = transition(state, 'execution');
  state = applyAction(state, { type: 'set-step', step: 'FIRST_TASK_STEP_6b71', expectedAction: 'Подготовить спецификацию' });
  const firstSession = state.activeSession;
  const firstTask = state.activeTask;
  const originalWorkflow = structuredClone(workflow(state));
  const dialog = applyAction(state, { type: 'new-dialog' });
  assert.deepEqual(workflow(dialog), originalWorkflow);
  const otherTask = applyAction(dialog, { type: 'new-task', title: 'Вторая задача' });
  assert.equal(workflow(otherTask).stage, 'planning');
  assert.equal(workflow(otherTask).plan, '');
  assert.deepEqual(otherTask.workflows[firstTask], originalWorkflow);
  const resumed = applyAction(otherTask, { type: 'resume', sessionId: firstSession });
  assert.deepEqual(workflow(resumed), originalWorkflow);
  const otherProfile = applyAction(resumed, { type: 'switch-profile', profileId: 'expert' });
  assert.equal(workflow(otherProfile).stage, 'planning');
  assert.equal(workflow(otherProfile).plan, '');
  assert.ok(!JSON.stringify(buildContext(otherProfile, 'Что дальше?', [])).includes('FIRST_TASK_STEP_6b71'));
  assert.ok(!JSON.stringify(view(otherProfile)).includes('FIRST_TASK_STEP_6b71'));
  assert.deepEqual(otherProfile.workflows[firstTask], originalWorkflow);
});

test('генерация плана, результата и проверки сохраняет версии без добавления в переписку', async () => {
  let state = createInitialState();
  state.sessions[state.activeSession].messages.push({ role: 'user', content: 'Исходная переписка.' });
  const messages = structuredClone(state.sessions[state.activeSession].messages);
  for (const [kind, stage, field] of [['plan', 'planning', 'plan'], ['artifact', 'execution', 'artifact'], ['review', 'validation', 'review']]) {
    if (workflow(state).stage !== stage) state = transition(state, stage);
    const before = structuredClone(state);
    const generated = await generateWorkflow(state, { kind, mode: 'live' }, answer);
    const text = generated.result.text;
    assert.equal(generated.result.policy.allowed, true);
    assert.deepEqual(state, before);
    state = generated.state;
    if (field === 'review') {
      assert.equal(workflow(state).review.text, text);
      assert.equal(workflow(state).review.artifactVersion, workflow(state).artifactVersion);
      assert.equal(workflow(state).review.mode, 'live');
    } else {
      assert.equal(workflow(state)[field], text);
      assert.equal(workflow(state)[`${field}Version`], 1);
    }
    assert.equal(generated.result.text, text);
    assert.deepEqual(state.sessions[state.activeSession].messages, messages);
  }
});

test('генерация не вызывает провайдера на неверном этапе и откатывает ошибку провайдера', async () => {
  let state = createInitialState();
  for (const stage of ['planning', 'execution', 'validation', 'done']) {
    if (workflow(state).stage !== stage) state = transition(state, stage);
    const before = structuredClone(state);
    for (const kind of ['plan', 'artifact', 'review', 'unknown']) {
      const allowedStage = { plan: 'planning', artifact: 'execution', review: 'validation' }[kind];
      if (allowedStage === stage) continue;
      let called = false;
      await assert.rejects(generateWorkflow(state, { kind, mode: 'live' }, async () => { called = true; return answer(); }));
      assert.equal(called, false);
    }
    if (stage !== 'done') {
      const kind = { planning: 'plan', execution: 'artifact', validation: 'review' }[stage];
      await assert.rejects(generateWorkflow(state, { kind, mode: 'live' }, async () => { throw new Error('workflow provider error'); }), /workflow provider error/);
    }
    assert.deepEqual(state, before);
  }
});

test('план и результат сохраняются в отдельном task-state.json и читаются после перезапуска', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'day14-workflow-store-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let state = (await generateWorkflow(createInitialState(), { kind: 'plan', mode: 'live' }, answer)).state;
  state = transition(state, 'execution');
  state = (await generateWorkflow(state, { kind: 'artifact', mode: 'live' }, answer)).state;
  state = applyAction(state, { type: 'new-dialog' });
  new Repository(directory).write(state);
  const pointer = JSON.parse(await readFile(join(directory, 'CURRENT.json'), 'utf8'));
  const generation = join(directory, 'generations', pointer.generation);
  const savedWorkflows = JSON.parse(await readFile(join(generation, 'task-state.json'), 'utf8'));
  assert.deepEqual(savedWorkflows, state.workflows);
  for (const name of ['sessions.json', 'tasks.json', 'long-term.json', 'system.json']) {
    const raw = await readFile(join(generation, name), 'utf8');
    assert.ok(!raw.includes(JSON.stringify(workflow(state).plan).slice(1, -1)));
    assert.ok(!raw.includes(JSON.stringify(workflow(state).artifact).slice(1, -1)));
  }
  assert.deepEqual(new Repository(directory).read(), state);
});
