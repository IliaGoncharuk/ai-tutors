import {
  createInputPolicy, createOutputPolicy, PolicyError,
} from '../day-06-first-agent/policies.mjs';
import { HistoryError, JsonHistoryStore, validateMessages } from './history-store.mjs';

export class AgentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgentError';
  }
}

export class Agent {
  #client;
  #model;
  #instructions;
  #maxOutputTokens;
  #inputPolicy;
  #outputPolicy;
  #store;
  #history;
  #active = false;

  constructor({
    client,
    store = new JsonHistoryStore(),
    model = 'gpt-5.6-luna',
    instructions = 'Ты дружелюбный учебный ассистент. Отвечай по-русски, ясно и по существу.',
    maxOutputTokens = 800,
    inputPolicy = createInputPolicy(),
    outputPolicy = createOutputPolicy(),
  }) {
    if (typeof client?.responses?.create !== 'function') {
      throw new TypeError('Нужен LLM-клиент с методом responses.create().');
    }
    if (typeof model !== 'string' || !model.trim()) {
      throw new TypeError('model должен быть непустой строкой.');
    }
    if (typeof instructions !== 'string' || !instructions.trim()) {
      throw new TypeError('instructions должны быть непустой строкой.');
    }
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) {
      throw new TypeError('maxOutputTokens должен быть положительным целым числом.');
    }
    if (typeof inputPolicy?.apply !== 'function' || typeof outputPolicy?.apply !== 'function') {
      throw new TypeError('Политики должны реализовывать apply().');
    }
    if (typeof store?.load !== 'function' || typeof store?.save !== 'function') {
      throw new TypeError('Хранилище должно реализовывать синхронные load() и save().');
    }
    this.#client = client;
    this.#model = model.trim();
    this.#instructions = instructions.trim();
    this.#maxOutputTokens = maxOutputTokens;
    this.#inputPolicy = inputPolicy;
    this.#outputPolicy = outputPolicy;
    this.#store = store;
    this.#history = validateMessages(store.load());
  }

  async ask(value) {
    const message = this.#inputPolicy.apply(value);
    if (this.#active) {
      throw new AgentError('Дождитесь завершения предыдущего ответа агента.');
    }
    this.#active = true;
    const input = [...this.getHistory(), { role: 'user', content: message }];
    try {
      let response;
      try {
        response = await this.#client.responses.create({
          model: this.#model,
          instructions: this.#instructions,
          input,
          max_output_tokens: this.#maxOutputTokens,
          reasoning: { effort: 'none' },
          store: false,
        });
      } catch {
        throw new AgentError(
          'Не удалось получить ответ модели. Проверьте ключ, подключение и лимиты API.',
        );
      }
      const text = this.#outputPolicy.apply(response);
      const history = [
        ...this.getHistory(),
        { role: 'user', content: message },
        { role: 'assistant', content: text },
      ];
      // A successful answer becomes visible only after its durable commit.
      this.#store.save(history);
      this.#history = history;
      return Object.freeze({
        text, model: response.model ?? this.#model, usage: response.usage ?? null,
      });
    } catch (error) {
      if (error instanceof AgentError || error instanceof PolicyError || error instanceof HistoryError) {
        throw error;
      }
      throw new AgentError('Агент не смог обработать или сохранить ответ модели.');
    } finally {
      this.#active = false;
    }
  }

  getHistory() {
    return this.#history.map((message) => Object.freeze({ ...message }));
  }

  reset() {
    if (this.#active) {
      throw new AgentError('Нельзя очистить историю во время ответа модели.');
    }
    this.#store.save([]);
    this.#history = [];
  }
}
