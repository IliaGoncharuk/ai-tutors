import { InputError, text } from './core.mjs';
import { transitionGate, materialGate, runValidation } from './lifecycle.mjs';

export const STAGES = ['planning', 'execution', 'validation', 'done'];
export const NEXT = { planning: ['execution'], execution: ['validation'], validation: ['done', 'execution'], done: [] };
export const EXPECTED = { planning: 'Подготовить план проекта', execution: 'Подготовить спецификацию сервиса', validation: 'Проверить спецификацию по требованиям', done: 'Задача завершена' };
export function initialWorkflow() {
  return { stage: 'planning', paused: false, step: 'Уточнить требования', expectedAction: EXPECTED.planning,
    plan: '', planVersion: 0, artifact: '', artifactVersion: 0, review: null,
    requirementsVersion: 0, planRequirementsVersion: null, approvedPlanVersion: null, approvedRequirementsVersion: null,
    artifactPlanVersion: null, artifactRequirementsVersion: null, artifactInvariantVersion: null, validation: null };
}
export function ensureWorkflows(state) {
  state.workflows ??= {};
  for (const task of Object.values(state.tasks)) state.workflows[task.id] ??= initialWorkflow();
}
export function workflowAction(state, action) {
  const types = ['pause-task', 'resume-task', 'transition', 'set-step', 'set-plan', 'set-artifact', 'approve-plan', 'validate-task', 'revise-plan'];
  if (!types.includes(action.type)) return null;
  const flow = state.workflows[state.activeTask];
  if (action.type === 'resume-task') { flow.paused = false; return `Продолжение с этапа ${flow.stage}: ${flow.step}`; }
  if (flow.paused) throw new InputError('Задача на паузе. Сначала продолжите её.', 409);
  switch (action.type) {
    case 'approve-plan': {
      if (flow.stage !== 'planning' || !flow.plan || flow.planRequirementsVersion !== flow.requirementsVersion || action.planVersion !== flow.planVersion) throw new InputError('Утвердить можно только текущую версию плана на этапе planning. При изменении требований сначала создайте новый план.', 409);
      flow.approvedPlanVersion = flow.planVersion; flow.approvedRequirementsVersion = flow.requirementsVersion;
      return `Пользователь утвердил план v${flow.planVersion} для требований v${flow.requirementsVersion}`;
    }
    case 'validate-task': flow.validation = runValidation(state); return flow.validation.passed ? 'Локальная проверка спецификации пройдена' : 'Локальная проверка нашла несоответствия';
    case 'revise-plan': {
      flow.stage = 'planning'; flow.approvedPlanVersion = null; flow.approvedRequirementsVersion = null; flow.planRequirementsVersion = null; flow.validation = null; flow.review = null;
      flow.step = 'Пересмотреть план'; flow.expectedAction = 'Создать и утвердить новую версию плана'; return 'План отправлен на пересмотр';
    }
    case 'pause-task': flow.paused = true; return `Пауза: ${flow.stage}, ${flow.step}`;
    case 'transition': {
      const gate = transitionGate(state, action.target);
      if (!gate.allowed) throw new InputError(gate.reason, 409);
      if (action.target === 'execution') flow.validation = null;
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
  const gate = materialGate(flow, kind); if (!gate.allowed) throw new InputError(gate.reason, 409);
  const prompts = {
    plan: 'Составь краткий пошаговый план подготовки ТЗ приложения записи к репетиторам по имеющимся требованиям. Отдели открытые вопросы от принятых фактов.',
    artifact: 'Подготовь короткую спецификацию приложения записи к репетиторам по сохранённому плану и требованиям. Разделы: цель, роли, бронирование, отмена, критерии приёмки. Не выдавай неподтверждённые условия за утверждённые.',
    review: 'Проверь сохранённую спецификацию: перечисли найденные проблемы, отсутствующие требования и конкретные проверки. Не называй чтение спецификации выполнением программных тестов.',
  };
  return prompts[kind];
}
