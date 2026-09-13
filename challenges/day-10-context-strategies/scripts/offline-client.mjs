import { FACT_INSTRUCTIONS, FACT_PREFIX } from '../agent.mjs';
import { simulatedTextTokens } from '../../day-08-token-accounting/scripts/offline-client.mjs';

// Deterministic parser of this educational fixture, NOT an LLM. No grader or expected values.
const patterns = {
  project: /Проект: ([^.\n]+)/gu, audience: /Аудитория: ([^.\n]+)/gu, city: /Город: ([^.\n]+)/gu,
  budget: /Бюджет: (\d+)/gu, deadline: /Срок: ([\d-]+)/gu,
  onlinePaymentAllowed: /Онлайн-оплата: (запрещена|разрешена)/gu,
  phoneRequired: /Телефон пользователя: (не собираем|собираем)/gu,
  lessonMinutes: /длительность занятия: (\d+)/gu, tutors: /Репетиторов: (\d+)/gu,
  notifications: /[Кк]анал уведомлений: ([^.\n]+)/gu, reminderHours: /Напоминание: за (\d+)/gu,
  reserve: /Резерв: (\d+)/gu, cancellationHours: /Отмена записи: не позднее чем за (\d+)/gu,
  platform: /Платформа: ([^.\n]+)/gu, paidIntegrations: /Платные интеграции: ([^.\n]+)/gu,
};
const numbers = ['budget', 'lessonMinutes', 'tutors', 'reminderHours', 'reserve', 'cancellationHours'];
function parseText(text) {
  return Object.fromEntries(Object.entries(patterns).flatMap(([key, pattern]) => {
    const value = [...text.matchAll(pattern)].at(-1)?.[1];
    return value === undefined ? [] : [[key, value]];
  }));
}
const count = (payload) => simulatedTextTokens(JSON.stringify(payload));

export function createOfflineClient() {
  return { responses: {
    inputTokens: { count: async (payload) => ({ input_tokens: count(payload) }) },
    create: async (payload) => {
      let text;
      if (payload.instructions === FACT_INSTRUCTIONS) {
        const data = JSON.parse(payload.input[0].content);
        text = JSON.stringify({ updates: Object.entries(parseText(data.userMessage)).map(([key, value]) => ({ key, value })) });
      } else {
        const facts = {};
        for (const item of payload.input) {
          if (item.content.startsWith(FACT_PREFIX)) Object.assign(facts, JSON.parse(item.content.slice(FACT_PREFIX.length)));
          else if (item.role === 'user') Object.assign(facts, parseText(item.content));
          else {
            try { for (const [key, value] of Object.entries(JSON.parse(item.content))) if (value !== null && Object.hasOwn(patterns, key)) facts[key] = String(value); } catch { /* Ordinary acknowledgements carry no facts. */ }
          }
        }
        if (/верни только JSON/.test(payload.input.at(-1).content)) {
          const answer = Object.fromEntries(Object.entries(facts).filter(([key]) => key !== 'paidIntegrations').map(([key, value]) => [key,
            numbers.includes(key) ? Number(value) : key === 'onlinePaymentAllowed' ? ['разрешена', 'true'].includes(value) :
              key === 'phoneRequired' ? ['собираем', 'true'].includes(value) : value]));
          answer.remaining = typeof answer.budget === 'number' && typeof answer.reserve === 'number' ? answer.budget - answer.reserve : null;
          if (payload.input.at(-1).content.includes('Добавь acceptance')) answer.acceptance = ['Запись доступна при выборе свободного слота.', 'Подтверждённый канал доставляет уведомление.', 'Отмена проверяет установленный срок.'];
          text = JSON.stringify(answer);
        } else text = 'Принято. Продолжаем сбор ТЗ.';
      }
      const input = count(payload), output = simulatedTextTokens(text);
      return { status: output > payload.max_output_tokens ? 'incomplete' : 'completed', output_text: text, model: payload.model,
        usage: { input_tokens: input, output_tokens: output, total_tokens: input + output,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    },
  } };
}
