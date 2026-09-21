import OpenAI from 'openai';
import { MODEL } from './config.mjs';
import { InputError } from './core.mjs';

export function liveGenerator({ apiKey = process.env.OPENAI_API_KEY, model = MODEL } = {}) {
  if (!apiKey) return async () => { throw new InputError('В окружении сервера нет OPENAI_API_KEY. Добавьте ключ и перезапустите приложение.', 503); };
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 60000 });
  return async context => {
    let response;
    try {
      response = await client.responses.create({ model, ...context, max_output_tokens: 1200, reasoning: { effort: 'none' }, store: false });
    } catch {
      throw new InputError('OpenAI не ответил. Проверьте подключение, ключ и доступный баланс. Память сохранена без изменений.', 502);
    }
    if (response.status !== 'completed' || !response.output_text?.trim()) throw new InputError('Получен неполный или пустой ответ OpenAI. Память не изменена.', 502);
    return { text: response.output_text, usage: response.usage, model: response.model };
  };
}
