import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assessText, evaluatePlan, REFERENCE, summarizeAssessments } from '../assessment.mjs';
import { MODELS, TASKS } from '../core.mjs';
import { limitCorrection, finalChoice } from './fixtures/final-corrections.mjs';

const saved = JSON.parse(await readFile(new URL('../results/2026-09-05/results.json', import.meta.url), 'utf8'));
const reviews = JSON.parse(await readFile(new URL('../results/2026-09-05/review.json', import.meta.url), 'utf8'));

for (const [name, answer, selected, points] of [
  ['correction after explaining the time limit', limitCorrection, ['C', 'D', 'E', 'F'], 28],
  ['Sol final choice after rejecting earlier candidates', finalChoice, ['C', 'E', 'F', 'G'], 29],
]) for (const [format, text] of [
  ['multiline', answer],
  ['copied as one line', answer.replace(/\s+/gu, ' ')],
  ['Windows newlines', answer.replace(/\n/gu, '\r\n')],
]) test(`user regression: ${name}, ${format}`, () => {
  const result = assessText(text);
  assert.deepEqual(result.selected, selected);
  assert.deepEqual(result.order, selected);
  assert.equal(result.reportedHours, 8);
  assert.equal(result.reportedPoints, points);
  assert.equal(result.hours, 8);
  assert.equal(result.points, points);
  assert.equal(result.feasible, true);
  assert.equal(result.optimal, points === 29);
  assert.equal(result.orderValid, true);
  assert.equal(result.hoursCorrect, true);
  assert.equal(result.pointsCorrect, true);
  assert.ok(!result.evidence.includes('Почему лучше нельзя'));
});

for (const run of saved.runs) test(`automatic extraction agrees with the independent final-answer review: ${run.id}`, () => {
  const result = assessText(run.text), expected = reviews[run.id];
  assert.deepEqual([...result.selected].sort(), [...expected.selected].sort());
  assert.deepEqual(result.order, expected.order);
  assert.equal(result.reportedHours, expected.reportedHours);
  assert.equal(result.reportedPoints, expected.reportedPoints);
  assert.equal(result.hoursCorrect, true); assert.equal(result.pointsCorrect, true);
  assert.equal(result.orderValid, true); assert.equal(result.feasible, true);
  assert.equal(result.optimal, expected.reportedPoints === 29);
  assert.ok(result.evidence);
});

