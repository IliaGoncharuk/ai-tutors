export const TASKS = Object.freeze([
  { id: 'A', title: 'Настроить оборудование', hours: 2, points: 6, requires: [] },
  { id: 'B', title: 'Подготовить демонстрацию робота', hours: 3, points: 10, requires: ['A'] },
  { id: 'C', title: 'Подготовить стойку регистрации', hours: 1, points: 4, requires: [] },
  { id: 'D', title: 'Провести экскурсию', hours: 2, points: 7, requires: ['C'] },
  { id: 'E', title: 'Написать сценарий видео', hours: 2, points: 6, requires: [] },
  { id: 'F', title: 'Снять видео', hours: 3, points: 11, requires: ['E'] },
  { id: 'G', title: 'Провести викторину', hours: 2, points: 8, requires: [] },
  { id: 'H', title: 'Подготовить памятку', hours: 1, points: 3, requires: [] },
]);

export const PROMPT = `Ты организатор научного фестиваля. У тебя 8 часов. Выбери задачи, чтобы получить максимальное количество баллов пользы.

Каждую задачу можно выполнить только целиком и один раз. Работаешь один, задачи выполняются последовательно. Баллы выбранных задач складываются.

| Код | Задача | Часы | Баллы | Условие |
|---|---|---:|---:|---|
${TASKS.map(t => `| ${t.id} | ${t.title} | ${t.hours} | ${t.points} | ${t.requires.length ? `После ${t.requires[0]}` : t.id === 'G' ? 'Нельзя совмещать с D' : '—'} |`).join('\n')}

Зависимости тоже занимают время и приносят указанные баллы. Экскурсия D и викторина G — альтернативы: выбрать обе нельзя. Других ограничений нет.

Укажи выбранные задачи, допустимый порядок выполнения, суммарное время и баллы. Кратко обоснуй, почему более выгодного допустимого набора нет. Ответ — до 180 слов.`;

export const MODELS = Object.freeze([
  { id: 'gpt-5.6-luna', name: 'Luna', tier: 'Экономичная', input: 0.20, cached: 0.02, output: 1.20 },
  { id: 'gpt-5.6-terra', name: 'Terra', tier: 'Средняя', input: 2, cached: 0.20, output: 12 },
  { id: 'gpt-5.6-sol', name: 'Sol', tier: 'Сильная', input: 4, cached: 0.40, output: 20 },
]);
export const PRICING_DATE = '2026-09-05';
export const BUDGET_USD = 0.20;
export const ENDPOINT = 'https://api.openai.com/v1/responses';

export function createPlan() {
  return Array.from({ length: 3 }, (_, round) => Array.from({ length: 3 }, (_, slot) => ({
    round: round + 1,
    request: {
      model: MODELS[(round + slot) % 3].id,
      instructions: 'Отвечай по-русски.', input: PROMPT,
      temperature: 0, reasoning: { effort: 'none' },
      max_output_tokens: 1200, store: false, service_tier: 'default',
    },
  }))).flat();
}

// A deliberately loose token allowance: UTF-8 bytes of the entire serialized
// request plus 256 tokens for API framing. Reserve the cache-write premium too.
// This is an estimate at the dated tariff, not a provider-side billing limit.
export function reserveCost(request) {
  const model = MODELS.find(m => m.id === request.model);
  const inputAllowance = new TextEncoder().encode(JSON.stringify(request)).length + 256;
  return (inputAllowance * model.input * 1.25 + request.max_output_tokens * model.output) / 1e6;
}

export function normalizeUsage(raw) {
  if (!raw) return null;
  const usage = {
    input_tokens: raw.input_tokens, output_tokens: raw.output_tokens, total_tokens: raw.total_tokens,
    cached_tokens: raw.input_tokens_details?.cached_tokens ?? 0,
    cache_write_tokens: raw.input_tokens_details?.cache_write_tokens ?? 0,
    reasoning_tokens: raw.output_tokens_details?.reasoning_tokens ?? 0,
  };
  if (Object.values(usage).some(n => !Number.isSafeInteger(n) || n < 0) ||
      usage.total_tokens !== usage.input_tokens + usage.output_tokens ||
      usage.cached_tokens + usage.cache_write_tokens > usage.input_tokens ||
      usage.reasoning_tokens > usage.output_tokens) return null;
  return usage;
}

export function calculateCost(modelId, usage) {
  const m = MODELS.find(model => model.id === modelId);
  if (!m || !usage) return null;
  return ((usage.input_tokens - usage.cached_tokens - usage.cache_write_tokens) * m.input +
    usage.cached_tokens * m.cached + usage.cache_write_tokens * m.input * 1.25 +
    usage.output_tokens * m.output) / 1e6;
}

export function createExperiment() {
  return {
    schemaVersion: 1, startedAt: new Date().toISOString(), endpoint: ENDPOINT,
    pricingDate: PRICING_DATE, pricing: MODELS.map(m => ({ ...m })),
    budgetUsd: BUDGET_USD, reservedCostUsd: createPlan().reduce((sum, p) => sum + reserveCost(p.request), 0),
    plannedCalls: 9, status: 'running', runs: [],
  };
}

