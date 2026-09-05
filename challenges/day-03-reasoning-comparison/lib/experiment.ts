export const ALLOWED_MODELS = [
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
] as const;

export type AllowedModel = (typeof ALLOWED_MODELS)[number];
export type MethodId = 'direct' | 'stepByStep' | 'metaPrompt' | 'experts';

export const PROBLEM = `На квадратной сетке 5 × 5 старт находится в клетке (1,1), а финиш — в клетке (5,5). За один ход можно перейти только на одну клетку вправо или на одну клетку вниз. Клетки (2,2), (3,4) и (4,2) заблокированы: заходить в них нельзя. Сколько существует различных путей от старта до финиша?`;

export const STEP_BY_STEP_PROMPT = `${PROBLEM}\n\nРешай пошагово.`;

export const META_PROMPT_REQUEST = `Составь эффективный промпт для решения приведённой ниже алгоритмической задачи. Промпт должен содержать само условие, просить дать проверяемое обоснование и точный итоговый ответ. Не решай задачу. Верни только готовый промпт без вводных слов и Markdown-ограждений.\n\n${PROBLEM}`;

export const EXPERTS_PROMPT = `${PROBLEM}\n\nТы — группа из трёх экспертов. Каждый решает задачу независимо и показывает краткое проверяемое обоснование:\n1. Аналитик строит математическую модель.\n2. Инженер предлагает алгоритм и проверяет вычисления.\n3. Критик ищет ошибки в рассуждениях и даёт собственное решение.\n\nЗаверши каждую секцию отдельной строкой строго в формате:\nОТВЕТ АНАЛИТИКА: <целое число>\nОТВЕТ ИНЖЕНЕРА: <целое число>\nОТВЕТ КРИТИКА: <целое число>\nПосле трёх секций дай общий вывод.`;

export const METHOD_META: Record<
  MethodId,
  { title: string; subtitle: string; calls: number }
> = {
  direct: {
    title: 'Прямой ответ',
    subtitle: 'Только условие задачи',
    calls: 1,
  },
  stepByStep: {
    title: 'Пошагово',
    subtitle: 'Добавлено «решай пошагово»',
    calls: 1,
  },
  metaPrompt: {
    title: 'Метапромпт',
    subtitle: 'Сначала создан решающий промпт',
    calls: 2,
  },
  experts: {
    title: 'Группа экспертов',
    subtitle: 'Аналитик · инженер · критик',
    calls: 1,
  },
};

const BLOCKED = new Set(['2-2', '3-4', '4-2']);

export function countReferencePaths(): number {
  const paths = Array.from({ length: 5 }, () => Array<number>(5).fill(0));
  paths[0][0] = 1;
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      if (BLOCKED.has(`${row + 1}-${column + 1}`)) {
        paths[row][column] = 0;
        continue;
      }
      if (row === 0 && column === 0) continue;
      paths[row][column] =
        (row > 0 ? paths[row - 1][column] : 0) +
        (column > 0 ? paths[row][column - 1] : 0);
    }
  }
  return paths[4][4];
}

export const REFERENCE_ANSWER = countReferencePaths();

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};
export type Assessment = {
  correct: boolean;
  correctCount: number;
  expectedCount: number;
  answers: Array<number | null>;
  note: string;
};

export type MethodResult = {
  id: MethodId;
  title: string;
  subtitle: string;
  prompt: string;
  generatedPrompt?: string;
  status: 'completed' | 'error';
  text?: string;
  error?: string;
  calls: number;
  durationMs: number;
  usage: Usage;
  assessment: Assessment;
};

export type ExperimentSummary = {
  answersDiffer: boolean;
  completedCount: number;
  correctMethodCount: number;
  bestMethodIds: MethodId[];
  conclusion: string;
};

export type ExperimentResponse = {
  model: AllowedModel;
  problem: string;
  expectedAnswer: number;
  results: MethodResult[];
  summary: ExperimentSummary;
};

function lastInteger(text: string): number | null {
  const matches = [
    ...text.matchAll(/(?<![\p{L}\p{N}])-?\d+(?![\p{L}\p{N}])/gu),
  ];
  if (matches.length === 0) return null;
  return Number(matches.at(-1)?.[0]);
}

function expertAnswer(text: string, role: string): number | null {
  const match = text.match(
    new RegExp(`ОТВЕТ\\s+${role}\\s*:\\s*(-?\\d+)`, 'iu'),
  );
  return match ? Number(match[1]) : null;
}

