import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPERTS_PROMPT,
  META_PROMPT_REQUEST,
  PROBLEM,
  REFERENCE_ANSWER,
  STEP_BY_STEP_PROMPT,
  assessAnswer,
  buildMarkdownReport,
  countReferencePaths,
  summarize,
  type ExperimentResponse,
  type MethodId,
  type MethodResult,
} from '../lib/experiment.ts';

void test('эталон задачи независимо вычисляется динамическим программированием', () => {
  assert.equal(countReferencePaths(), 10);
  assert.equal(REFERENCE_ANSWER, 10);
});

void test('четыре стратегии действительно используют разные промпты', () => {
  assert.equal(STEP_BY_STEP_PROMPT, `${PROBLEM}\n\nРешай пошагово.`);
  assert.match(META_PROMPT_REQUEST, /Не решай задачу/u);
  assert.match(EXPERTS_PROMPT, /Аналитик/u);
  assert.match(EXPERTS_PROMPT, /Инженер/u);
  assert.match(EXPERTS_PROMPT, /Критик/u);
  assert.equal(
    new Set([PROBLEM, STEP_BY_STEP_PROMPT, META_PROMPT_REQUEST, EXPERTS_PROMPT])
      .size,
    4,
  );
});

void test('обычный ответ оценивается по последнему целому числу', () => {
  assert.equal(
    assessAnswer('direct', 'После вычислений получаем 10.').correct,
    true,
  );
  assert.equal(
    assessAnswer('direct', 'В условии есть 5 и 5, но ответ 9.').correct,
    false,
  );
});

void test('каждый участник группы экспертов проверяется отдельно', () => {
  const assessment = assessAnswer(
    'experts',
    'ОТВЕТ АНАЛИТИКА: 10\nОТВЕТ ИНЖЕНЕРА: 10\nОТВЕТ КРИТИКА: 9',
  );
  assert.deepEqual(assessment.answers, [10, 10, 9]);
  assert.equal(assessment.correctCount, 2);
  assert.equal(assessment.correct, false);
});

function result(id: MethodId, text: string): MethodResult {
  return {
    id,
    title: id,
    subtitle: id,
    prompt: PROBLEM,
    status: 'completed',
    text,
    calls: id === 'metaPrompt' ? 2 : 1,
    durationMs: 100,
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    assessment: assessAnswer(id, text),
  };
}

void test('сводка допускает ничью и замечает различия текста', () => {
  const results = [
    result('direct', 'Итог: 10'),
    result('stepByStep', 'Шаги вычисления. Ответ: 10'),
  ];
  const summary = summarize(results);
  assert.equal(summary.answersDiffer, true);
  assert.deepEqual(summary.bestMethodIds, ['direct', 'stepByStep']);
  assert.match(summary.conclusion, /одинаково точны/u);
});

void test('Markdown-отчёт содержит решения и сравнение', () => {
  const results = [result('direct', 'Итог: 10')];
  const data: ExperimentResponse = {
    model: 'gpt-5.6-luna',
    problem: PROBLEM,
    expectedAnswer: 10,
    results,
    summary: summarize(results),
  };
  const report = buildMarkdownReport(data);
  assert.match(report, /День 3/u);
  assert.match(report, /Прямой ответ/u);
  assert.match(report, /Итог: 10/u);
  assert.match(report, /Сравнение/u);
});
