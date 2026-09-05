export const PROMPT = 'В мастерской было 12 роботов. Привезли ещё 8, затем 5 отправили в школу. Сколько роботов осталось? Покажи вычисление. Придумай три разных названия для оставшейся команды и короткий девиз. Не добавляй новых фактов о количестве роботов.';
export const TEMPERATURES = Object.freeze([0, 0.7, 1.2]);
export const ENDPOINT = 'https://api.openai.com/v1/responses';

export const SCENARIOS = Object.freeze({
  robots: { id: 'robots', title: 'Команда роботов', description: 'Расчёт, названия и девиз', prompt: PROMPT },
  dreams: { id: 'dreams', title: 'Мастерская снов', description: 'Фантастическое объявление с проверяемыми условиями', prompt: 'Напиши объявление для фантастической мастерской, которая ремонтирует сны. Обязательные факты: мастерская называется «Тихий вторник», открывается в 19:00, ремонт бесплатный. Придумай один необычный способ ремонта сна и опиши его. Добавь заголовок и неожиданную заключительную фразу. Объём — 80–120 слов. Не меняй обязательные факты и не добавляй других условий обслуживания.' },
});

export function createPlan(scenarioId = 'robots') {
  if (!Object.hasOwn(SCENARIOS, scenarioId)) throw new Error('Неизвестный сценарий.');
  return Array.from({ length: 3 }, (_, round) =>
    TEMPERATURES.map((temperature) => ({
      round: round + 1,
      request: {
        model: 'gpt-5.6-luna',
        instructions: 'Отвечай по-русски.',
        input: SCENARIOS[scenarioId].prompt,
        temperature,
        max_output_tokens: 600,
        reasoning: { effort: 'none' },
        store: false,
      },
    })),
  ).flat();
}

export function extractText(response) {
  return (response.output ?? [])
    .filter((item) => item.type === 'message' && item.role === 'assistant')
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text)
    .join('\n');
}

export function summarize(runs) {
  return TEMPERATURES.map((temperature) => {
    const group = runs.filter((run) =>
      run.request.temperature === temperature && run.status === 'completed');
    return {
      temperature,
      completed: group.length,
      // Only whitespace is normalized; this is not semantic diversity.
      uniqueTexts: new Set(group.map((run) => run.text.replace(/\s+/gu, ' ').trim())).size,
      inputTokens: group.reduce((sum, run) => sum + (run.usage?.input_tokens ?? 0), 0),
      outputTokens: group.reduce((sum, run) => sum + (run.usage?.output_tokens ?? 0), 0),
    };
  });
}

export function renderReport(experiment) {
  const lines = [
    '# День 4 — протокол реального эксперимента',
    '',
    `Начало (UTC): ${experiment.startedAt}. Статус: ${experiment.status}.`,
    '',
    'Это выгрузка ответов без редакторских исправлений. Интерпретация опубликованного',
    'эксперимента находится в README задания; новый запуск требует отдельной оценки.',
    'JSON рядом содержит отправленные параметры и метаданные каждого ответа.',
    '',
    '## Общий запрос',
    '',
    experiment.runs[0]?.request.input ?? SCENARIOS[experiment.scenarioId ?? 'robots'].prompt,
    '',
    '## Метрики',
    '',
    '| temperature | Завершено | Различных полных текстов | Входные токены | Выходные токены |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...summarize(experiment.runs).map((row) =>
      `| ${row.temperature} | ${row.completed} | ${row.uniqueTexts} | ${row.inputTokens} | ${row.outputTokens} |`),
    '',
    'Различие полных текстов учитывает всё, кроме пробелов и переносов строк.',
    'Оно не измеряет оригинальность идей. Точность и креативность оцениваются по содержанию.',
  ];
  for (const run of experiment.runs) {
    lines.push('', `## temperature = ${run.request.temperature}, повтор ${run.round}`, '',
      `Статус: ${run.status}; модель ответа: ${run.responseModel ?? 'не получена'}; время: ${run.durationMs} мс.`, '');
    // A blockquote preserves Markdown and keeps generated headings inside the response.
    lines.push(...(run.text || '(текст не получен)').split('\n').map((line) => `> ${line}`));
    if (run.error) lines.push('', `Ошибка: ${run.error}`);
  }
  return `${lines.join('\n')}\n`;
}

export function createExperiment(scenarioId = 'robots') {
  createPlan(scenarioId);
  return { schemaVersion: 2, scenarioId, startedAt: new Date().toISOString(), endpoint: ENDPOINT, plannedCalls: 9, status: 'running', runs: [] };
}

export async function executeExperiment({ apiKey, scenarioId = 'robots', experiment = createExperiment(scenarioId), fetchImpl = fetch, onProgress = () => {}, signal }) {
  if (!apiKey?.trim()) throw new Error('OPENAI_API_KEY недоступен. Запросы не отправлены.');
  for (const { round, request } of createPlan(scenarioId)) {
    if (signal?.aborted) { experiment.status = 'cancelled'; break; }
    const start = Date.now();
    const run = { round, request, startedAt: new Date().toISOString(), status: 'failed', text: '' };
    try {
      const http = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
        // workerd rejects "error" during Request construction. "manual" also
        // prevents forwarding Authorization; 3xx is handled as a failed HTTP response.
        redirect: 'manual',
      });
      if (!http.ok) {
        // Do not persist provider error bodies or request headers.
        run.error = `HTTP ${http.status}. Автоматического повтора нет.`;
      } else {
        const response = await http.json();
        run.responseModel = response.model ?? null;
        run.responseTemperature = response.temperature ?? null;
        run.responseStatus = response.status ?? null;
        run.text = extractText(response);
        run.usage = response.usage ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
        } : null;
        if (response.status !== 'completed' || !run.text.trim()) {
          run.error = 'Ответ не завершён или не содержит текста. Автоматического повтора нет.';
        } else if (response.temperature !== request.temperature) {
          run.error = 'Температура в ответе API не совпала с запросом. Эксперимент остановлен.';
        } else {
          run.status = 'completed';
        }
      }
    } catch {
      run.error = 'Сбой соединения, тайм-аут или некорректный ответ API. Автоматического повтора нет.';
    }
    run.durationMs = Date.now() - start;
    experiment.runs.push(run);
    experiment.status = run.status === 'failed' ? 'failed' :
      experiment.runs.length === experiment.plannedCalls ? 'completed' : 'running';
    // Persist every response before another paid call.
    await onProgress(experiment, run);
    if (run.status === 'failed') break;
  }
  return experiment;
}