export function assessAnswer(id: MethodId, text: string): Assessment {
  const answers =
    id === 'experts'
      ? ['АНАЛИТИКА', 'ИНЖЕНЕРА', 'КРИТИКА'].map((role) =>
          expertAnswer(text, role),
        )
      : [lastInteger(text)];
  const correctCount = answers.filter(
    (answer) => answer === REFERENCE_ANSWER,
  ).length;
  const expectedCount = answers.length;
  const correct = correctCount === expectedCount;
  const note =
    id === 'experts'
      ? `${correctCount} из ${expectedCount} экспертов дали эталонный ответ ${REFERENCE_ANSWER}.`
      : answers[0] === null
        ? 'Не удалось выделить итоговое целое число.'
        : answers[0] === REFERENCE_ANSWER
          ? `Итог совпал с эталоном: ${REFERENCE_ANSWER}.`
          : `Получено ${answers[0]}, эталон — ${REFERENCE_ANSWER}.`;
  return { correct, correctCount, expectedCount, answers, note };
}

export function emptyAssessment(id: MethodId): Assessment {
  const expectedCount = id === 'experts' ? 3 : 1;
  return {
    correct: false,
    correctCount: 0,
    expectedCount,
    answers: Array<number | null>(expectedCount).fill(null),
    note: 'Ответ не получен.',
  };
}

export function summarize(results: MethodResult[]): ExperimentSummary {
  const completed = results.filter((result) => result.status === 'completed');
  const ratios = completed.map((result) => ({
    id: result.id,
    ratio: result.assessment.correctCount / result.assessment.expectedCount,
  }));
  const bestRatio = ratios.length
    ? Math.max(...ratios.map((item) => item.ratio))
    : -1;
  const bestMethodIds = ratios
    .filter((item) => item.ratio === bestRatio)
    .map((item) => item.id);
  const normalized = new Set(
    completed.map((result) =>
      result.text?.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru'),
    ),
  );
  const correctMethodCount = completed.filter(
    (result) => result.assessment.correct,
  ).length;

  let conclusion = 'Нет завершённых решений для сравнения.';
  if (completed.length > 0 && correctMethodCount === completed.length) {
    conclusion =
      bestMethodIds.length === 1
        ? `${METHOD_META[bestMethodIds[0]].title} дал наиболее точный результат.`
        : `Все ${completed.length} завершённых способа одинаково точны: итог совпал с эталоном.`;
  } else if (bestMethodIds.length === 1) {
    conclusion = `${METHOD_META[bestMethodIds[0]].title} дал наиболее точный результат в этом запуске.`;
  } else if (bestMethodIds.length > 1) {
    conclusion = `Наиболее точный результат разделили: ${bestMethodIds.map((id) => METHOD_META[id].title).join(', ')}.`;
  }

  return {
    answersDiffer: normalized.size > 1,
    completedCount: completed.length,
    correctMethodCount,
    bestMethodIds,
    conclusion,
  };
}

function fenced(text: string): string {
  const longest = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

export function buildMarkdownReport(data: ExperimentResponse): string {
  const sections = data.results.map((result, index) => {
    const generated = result.generatedPrompt
      ? `\n\n### Сгенерированный промпт\n\n${fenced(result.generatedPrompt)}`
      : '';
    const body =
      result.status === 'completed'
        ? fenced(result.text ?? '')
        : `Ошибка: ${result.error}`;
    return `## ${index + 1}. ${result.title}\n\n${result.subtitle}\n\n### Использованный промпт\n\n${fenced(result.prompt)}${generated}\n\n### Решение\n\n${body}\n\n**Проверка:** ${result.assessment.note}\n\n**Метрики:** ${result.calls} API-вызов(а), ${result.usage.inputTokens} входных и ${result.usage.outputTokens} выходных токенов, ${result.durationMs} мс.`;
  });
  return `# День 3 — разные способы рассуждения\n\n**Модель:** \`${data.model}\`  \n**Эталонный ответ:** ${data.expectedAnswer}\n\n## Задача\n\n${data.problem}\n\n${sections.join('\n\n---\n\n')}\n\n## Сравнение\n\n- Тексты ответов ${data.summary.answersDiffer ? 'различаются' : 'совпадают'}.\n- Полностью верный результат: ${data.summary.correctMethodCount} из ${data.summary.completedCount} завершённых способов.\n- ${data.summary.conclusion}\n`;
}
