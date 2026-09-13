import { summarize } from './accounting.mjs';

const number = (value) => value === null || value === undefined ? '?' : String(value);
const money = (value) => value === null ? '?' : `$${value.toFixed(8)}`;

export function renderPreflight(record) {
  const { counts, contextLimit, outputReserve } = record;
  if (!counts) return 'Подсчёт входа не завершён.';
  return `Токены: новое сообщение ${counts.current}; история до хода ${counts.history}; ` +
    `полный вход ${counts.full}. Контекст: ${(100 * counts.full / contextLimit).toFixed(2)}% ` +
    `(${counts.full}/${contextLimit}), резерв ответа ${outputReserve}, ` +
    `остаток с резервом ${contextLimit - counts.full - outputReserve}.`;
}

export function renderTurn(record) {
  const usage = record.usage;
  return `Ход ${record.turn}: ${record.status}. ` +
    (record.sent ? `Usage: вход ${number(usage?.input)}, ответ ${number(usage?.output)}, ` +
      `всего ${number(usage?.total)}; кеш: чтение ${number(usage?.cached)}, запись ${number(usage?.written)}; ` +
      `reasoning ${number(usage?.reasoning)} (входит в ответ). Стоимость ≈ ${money(record.costUsd)}.` :
      'Генерация не отправлена; расход генерации 0.') +
    (usage && record.counts ? ` Δ входа (usage − подсчёт): ${usage.input - record.counts.full}.` : '');
}

export function renderTotals(records) {
  const total = summarize(records);
  return `За текущий запуск: генераций ${total.apiCalls}; известный расход: вход ${total.input}, ` +
    `ответ ${total.output}, всего ${total.total}; известная стоимость ≈ ${money(total.knownCostUsd)}. ` +
    `Вызовов без usage: ${total.unknownUsageCalls}; с неизвестной стоимостью: ${total.unknownCostCalls}.`;
}

export function renderReport(records, title) {
  let accumulated = 0;
  let unknown = false;
  const rows = records.map((record) => {
    if (record.sent && record.costUsd === null) unknown = true;
    accumulated += record.costUsd ?? 0;
    return `| ${record.turn} | ${number(record.counts?.current)} | ${number(record.counts?.history)} | ` +
      `${number(record.counts?.full)} | ${record.sent ? number(record.usage?.input) : '—'} | ` +
      `${record.sent ? number(record.usage?.output) : '—'} | ${money(record.costUsd)} | ` +
      `${money(accumulated)}${unknown ? ' + ?' : ''} | ${record.status} |`;
  });
  const measured = records.filter((record) => record.counts);
  const max = Math.max(1, ...measured.map((record) => record.counts.full));
  const chart = measured.map((record) =>
    `${String(record.turn).padStart(2)} ${'#'.repeat(Math.max(1, Math.round(record.counts.full / max * 36)))} ${record.counts.full}`);
  return [title, '',
    '| Ход | Новое | История до | Вход до API | Usage вход | Ответ | ≈ USD ход | ≈ USD сумма | Статус |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, '',
    'Рост полного входа (масштаб внутри этой серии):', ...chart, '', renderTotals(records),
    ...records.filter((record) => record.error).map((record) => `Ход ${record.turn}, ${record.stage}: ${record.error}`),
  ].join('\n');
}