const cases = [
  ['headings on separate lines and equations', '## Выбранные задачи:\n\n**C, E, F, G**\nПорядок выполнения:\nE → F → C → G\nСуммарное время:\n2 + 3 + 1 + 2 = 8 часов\nСуммарная польза:\n6 + 11 + 4 + 8 = 29 баллов', { optimal: true, orderValid: true, hoursCorrect: true, pointsCorrect: true }],
  ['numbered execution list', 'Итоговый план:\n1. E — сценарий\n2. F — съёмка\n3. C — стойка\n4. G — викторина\nИтого: 8 часов, 29 баллов.', { optimal: true, orderValid: true, hoursCorrect: true, pointsCorrect: true }],
  ['bullet selection with separate numbered order', 'Задачи:\n- C — стойка\n- E — сценарий\n- F — видео\n- G — викторина\nПорядок:\n1. E\n2. F\n3. C\n4. G\nВремя: 8\nБаллы: 29', { optimal: true, orderValid: true, hoursCorrect: true, pointsCorrect: true }],
  ['a valid final answer is not rejected because the proof says other plans fail', 'Оптимальный набор: E, F, C, G\nПорядок: E → F → C → G\nИтого: 8 часов, 29 баллов.\nОбоснование:\nДругой набор превышает лимит. Исправлять выбранный план не нужно.', { optimal: true, hoursCorrect: true }],
  ['final correction can be worse than an earlier answer', 'Оптимальный набор: E → F → C → G\nИтого: 8 часов, 29 баллов.\nИсправленный ответ: A → B → C → H\nИтого: 7 часов, 23 балла.', { optimal: false, points: 23, hours: 7, hoursCorrect: true }],
  ['final choice keeps a worse answer and its incorrect claimed sums', 'Оптимальный набор: C → E → F → G\nИтого: 8 часов, 29 баллов.\nИтоговый выбор: A → B → C → H\nСуммарно: 8 часов, 24 балла.', { optimal: false, points: 23, hours: 7, hoursCorrect: false, pointsCorrect: false }],
  ['conclusion after a longer explanation', 'Выбранные задачи: C → D → E → F → H\nИтого: 9 часов, 31 балл.\nЭтот план занимает лишний час, следовательно, допустимый набор: C → D → E → F\nИтого: 8 часов, 28 баллов.', { feasible: true, optimal: false, points: 28, orderValid: true, hoursCorrect: true, pointsCorrect: true }],
  ['hypothetical final choice cannot overwrite an explicit answer', 'Выбранные задачи: A → B → C → H\nИтого: 7 часов, 23 балла.\nЕсли снять ограничение, поэтому итоговый выбор: C → E → F → G.', { optimal: false, points: 23, hoursCorrect: true, pointsCorrect: true }],
  ['wrong sum is not silently recomputed for the model', 'Выбранные задачи: E, F, C, G\nПорядок: E → F → C → G\nВремя: 2 + 3 + 1 + 2 = 9 часов\nБаллы: 6 + 11 + 4 + 8 = 28 баллов', { optimal: true, hoursCorrect: false, pointsCorrect: false }],
  ['wrong order is not sorted into a valid one', 'Оптимальный набор: C, E, F, G\nПорядок: F → E → C → G\nИтого: 8 часов, 29 баллов.', { optimal: true, orderValid: false }],
  ['missing dependency', 'Выбранные задачи: B, C, G\nПорядок: B → C → G\nИтого: 6 часов, 22 балла.', { feasible: false, optimal: false }],
  ['exclusive tasks', 'Выбранные задачи: C, D, G\nПорядок: C → D → G\nИтого: 5 часов, 19 баллов.', { feasible: false, optimal: false }],
  ['over budget', 'Выбранные задачи: C, E, F, G, H\nПорядок: E → F → C → G → H\nИтого: 9 часов, 32 балла.', { feasible: false, optimal: false }],
  ['duplicates survive extraction', 'Выбранные задачи: E, F, C, G, G\nПорядок: E → F → C → G → G', { feasible: false, optimal: false }],
  ['unknown task ID is invalid, not silently discarded', 'Выбранные задачи: E, F, C, G, X\nПорядок: E → F → C → G → X', { feasible: false, optimal: false }],
  ['missing totals stay unknown', 'Выбранные задачи: C, E, F, G\nПорядок: E → F → C → G', { optimal: true, hoursCorrect: null, pointsCorrect: null }],
  ['comma-separated selection does not assert execution order', 'Выбранные задачи: C, E, F, G\nИтого: 8 часов, 29 баллов.', { optimal: true, orderValid: null }],
  ['proof metrics do not fill missing totals', 'Выбранные задачи: C, E, F, G\nОбоснование:\nИтого: 8 часов, 29 баллов.', { hoursCorrect: null, pointsCorrect: null }],
  ['expression without a stated result is not a total', 'Выбранные задачи: C, E, F, G\nВремя: 1 + 2 + 3 + 2\nБаллы: 4 + 6 + 11 + 8', { hoursCorrect: null, pointsCorrect: null }],
  ['conflicting totals stay unknown', 'Выбранные задачи: C, E, F, G\nВремя: 8 часов\nБаллы: 29\nИтого: 7 часов, 28 баллов.', { hoursCorrect: null, pointsCorrect: null }],
  ['conflicting totals copied without line breaks stay unknown', 'Итоговый выбор: C, E, F, G Время: 8 часов Баллы: 29 Итого: 7 часов, 28 баллов.', { optimal: true, hoursCorrect: null, pointsCorrect: null }],
  ['inline proof metrics do not fill missing totals', 'Итоговый выбор: C → E → F → G. Почему лучше нельзя: Итого: 8 часов, 29 баллов.', { optimal: true, hoursCorrect: null, pointsCorrect: null }],
  ['conflicting orders stay unknown', 'Выбранные задачи: C, E, F, G\nПорядок: E → F → C → G\nПорядок: F → E → C → G', { orderValid: null }],
  ['Cyrillic lookalike codes in an explicit list', 'Выбранные задачи: С, Е, F, G\nПорядок: Е → F → С → G\nИтого: 8 часов, 29 баллов.', { optimal: true, orderValid: true }],
];
for (const [name, text, expected] of cases) test(name, () => {
  const result = assessText(text);
  for (const [field, value] of Object.entries(expected)) assert.equal(result[field], value, field);
});

