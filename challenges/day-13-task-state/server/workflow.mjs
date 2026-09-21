import { InputError, text } from './core.mjs';

export const STAGES = ['planning', 'execution', 'validation', 'done'];
export const NEXT = { planning: ['execution'], execution: ['validation'], validation: ['done', 'execution'], done: [] };
export const EXPECTED = { planning: 'Подготовить план проекта', execution: 'Подготовить спецификацию сервиса', validation: 'Проверить спецификацию по требованиям', done: 'Задача завершена' };
export function initialWorkflow() {
  return { stage: 'planning', paused: false, step: 'Уточнить требования', expectedAction: EXPECTED.planning,
    plan: '', planVersion: 0, artifact: '', artifactVersion: 0, review: null };
}
export function ensureWorkflows(state) {
  state.workflows ??= {};
  for (const task of Object.values(state.tasks)) state.workflows[task.id] ??= initialWorkflow();
}
export function workflowAction(state, action) {
  const types = ['pause-task', 'resume-task', 'transition', 'set-step', 'set-plan', 'set-artifact'];
  if (!types.includes(action.type)) return null;
  const flow = state.workflows[state.activeTask];
  if (action.type === 'resume-task') { flow.paused = false; return `Продолжение с этапа ${flow.stage}: ${flow.step}`; }
  if (flow.paused) throw new InputError('Задача на паузе. Сначала продолжите её.', 409);
  switch (action.type) {
    case 'pause-task': flow.paused = true; return `Пауза: ${flow.stage}, ${flow.step}`;
    case 'transition': {
      if (!NEXT[flow.stage]?.includes(action.target)) throw new InputError(`Переход ${flow.stage} → ${action.target} не разрешён.`, 409);
      flow.stage = action.target; flow.step = EXPECTED[flow.stage]; flow.expectedAction = EXPECTED[flow.stage];
      return `Этап: ${flow.stage}`;
    }
    case 'set-step': flow.step = text(action.step, 'Текущий шаг', 300); flow.expectedAction = text(action.expectedAction, 'Ожидаемое действие', 500); return 'Текущий шаг сохранён';
    case 'set-plan': flow.plan = text(action.value, 'План', 12000); flow.planVersion += 1; flow.review = null; return `План версии ${flow.planVersion} сохранён`;
    case 'set-artifact': flow.artifact = text(action.value, 'Спецификация', 16000); flow.artifactVersion += 1; flow.review = null; return `Спецификация версии ${flow.artifactVersion} сохранена`;
  }
}
export function assertRunning(state) {
  if (state.workflows[state.activeTask].paused) throw new InputError('Задача на паузе. Продолжите её с сохранённого шага.', 409);
}
export function workflowPrompt(state, kind) {
  assertRunning(state);
  const required = { plan: 'planning', artifact: 'execution', review: 'validation' };
  const flow = state.workflows[state.activeTask];
  if (!Object.hasOwn(required, kind)) throw new InputError('Неизвестный результат этапа.');
  if (flow.stage !== required[kind]) throw new InputError(`Действие ${kind} доступно на этапе ${required[kind]}, сейчас ${flow.stage}.`, 409);
  const prompts = {
    plan: 'Составь краткий пошаговый план подготовки ТЗ приложения записи к репетиторам по имеющимся требованиям. Отдели открытые вопросы от принятых фактов.',
    artifact: 'Подготовь короткую спецификацию приложения записи к репетиторам по сохранённому плану и требованиям. Разделы: цель, роли, бронирование, отмена, критерии приёмки. Не выдавай неподтверждённые условия за утверждённые.',
    review: 'Проверь сохранённую спецификацию: перечисли найденные проблемы, отсутствующие требования и конкретные проверки. Не называй чтение спецификации выполнением программных тестов.',
  };
  return prompts[kind];
}
