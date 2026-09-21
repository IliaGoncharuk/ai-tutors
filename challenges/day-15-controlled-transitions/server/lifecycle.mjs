import { createHash } from 'node:crypto';
import { InputError } from './core.mjs';
import { validateProposal } from './invariants.mjs';

const next = { planning: ['execution'], execution: ['validation'], validation: ['done', 'execution'], done: [] };
export const artifactHash = flow => createHash('sha256').update(flow.artifact).digest('hex');
export function approved(flow) {
  return Boolean(flow.plan) && flow.planRequirementsVersion === flow.requirementsVersion && flow.approvedPlanVersion === flow.planVersion && flow.approvedRequirementsVersion === flow.requirementsVersion;
}
export function currentArtifact(flow) {
  return approved(flow) && Boolean(flow.artifact) && flow.artifactPlanVersion === flow.planVersion && flow.artifactRequirementsVersion === flow.requirementsVersion;
}
export function materialGate(flow, kind) {
  if (flow.paused) return { allowed: false, reason: 'Задача на паузе. Сначала продолжите её.' };
  if (kind === 'artifact' && (flow.stage !== 'execution' || !approved(flow))) return { allowed: false, reason: 'Нельзя выполнять задачу до утверждения актуального плана и перехода к выполнению.' };
  if (kind === 'plan' && flow.stage !== 'planning') return { allowed: false, reason: 'Для нового плана сначала нажмите «Пересмотреть план».' };
  if (kind === 'review' && (flow.stage !== 'validation' || !currentArtifact(flow))) return { allowed: false, reason: 'Обзор доступен на этапе проверки для актуальной спецификации.' };
  return { allowed: true, reason: 'Действие допустимо на текущем этапе.' };
}
export function transitionGate(state, target) {
  const flow = state.workflows[state.activeTask], rules = state.invariants[state.activeTask];
  if (flow.paused) return { allowed: false, reason: 'Задача на паузе. Сначала продолжите её.' };
  if (!next[flow.stage]?.includes(target)) return { allowed: false, reason: `Переход ${flow.stage} → ${target} не разрешён графом этапов.` };
  if (target === 'execution' && !approved(flow)) return { allowed: false, reason: 'Сначала создайте и утвердите актуальную версию плана для текущих требований.' };
  if (target === 'validation' && !currentArtifact(flow)) return { allowed: false, reason: 'Сначала подготовьте спецификацию по утверждённому плану.' };
  if (target === 'done') {
    const v = flow.validation;
    if (!currentArtifact(flow) || !v?.passed || v.planVersion !== flow.planVersion || v.artifactVersion !== flow.artifactVersion || v.requirementsVersion !== flow.requirementsVersion || v.invariantVersion !== rules.version || v.artifactHash !== artifactHash(flow)) return { allowed: false, reason: 'Для завершения нужна успешная локальная проверка актуальной спецификации. Обзор модели её не заменяет.' };
  }
  return { allowed: true, reason: 'Условия перехода выполнены.' };
}
export function invalidateRequirements(state) {
  const flow = state.workflows[state.activeTask];
  flow.requirementsVersion += 1; flow.approvedPlanVersion = null; flow.approvedRequirementsVersion = null; flow.validation = null; flow.review = null;
  flow.stage = 'planning'; flow.step = 'Обновить план по изменённым требованиям'; flow.expectedAction = 'Создать и утвердить новую версию плана';
}
export function runValidation(state) {
  const flow = state.workflows[state.activeTask], rules = state.invariants[state.activeTask];
  if (flow.stage !== 'validation' || flow.paused) throw new InputError('Локальная проверка доступна на активном этапе validation.', 409);
  let policy; try { policy = validateProposal(flow.artifactProposal, rules); } catch { policy = { allowed: false }; }
  const checks = [
    { name: 'План утверждён', pass: approved(flow), detail: `План v${flow.planVersion}, требования v${flow.requirementsVersion}` },
    { name: 'Спецификация актуальна', pass: currentArtifact(flow), detail: 'Результат создан для текущих версий плана и требований.' },
    { name: 'Есть все разделы', pass: ['Цель:', 'Роли:', 'Архитектура:', 'Бронирование:', 'Отмена:', 'Критерии приёмки:'].every(title => flow.artifact.includes(title)), detail: 'Проверены цель, роли, архитектура, бронирование, отмена и критерии приёмки.' },
    { name: 'Инварианты соблюдены', pass: policy.allowed && flow.artifactInvariantVersion === rules.version, detail: 'Проверены шесть параметров структурированного проекта.' },
  ];
  return { passed: checks.every(x => x.pass), checks, planVersion: flow.planVersion, artifactVersion: flow.artifactVersion, requirementsVersion: flow.requirementsVersion,
    invariantVersion: rules.version, artifactHash: artifactHash(flow), at: new Date().toISOString() };
}