for (const [name, text] of [
  ['hypothetical mention', 'Если выбрать E, F, C, G, получится 29 баллов.'],
  ['alternative inside a proof', 'Обоснование: если взять оптимальный набор: E, F, C, G, можно получить 29.'],
  ['hypothetical conclusion after a comma', 'Если снять ограничение, поэтому итоговый выбор: C → E → F → G.'],
  ['example conclusion after a comma', 'Например, поэтому окончательный выбор: C → E → F → G.'],
  ['qualified final choice with unresolved alternatives', 'Итоговый выбор: C, E, F, G или A, B, C, G.'],
  ['qualified final choice without task codes', 'Оптимальный набор: C → E → F → G\nИтоговый выбор: решение пока не найдено.'],
  ['withdrawn final plan', 'Выбранные задачи: E → F → C → G\nЭтот набор не оптимален. Не могу дать окончательный ответ.'],
  ['different final assertions without a correction', 'Выбранные задачи: E, F, C, G\nОптимальный набор: A, B, C, G'],
  ['different assertions on one line', 'Выбранные задачи: E, F, C, G. Выбранные задачи: A, B, C, G.'],
  ['unresolved choice', 'Выбранные задачи: E, F, C, G или A, B, C, G.'],
  ['final label without a plan', 'Выбранные задачи: E, F, C, G\nИсправленный ответ: нужно подумать ещё.'],
]) test(`does not turn ambiguous text into a passing plan: ${name}`, () => {
  const result = assessText(text);
  assert.equal(result.selected, null); assert.equal(result.optimal, null); assert.ok(result.extractionNote);
});

test('unassessed responses are not counted as failed model answers', () => {
  assert.deepEqual(summarizeAssessments([evaluatePlan(['C', 'E', 'F', 'G']), evaluatePlan(['A', 'B', 'C', 'G']), evaluatePlan(null)]),
    { total: 3, assessed: 2, optimal: 1, unknown: 1, totalPoints: 57 });
  assert.deepEqual(summarizeAssessments([evaluatePlan(null), evaluatePlan(null)]),
    { total: 2, assessed: 0, optimal: 0, unknown: 2, totalPoints: null });
});

test('31 raw points from a nine-hour plan earn zero rather than 31 out of 29', () => {
  const result = assessText('Итоговый выбор: C → D → E → F → H\nИтого: 9 часов, 31 балл.');
  assert.equal(result.points, 31);
  assert.equal(result.reportedPoints, 31);
  assert.equal(result.hours, 9);
  assert.equal(result.feasible, false);
  assert.equal(result.awardedPoints, 0);
});

test('awarded points respect the reference maximum across all task subsets', () => {
  for (let mask = 1; mask < 2 ** TASKS.length; mask++) {
    const selected = TASKS.filter((_, index) => mask & (1 << index)).map(task => task.id);
    const result = evaluatePlan(selected);
    assert.ok(result.awardedPoints >= 0 && result.awardedPoints <= REFERENCE.points, selected.join(','));
    assert.equal(result.awardedPoints, result.feasible ? result.points : 0);
  }
  assert.equal(evaluatePlan(['C', 'C']).awardedPoints, 0);
  assert.equal(evaluatePlan(['C', 'X']).awardedPoints, 0);
  assert.equal(evaluatePlan(null).awardedPoints, null);
});

test('awarded benefit remains separate from reported arithmetic and execution order', () => {
  const result = evaluatePlan(['C', 'E', 'F', 'G'], ['F', 'E', 'C', 'G'], 9, 31);
  assert.equal(result.awardedPoints, 29);
  assert.equal(result.orderValid, false);
  assert.equal(result.hoursCorrect, false);
  assert.equal(result.pointsCorrect, false);
});

test('three-round totals include suboptimal plans, reject infeasible plans, and keep unknown distinct', () => {
  assert.deepEqual(MODELS.map(model => summarizeAssessments(saved.runs
    .filter(run => run.request.model === model.id).map(run => assessText(run.text))).totalPoints), [79, 85, 87]);
  const invalid = evaluatePlan(['C', 'D', 'E', 'F', 'H']);
  assert.equal(summarizeAssessments([evaluatePlan(['C', 'E', 'F', 'G']), invalid, evaluatePlan(['A', 'B', 'C', 'G'])]).totalPoints, 57);
  assert.deepEqual(summarizeAssessments([invalid, invalid, invalid]),
    { total: 3, assessed: 3, optimal: 0, unknown: 0, totalPoints: 0 });
  assert.deepEqual(summarizeAssessments([]),
    { total: 0, assessed: 0, optimal: 0, unknown: 0, totalPoints: null });
  assert.deepEqual(summarizeAssessments([evaluatePlan(['C', 'E', 'F', 'G'])]),
    { total: 1, assessed: 1, optimal: 1, unknown: 0, totalPoints: 29 });
});
