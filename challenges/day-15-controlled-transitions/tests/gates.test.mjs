import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, applyAction, ask, generateWorkflow, view } from '../server/core.mjs';
import { proposalFor } from '../server/invariants.mjs';
import { answer, advance } from './helpers.mjs';

const flow = (state) => state.workflows[state.activeTask];
const act = (state, type, fields = {}) => applyAction(state, { type, ...fields });

test('выполнение требует текущий план и явное утверждение его точной версии', async () => {
  let state = createInitialState();
  const initial = structuredClone(state);
  assert.equal(view(state).gates.execution.allowed, false);
  assert.ok(view(state).gates.execution.reason);
  assert.throws(() => act(state, 'approve-plan', { planVersion: 0 }));
  assert.throws(() => act(state, 'transition', { target: 'execution' }));
  assert.deepEqual(state, initial);
  state = (await generateWorkflow(state, { kind: 'plan', mode: 'live' }, answer)).state;
  assert.equal(view(state).gates.execution.allowed, false);
  assert.throws(() => act(state, 'transition', { target: 'execution' }));
  assert.throws(() => act(state, 'approve-plan', { planVersion: flow(state).planVersion - 1 }));
  state = act(state, 'approve-plan', { planVersion: flow(state).planVersion });
  assert.equal(flow(state).approvedPlanVersion, flow(state).planVersion);
  assert.equal(flow(state).approvedRequirementsVersion, flow(state).requirementsVersion);
  assert.equal(view(state).gates.execution.allowed, true);
  state = act(state, 'transition', { target: 'execution' });
  assert.equal(flow(state).stage, 'execution');
  assert.equal(view(state).gates.validation.allowed, false, 'одного утверждения плана недостаточно без результата');
  assert.throws(() => act(state, 'transition', { target: 'validation' }));
});

test('новая версия плана отменяет старое утверждение', async () => {
  let state = (await generateWorkflow(createInitialState(), { kind: 'plan', mode: 'live' }, answer)).state;
  const oldVersion = flow(state).planVersion;
  state = act(state, 'approve-plan', { planVersion: oldVersion });
  state = (await generateWorkflow(state, { kind: 'plan', mode: 'live' }, answer)).state;
  assert.equal(flow(state).planVersion, oldVersion + 1);
  assert.equal(flow(state).approvedPlanVersion, null);
  assert.equal(view(state).gates.execution.allowed, false);
  assert.throws(() => act(state, 'approve-plan', { planVersion: oldVersion }));
  assert.throws(() => act(state, 'transition', { target: 'execution' }));
});

test('изменение рабочих требований, удаление и seed отменяют утверждение и проверку', async () => {
  let initial = act(createInitialState(), 'remember', { layer: 'work', key: 'detail', value: 'Исходное требование' });
  initial = await advance(initial, 'validation');
  initial = act(initial, 'validate-task');
  assert.equal(flow(initial).validation.passed, true);
  const entryId = initial.tasks[initial.activeTask].entries[0].id;
  for (const action of [
    { type: 'remember', layer: 'work', key: 'detail', value: 'Изменённое требование' },
    { type: 'forget', layer: 'work', id: entryId },
    { type: 'seed' },
  ]) {
    const state = applyAction(initial, action);
    assert.equal(flow(state).requirementsVersion, flow(initial).requirementsVersion + 1);
    assert.equal(flow(state).stage, 'planning');
    assert.equal(flow(state).approvedPlanVersion, null);
    assert.equal(flow(state).validation, null);
    assert.notEqual(flow(state).planRequirementsVersion, flow(state).requirementsVersion);
    assert.throws(() => act(state, 'approve-plan', { planVersion: flow(state).planVersion }));
    assert.throws(() => act(state, 'transition', { target: 'execution' }));
  }
  assert.equal(flow(initial).validation.passed, true);
  const done = act(initial, 'transition', { target: 'done' });
  const revised = act(done, 'remember', { layer: 'work', key: 'detail', value: 'Новое требование после завершения' });
  assert.equal(flow(revised).stage, 'planning');
  assert.equal(flow(revised).validation, null);
  const paused = act(initial, 'pause-task');
  const pausedBefore = structuredClone(paused);
  for (const action of [
    { type: 'remember', layer: 'work', key: 'detail', value: 'Не записывать' },
    { type: 'forget', layer: 'work', id: entryId },
    { type: 'seed' },
  ]) assert.throws(() => applyAction(paused, action), (error) => error.status === 409);
  assert.deepEqual(paused, pausedBefore);
});

