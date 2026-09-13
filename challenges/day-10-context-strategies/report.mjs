import { totals } from './agent.mjs';
import { COMMON, ENDINGS } from './scenario.mjs';

export function metric(result, strategy, extra = false) {
  const records = result.calls.filter((r) => strategy === 'branching' ?
    (extra ? r.scope === 'branching:bot' : ['branching:main', 'branching:web'].includes(r.scope)) : r.scope === strategy);
  const steps = extra ? result.runs[strategy].alternateSteps : result.runs[strategy].steps;
  const probes = steps.filter((step) => step.grade);
  const ms = steps.map((step) => step.latencyMs).sort((a, b) => a - b);
  return { ...totals(records), facts: totals(records.filter((r) => r.kind === 'facts')),
    score: probes.reduce((sum, p) => sum + p.grade.score, 0), max: probes.reduce((sum, p) => sum + p.grade.max, 0),
    medianMs: ms.length ? (ms[Math.floor((ms.length - 1) / 2)] + ms[Math.floor(ms.length / 2)]) / 2 : null,
    complete: extra ? result.runs[strategy].alternateComplete : result.runs[strategy].complete };
}
export function comparisonTable(result) {
  const rows = ['| Режим | Ходы | Факты | Вход | Выход | Всего | Из них facts | Вызовы | Медиана хода, мс |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const strategy of ['window', 'facts', 'branching']) {
    const m = metric(result, strategy);
    rows.push(`| ${strategy}${m.complete ? '' : ' (не завершён)'} | ${result.runs[strategy].steps.length}/15 | ${m.score}/${m.max} | ${m.input} | ${m.output} | ${m.total}${m.unknown ? ' + неизвестно' : ''} | ${m.facts.total} | ${m.calls} | ${m.medianMs ?? '—'} |`);
  }
  const extra = metric(result, 'branching', true);
  rows.push(`| Дополнительная ветка bot${extra.complete ? '' : ' (не завершена)'} | ${result.runs.branching.alternateSteps.length}/3 | ${extra.score}/${extra.max} | ${extra.input} | ${extra.output} | ${extra.total}${extra.unknown ? ' + неизвестно' : ''} | 0 | ${extra.calls} | ${extra.medianMs ?? '—'} |`);
  return rows.join('\n');
}
export function branchesIntact(result) {
  const last = result.branchActions.at(-1);
  return last?.active === 'web' && last.webUnchanged === true && last.checkpointUnchanged === true;
}
export function renderConclusion(result) {
  const all = totals(result.calls);
  const complete = result.complete && branchesIntact(result) && all.unknown === 0;
  const lines = [
    `ИТОГ ТЕКУЩЕГО ПРОГОНА — ${result.mode === 'live' ? 'РЕАЛЬНЫЙ API' : 'СИМУЛЯЦИЯ'}`,
    complete ? 'Все три стратегии и дополнительная ветка завершены.' : 'Проверки не завершены полностью; итогового победителя не определяем.',
    `Всего генераций: ${all.calls}. Вход: ${all.input}; выход: ${all.output}; всего: ${all.total}${all.unknown ? ` + неизвестный расход ${all.unknown} вызовов` : ''} ${result.mode === 'live' ? 'токенов' : 'условных токенов'}.`,
  ];
  for (const strategy of ['window', 'facts', 'branching']) {
    const steps = result.runs[strategy].steps;
    const last = steps.find((step) => step.turn === 15)?.grade;
    lines.push(`${strategy}: итоговое ТЗ — ${last ? `${last.score}/${last.max} точных значений` : 'не получено'}.`);
    if (last?.failed.length) lines.push(`  Поля, не совпавшие с эталоном: ${last.failed.map((item) => item.key).join(', ')}.`);
  }
  const branchCheck = result.branchActions.at(-1);
  lines.push(`Независимость веток, сохранность checkpoint и возврат в web: ${branchesIntact(result) ? 'ПРОЙДЕНО' : Object.hasOwn(branchCheck ?? {}, 'webUnchanged') ? 'ОШИБКА' : 'не проверено'}.`);
  if (complete) {
    const modes = ['window', 'facts', 'branching'].map((name) => ({ name, ...metric(result, name) }));
    const cheapest = Math.min(...modes.map((mode) => mode.total));
    lines.push(`Минимальный расход на одинаковые 15 сообщений: ${modes.filter((mode) => mode.total === cheapest).map((mode) => mode.name).join(', ')} (${cheapest} токенов).`);
    const facts = modes.find((mode) => mode.name === 'facts');
    const branch = modes.find((mode) => mode.name === 'branching');
    lines.push(`Facts: на обновление памяти ушло ${facts.facts.total} из ${facts.total} токенов.`);
    if (branch.total > 0) {
      const difference = (facts.total / branch.total - 1) * 100;
      lines.push(Math.abs(difference) < 0.05 ? 'Расход Facts и основного пути Branching примерно одинаков.' :
        `Facts ${difference > 0 ? 'расходует больше' : 'экономит'} токенов относительно основного пути Branching на ${Math.abs(difference).toFixed(1)}%.`);
    }
    lines.push(`Дополнительная ветка bot: ${metric(result, 'branching', true).total} токенов; в основное сравнение они не включены.`);
  }
  lines.push('Баллы — строгое сравнение JSON: регистр и формулировки могут снизить оценку без потери смысла. Один прогон не доказывает устойчивого преимущества стратегии.');
  return lines.join('\n');
}
const code = (text, language = '') => { const fence = '`'.repeat(Math.max(3, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length + 1))); return `${fence}${language}\n${text}\n${fence}`; };
export function renderReport(result) {
  const lines = ['# День 10 — протокол сравнения', '', `Режим: **${result.mode === 'live' ? 'РЕАЛЬНЫЙ API' : 'СИМУЛЯЦИЯ; токены условные, ответы заданы парсером'}**. Начало: ${result.startedAt}.`, '',
    `Модель: ${result.model}; N=${result.keepLatest} отдельных сообщений. Лимит: ${result.tokenBudget} токенов генераций и ${result.maxCalls} генераций на всю серию.`, '',
    '## Данные и методика', '',
    'Синтетическое ТЗ сервиса записи к репетиторам «Репетитор рядом». Это придуманные учебные данные, не производственная переписка. Во всех режимах одинаковы 15 пользовательских сообщений, модель, инструкции и параметры API. Ответы каждого режима попадают только в его собственную историю.', '',
    'В window/facts после хода остаются ровно последние N сообщений (или вся короткая история); следующий запрос содержит их и новый вопрос. Facts извлекаются отдельной генерацией из прежнего словаря, последних N сообщений и нового сообщения пользователя; JSON-изменения обновляют/удаляют отдельные ключи. Исправления заменяют старые значения, неподтверждённые предложения ассистента не должны становиться фактами. Свободного summary и API compaction нет.', '',
    'В branching checkpoint platform создаётся после хода 12; ветки web и bot получают одинаковый префикс. Сначала продолжается web (ходы 13–15), затем bot (альтернативные 13–15), затем выбирается web снова. Основная таблица сравнивает одинаковую траекторию web; три добавочных ответа bot показаны отдельно. Общий префикс в итоговом расходе учитывается один раз.', '',
    'Контроль на ходах 6, 11, 15: строгое сравнение соответствующих полей JSON с локальным эталоном, всего 11+13+15=39 проверок основной траектории. Эталон и оценки не передаются модели. Это точность фактов и одного расчёта, не универсальная оценка текста. Для acceptance проверяется только форма (три непустые строки); содержательность критериев требует чтения ответа. Неверный JSON даёт 0 баллов; неизвестные значения не засчитываются как известные факты.', '',
    'Один прогон на режим. «Стабильность» здесь означает сохранность требований по ходу диалога и независимость веток, а не статистическую воспроизводимость модели. Удобство оценивается разбором команд и поведения, без пользовательского исследования. Контрольные ответы возвращаются в историю, как в обычном чате: повторение фактов в них может продлевать память окна.', '',
    'Токены — usage всех генераций (answer + facts), включая незавершённые ответы. Медиана хода включает API-подсчёт входа и обе генерации режима facts. Перед каждым вызовом вход считается сервером вместе с инструкциями и JSON Schema. Превышение общего лимита или неизвестный расход останавливают новые генерации. Подсчёты входа — отдельные API-запросы, их биллинг не оценивается. Сохранение памяти и переключение веток API не вызывают.', '',
    'Источники: [ручной контекст](https://developers.openai.com/api/docs/guides/conversation-state), [Structured Outputs и ограничения](https://developers.openai.com/api/docs/guides/structured-outputs), [usage](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create).', '',
    '## Сравнение', '', comparisonTable(result), '', '## Автоматический вывод текущего прогона', '', renderConclusion(result), '',
    `Итого: ${totals(result.calls).calls} генераций, ${totals(result.calls).total} ${result.mode === 'live' ? 'токенов' : 'условных токенов'}; вызовов с неизвестным usage: ${totals(result.calls).unknown}.`, '',
    ...(result.mode === 'live' ? [`Оценка стоимости генераций: ${totals(result.calls).costUsd === null ? 'неизвестна' : '$' + totals(result.calls).costUsd.toFixed(6)} по [тарифу модели](https://developers.openai.com/api/docs/models/gpt-5.6-luna), без оценки биллинга подсчётов, налогов и условий аккаунта.`, ''] : []),
    '## Точные сообщения сценария', '',
  ];
  COMMON.forEach((step, index) => lines.push(`### Сообщение ${index + 1}`, '', step.prompt, ''));
  for (const [name, ending] of Object.entries(ENDINGS)) {
    ending.forEach((step, index) => lines.push(`### ${name}, сообщение ${index + 13}`, '', step.prompt, ''));
  }
  lines.push('## Полные ответы и изменения памяти', '',
    'Полный вход каждой генерации, извлечённые JSON-изменения facts, usage и длительность находятся в соседнем results.json → calls. Индексы ниже начинаются с 0. В запросах нет заголовков авторизации. Протокол — отдельный журнал эксперимента: агент его не читает и не использует как скрытую память.', '');
  for (const [name, run] of Object.entries(result.runs)) {
    for (const step of [...run.steps, ...(run.alternateSteps ?? [])]) {
      lines.push(`### ${step.scope}, ход ${step.turn}`, '', `Вызовы: ${step.callIndices.join(', ')}. Сообщений в памяти: ${step.memory.messagesCount}.`, '', code(step.text), '');
      if (step.grade) lines.push(`Факты: ${step.grade.score}/${step.grade.max}. JSON: ${step.grade.validJson}.`, '', code(JSON.stringify(step.grade, null, 2), 'json'), '');
      if (name === 'facts') lines.push('Словарь после сообщения:', '', code(JSON.stringify(step.memory.facts, null, 2), 'json'), '');
    }
    if (run.error) lines.push(`Серия ${name} остановлена: ${run.error}`, '');
  }
  lines.push('## Действия с ветками', '', code(JSON.stringify(result.branchActions, null, 2), 'json'), '');
  return lines.join('\n');
}
