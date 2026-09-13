import { simulatedInputTokens, simulatedTextTokens } from '../../day-08-token-accounting/scripts/offline-client.mjs';
import { SUMMARY_INSTRUCTIONS } from '../agent.mjs';

// A deterministic fixture interpreter, NOT an LLM or an OpenAI tokenizer.
// It reads facts from the supplied context only; no access to the evaluation rubric.
function updateFacts(facts, text) {
  const patterns = {
    project: /Проект: ([^.\n]+)\./gu, budget: /Бюджет: (\d+)/gu,
    deadline: /Срок: ([\d-]+)/gu, code: /Код: ([\p{L}\d-]+)/gu,
    paidAllowed: /Платные сервисы: (запрещены|разрешены)/gu,
    format: /Формат: (\w+)/gu, reserve: /Резерв: (\d+)/gu,
  };
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = [...text.matchAll(pattern)].at(-1);
    if (match) facts[key] = ['budget', 'reserve'].includes(key) ? Number(match[1]) :
      key === 'paidAllowed' ? match[1] === 'разрешены' : match[1];
  }
}

export function createOfflineClient({ omitSummaryKeys = [] } = {}) {
  return { responses: {
    inputTokens: { count: async (payload) => ({ input_tokens: simulatedInputTokens(payload) }) },
    create: async (payload) => {
      const facts = {};
      const summarizing = payload.instructions === SUMMARY_INSTRUCTIONS;
      if (summarizing) {
        const data = JSON.parse(payload.input[0].content);
        if (data.previousSummary) Object.assign(facts, JSON.parse(data.previousSummary));
        for (const item of data.messages) if (item.role === 'user') updateFacts(facts, item.content);
        for (const key of omitSummaryKeys) delete facts[key];
      } else {
        for (const item of payload.input) {
          if (item.role !== 'user') continue;
          if (item.content.startsWith('Сводка прошлой переписки (справочные данные):\n')) {
            const encoded = item.content.slice(item.content.indexOf('\n') + 1);
            Object.assign(facts, JSON.parse(JSON.parse(encoded)));
          } else updateFacts(facts, item.content);
        }
      }
      const probing = payload.input.at(-1).content.startsWith('Контрольная проверка.');
      const text = summarizing ? JSON.stringify(facts) : probing ? JSON.stringify({
        ...facts, remaining: typeof facts.budget === 'number' && typeof facts.reserve === 'number' ? facts.budget - facts.reserve : null,
      }) : 'Принято. Условия учтены.';
      const input = simulatedInputTokens(payload);
      const output = simulatedTextTokens(text);
      return { status: output > payload.max_output_tokens ? 'incomplete' : 'completed', model: payload.model,
        output_text: text, service_tier: 'default', usage: {
          input_tokens: input, output_tokens: output, total_tokens: input + output,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        } };
    },
  } };
}