export async function executeExperiment({ apiKey, experiment = createExperiment(), fetchImpl = fetch,
  onProgress = () => {}, signal, now = () => performance.now() }) {
  if (!apiKey?.trim()) throw new Error('OPENAI_API_KEY недоступен. Запросы не отправлены.');
  let reserved = 0;
  for (const { round, request } of createPlan()) {
    if (signal?.aborted) { experiment.status = 'cancelled'; break; }
    const allowance = reserveCost(request);
    if (reserved + allowance > BUDGET_USD) {
      experiment.status = 'failed'; experiment.error = 'Следующий запрос превышает резерв бюджета. Серия остановлена.';
      break;
    }
    // Reserve before dispatch; an unknown provider charge is never counted as zero.
    reserved += allowance;
    const run = { id: `${request.model}/${round}`, round, request, startedAt: new Date().toISOString(),
      status: 'failed', text: '', durationMs: 0, usage: null, costUsd: null };
    const started = now();
    try {
      const http = await fetchImpl(ENDPOINT, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request), redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      });
      if (!http.ok) {
        run.error = `HTTP ${http.status}. Автоматического повтора нет.`;
      } else {
        const response = await http.json();
        run.text = (response.output ?? []).filter(item => item.type === 'message' && item.role === 'assistant')
          .flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
        run.responseModel = response.model ?? null;
        run.responseStatus = response.status ?? null;
        run.responseTemperature = response.temperature ?? null;
        run.responseReasoning = response.reasoning?.effort ?? null;
        run.responseServiceTier = response.service_tier ?? null;
        run.incompleteReason = response.incomplete_details?.reason ?? null;
        run.usage = normalizeUsage(response.usage);
        run.costUsd = calculateCost(request.model, run.usage);
        const sameModel = response.model === request.model || response.model?.startsWith(`${request.model}-`);
        if (!sameModel || response.service_tier !== 'default') run.costUsd = null;
        if (!sameModel || response.temperature !== request.temperature || response.reasoning?.effort !== 'none' || response.service_tier !== 'default') {
          run.error = 'Модель или настройки ответа отличаются от запроса. Серия остановлена.';
        } else if (response.status !== 'completed' || !run.text.trim()) {
          run.error = 'Ответ пуст или не завершён. Автоматического повтора нет.';
        } else if (!run.usage) {
          run.error = 'API не вернул корректные usage-метрики. Стоимость неизвестна.';
        } else if (run.costUsd > allowance) {
          run.error = 'Стоимость превысила резерв запроса. Серия остановлена.';
        } else {
          run.status = 'completed';
          reserved += run.costUsd - allowance;
        }
      }
    } catch {
      run.error = signal?.aborted ? 'Запрос отменён. Возможна плата за уже отправленный вызов.' :
        'Сбой соединения, тайм-аут или некорректный ответ API. Автоматического повтора нет.';
    }
    run.durationMs = Math.round(now() - started);
    experiment.runs.push(run);
    experiment.status = signal?.aborted ? 'cancelled' : run.status === 'failed' ? 'failed' :
      experiment.runs.length === experiment.plannedCalls ? 'completed' : 'running';
    await onProgress(experiment, run);
    if (signal?.aborted) experiment.status = 'cancelled';
    if (run.status !== 'completed' || signal?.aborted) break;
  }
  await onProgress(experiment);
  return experiment;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
}

export function summarize(runs) {
  return MODELS.map(model => {
    const all = runs.filter(run => run.request.model === model.id);
    const completed = all.filter(run => run.status === 'completed');
    const known = all.filter(run => run.costUsd !== null);
    const withUsage = all.filter(run => run.usage);
    return { model: model.id, completed: completed.length, attempts: all.length,
      medianMs: median(completed.map(run => run.durationMs)),
      inputTokens: withUsage.reduce((s, r) => s + r.usage.input_tokens, 0),
      outputTokens: withUsage.reduce((s, r) => s + r.usage.output_tokens, 0),
      costUsd: known.reduce((s, r) => s + r.costUsd, 0),
      unknownCosts: all.length - known.length,
    };
  });
}

export function renderReport(experiment) {
  const lines = ['# День 5 — протокол сравнения моделей', '',
    `Начало (UTC): ${experiment.startedAt}. Статус: ${experiment.status}.`, '',
    '## Одинаковый запрос', '', PROMPT, '', '## Метрики', '',
    '| Модель | Завершено | Медиана, с | Входные токены | Выходные токены | Известная стоимость, USD |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...summarize(experiment.runs).map(s => `| ${s.model} | ${s.completed}/3 | ${s.medianMs === null ? '—' : (s.medianMs / 1000).toFixed(3)} | ${s.inputTokens} | ${s.outputTokens} | ${s.costUsd.toFixed(6)}${s.unknownCosts ? ' + неизвестные расходы' : ''} |`),
    '', `Стоимость — оценка по usage и тарифам на ${experiment.pricingDate}; не выписка биллинга.`,
    'Время измерено от отправки до чтения полного JSON и включает сеть. Это не TTFT и не чистая скорость генерации.',
    'Токены и стоимость не измеряют GPU, память или энергопотребление провайдера.',
    'Все ответы ниже сохранены без редакторских изменений. Оценка содержания — в README задания.',
  ];
  for (const run of experiment.runs) {
    lines.push('', `## ${run.request.model}, повтор ${run.round}`, '',
      `Статус: ${run.status}; время: ${run.durationMs} мс; стоимость: ${run.costUsd === null ? 'неизвестна' : `$${run.costUsd.toFixed(6)}`}.`,
      `Токены: вход ${run.usage?.input_tokens ?? '—'}, выход ${run.usage?.output_tokens ?? '—'}, reasoning ${run.usage?.reasoning_tokens ?? '—'}.`, '',
      ...(run.text || '(текст не получен)').split('\n').map(line => `> ${line}`));
    if (run.error) lines.push('', `Ошибка: ${run.error}`);
  }
  if (experiment.error) lines.push('', experiment.error);
  return lines.join('\n') + '\n';
}
