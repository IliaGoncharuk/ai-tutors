const FILLER = 'Учебный журнал: команда обсудила подписи кнопок, порядок разделов и удобство навигации. Это черновые заметки, условия проекта не меняются. ';
const QUESTION = 'Контрольная проверка. Верни только JSON с полями project, budget, deadline, code, paidAllowed, format, reserve, remaining. remaining — бюджет минус резерв. Значения бери из актуальных условий диалога; неизвестное обозначь null.';

export function scenario() {
  const conditions = {
    1: 'Проект: Маяк. Бюджет: 12000. Срок: 2026-10-15. Код: МАЯК-42. Платные сервисы: запрещены. Формат: Markdown. Резерв: 2500. Сохрани эти условия до конца диалога.',
    7: 'Исправление: прежний бюджет больше не действует. Бюджет: 9000. Остальные условия сохраняются.',
    13: 'Исправление: прежний формат больше не нужен. Формат: CSV. Остальные условия сохраняются.',
  };
  return Array.from({ length: 20 }, (_, index) => {
    const turn = index + 1;
    const probe = [8, 12, 16, 20].includes(turn);
    return { turn, prompt: probe ? QUESTION : `${conditions[turn] ?? ''}\nЗапись ${turn}. ${FILLER.repeat(18)}Подтверди одним коротким предложением.`,
      expected: probe ? { project: 'Маяк', budget: 9000, deadline: '2026-10-15', code: 'МАЯК-42',
        paidAllowed: false, format: turn >= 13 ? 'CSV' : 'Markdown', reserve: 2500, remaining: 6500 } : null };
  });
}

// This rubric evaluates exact facts/constraints and one calculation, not overall fluency.
// Expectations are local and are never sent to the responding/summarizing model.
export function evaluate(text, expected) {
  let answer;
  try { answer = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { return { score: 0, max: Object.keys(expected).length, validJson: false, failed: Object.keys(expected) }; }
  const validJson = answer !== null && typeof answer === 'object' && !Array.isArray(answer);
  const failed = Object.entries(expected).filter(([key, value]) => !validJson || answer[key] !== value).map(([key]) => key);
  return { score: Object.keys(expected).length - failed.length, max: Object.keys(expected).length, validJson, failed };
}