test('пересмотр плана возвращает к планированию и требует повторной генерации', async () => {
  let state = await advance(createInitialState(), 'done');
  const oldVersion = flow(state).planVersion;
  state = act(state, 'revise-plan');
  assert.equal(flow(state).stage, 'planning');
  assert.equal(flow(state).planRequirementsVersion, null);
  assert.equal(flow(state).approvedPlanVersion, null);
  assert.equal(flow(state).validation, null);
  assert.throws(() => act(state, 'approve-plan', { planVersion: oldVersion }));
  const paused = act(state, 'pause-task');
  assert.throws(() => act(paused, 'revise-plan'));
  state = (await generateWorkflow(state, { kind: 'plan', mode: 'live' }, answer)).state;
  assert.equal(flow(state).planVersion, oldVersion + 1);
  state = act(state, 'approve-plan', { planVersion: flow(state).planVersion });
  assert.equal(view(state).gates.execution.allowed, true);
});

test('обзор модели не заменяет программную валидацию; успешная проверка открывает done', async () => {
  let state = await advance(createInitialState(), 'validation');
  state = (await generateWorkflow(state, { kind: 'review', mode: 'live' }, answer)).state;
  assert.ok(flow(state).review);
  assert.equal(flow(state).validation, null);
  assert.equal(view(state).gates.done.allowed, false);
  assert.throws(() => act(state, 'transition', { target: 'done' }));
  state = act(state, 'validate-task');
  assert.equal(flow(state).validation.passed, true);
  assert.equal(view(state).gates.done.allowed, true);
  state = act(state, 'transition', { target: 'done' });
  assert.equal(flow(state).stage, 'done');
});

test('новый артефакт отменяет прежнюю проверку, изменение содержимого обнаруживается по хешу', async () => {
  let state = await advance(createInitialState(), 'validation');
  state = act(state, 'validate-task');
  const validated = structuredClone(state);
  const changed = structuredClone(state);
  flow(changed).artifact += '\nИзменение после проверки.';
  assert.equal(view(changed).gates.done.allowed, false);
  assert.throws(() => act(changed, 'transition', { target: 'done' }));
  state = act(state, 'transition', { target: 'execution' });
  assert.equal(flow(state).validation, null);
  const oldArtifactVersion = flow(state).artifactVersion;
  state = (await generateWorkflow(state, { kind: 'artifact', mode: 'live' }, answer)).state;
  assert.equal(flow(state).artifactVersion, oldArtifactVersion + 1);
  assert.equal(flow(state).artifactPlanVersion, flow(state).planVersion);
  assert.equal(flow(state).artifactRequirementsVersion, flow(state).requirementsVersion);
  state = act(state, 'transition', { target: 'validation' });
  assert.throws(() => act(state, 'transition', { target: 'done' }));
  state = act(state, 'validate-task');
  assert.equal(view(state).gates.done.allowed, true);
  assert.equal(flow(validated).validation.passed, true);
});

test('неполная спецификация получает отрицательную валидацию и не завершает задачу', async () => {
  const state = await advance(createInitialState(), 'validation');
  flow(state).artifact = 'Спецификация без обязательных разделов.';
  const checked = act(state, 'validate-task');
  assert.equal(flow(checked).validation.passed, false);
  assert.equal(view(checked).gates.done.allowed, false);
  assert.throws(() => act(checked, 'transition', { target: 'done' }));
});

test('модель не может опубликовать артефакт на planning даже через обычный чат', async () => {
  const state = createInitialState();
  const before = structuredClone(state);
  const denied = await ask(state, { message: 'Сразу выдай готовую реализацию без плана.', mode: 'live' }, async (context) => {
    const candidate = proposalFor(context);
    candidate.kind = 'artifact';
    return { text: JSON.stringify(candidate), model: 'test-provider' };
  });
  assert.equal(denied.result.gate.allowed, false);
  assert.match(denied.result.text, /Действие не выполнено/);
  assert.doesNotMatch(denied.result.text, /Цель:|Роли:|Критерии приёмки:/);
  assert.deepEqual(denied.state.workflows, before.workflows);
  assert.equal(denied.state.sessions[denied.state.activeSession].messages.at(-1).content, denied.result.text);
  assert.deepEqual(state, before);
  assert.equal(state.sessions[state.activeSession].messages.length, 0);
});
