// Toy tokenizer for reproducible SIMULATION ONLY. It is not the model tokenizer,
// and its counts must never be presented as measurements of OpenAI.
export function simulatedTextTokens(text) {
  return (text.match(/\p{L}+|\p{N}+|[^\s]/gu) ?? []).length;
}

export function simulatedInputTokens({ instructions = '', input = [] }) {
  return 3 + (instructions ? 4 + simulatedTextTokens(instructions) : 0) +
    input.reduce((sum, message) => sum + 4 + simulatedTextTokens(message.content), 0);
}

export function createOfflineClient({ contextWindow = 8192 } = {}) {
  return { responses: {
    inputTokens: { count: async (payload) => ({ input_tokens: simulatedInputTokens(payload) }) },
    create: async (payload) => {
      const inputTokens = simulatedInputTokens(payload);
      if (inputTokens > contextWindow) {
        throw Object.assign(new Error('Simulated context overflow'), { status: 400, code: 'context_length_exceeded' });
      }
      const last = payload.input.at(-1).content;
      const marker = payload.input.find((item) => /Контрольное слово: (\p{L}+)/u.test(item.content))?.content;
      const word = marker?.match(/Контрольное слово: (\p{L}+)/u)?.[1];
      const text = last.includes('Какое контрольное слово') ? word ?? 'Не знаю.' : 'Принято. Продолжаем диалог.';
      const outputTokens = simulatedTextTokens(text);
      return { status: 'completed', model: payload.model, output_text: text, service_tier: 'default', usage: {
        input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      } };
    },
  } };
}
