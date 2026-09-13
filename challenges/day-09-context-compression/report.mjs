function metric(totals, key) { return totals.unknown ? `${totals[key]} + неизвестно (${totals.unknown} выз.)` : totals[key]; }

export function renderStats(agent) {
  const rows = [['Ответы', agent.getTotals('answer')], ['Summary', agent.getTotals('summary')], ['Всего', agent.getTotals()]];
  return ['| Назначение | Вызовы | Вход | Выход | Всего токенов |', '| --- | ---: | ---: | ---: | ---: |',
    ...rows.map(([label, t]) => `| ${label} | ${t.calls} | ${metric(t, 'input')} | ${metric(t, 'output')} | ${metric(t, 'total')} |`)].join('\n');
}

export function netSavings(full, compressed) {
  const before = full.agent.getTotals();
  const after = compressed.agent.getTotals();
  if (!full.completed || !compressed.completed || before.unknown || after.unknown || !before.total) return null;
  return { tokens: before.total - after.total, percent: (before.total - after.total) / before.total * 100 };
}

export function renderComparison(full, compressed, offline) {
  const lines = [offline ? 'СИМУЛЯЦИЯ: условные токены и запрограммированные ответы; API не вызывается, списаний нет.' :
    'РЕАЛЬНЫЙ API: расход генераций из usage. Подсчёт входа показан отдельно; это не расчёт стоимости.', ''];
  for (const [title, result] of [['Без сжатия', full], ['Со сжатием', compressed]]) {
    lines.push(`${title}: ${result.completed ? '20/20 ходов' : 'серия не завершена'}`, renderStats(result.agent));
    for (const probe of result.probes) {
      lines.push(`Ход ${probe.turn}: ${probe.grade.score}/${probe.grade.max}; ошибки: ${probe.grade.failed.join(', ') || 'нет'}.`, probe.text);
    }
    const score = result.probes.reduce((sum, p) => sum + p.grade.score, 0);
    lines.push(`Качество проверенных ответов: ${score}/${result.probes.length * 8}; выполнено проверок: ${result.probes.length}/4.`, '');
  }
  lines.push('Вход в генерацию ответа по ходам (подсчёт API / условный подсчёт в симуляции):',
    '| Ход | Полная история | Со сжатием | Перед сжатием* | Сжато сообщений |', '| --- | ---: | ---: | ---: | ---: |');
  const compressedTurns = compressed.agent.getTurns();
  for (const turn of full.agent.getTurns()) {
    const short = compressedTurns.find((item) => item.turn === turn.turn);
    lines.push(`| ${turn.turn} | ${turn.after ?? '—'} | ${short?.after ?? '—'} | ${short?.compressedMessages ? short.before : '—'} | ${short?.compressedMessages ?? '—'} |`);
  }
  lines.push('* Для того же запроса и памяти с предыдущим summary, до очередного сжатия.');
  const savings = netSavings(full, compressed);
  lines.push(savings ? `Чистая экономия токенов с учётом summary: ${savings.tokens} (${savings.percent.toFixed(1)}%). Отрицательное значение означает перерасход.` :
    'Экономия не рассчитана: серия не завершена или часть usage неизвестна.');
  const summary = compressed.agent.getContext().summary;
  if (summary) lines.push('Последнее summary:', summary);
  lines.push(offline ? 'Симуляция проверяет механизм, но не качество сжатия реальной моделью и не её токенизацию.' :
    'Один синтетический диалог: оценены факты, исправления, ограничения и расчёт. Это не общая оценка качества модели.');
  return lines.join('\n');
}
