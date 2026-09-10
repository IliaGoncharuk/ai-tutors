import { createInputPolicy, createOutputPolicy, PolicyError } from './policies.mjs';

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
  #history = [];
  #active = false;

  constructor({
    client,
    model = 'gpt-5.6-luna',
    instructions =
      'Ты дружелюбный учебный ассистент. Отвечай по-русски, ясно и по существу.',
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
    if (typeof inputPolicy?.apply !== 'function') {
      throw new TypeError('inputPolicy должен реализовывать apply().');
    }
    if (typeof outputPolicy?.apply !== 'function') {
      throw new TypeError('outputPolicy должен реализовывать apply().');
    }

    this.#client = client;
    this.#model = model.trim();
    this.#instructions = instructions.trim();
    this.#maxOutputTokens = maxOutputTokens;
    this.#inputPolicy = inputPolicy;
    this.#outputPolicy = outputPolicy;
  }

  async ask(value) {
    const message = this.#inputPolicy.apply(value);
    if (this.#active) {
      throw new AgentError('Дождитесь завершения предыдущего ответа агента.');
    }

    this.#active = true;
    const input = [
      ...this.#history.map((item) => ({ ...item })),
      { role: 'user', content: message },
    ];

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
      this.#history.push(
        { role: 'user', content: message },
        { role: 'assistant', content: text },
      );

      return Object.freeze({
        text,
        model: response.model ?? this.#model,
        usage: response.usage ?? null,
      });
    } catch (error) {
      if (error instanceof AgentError || error instanceof PolicyError) {
        throw error;
      }
      throw new AgentError('Агент не смог обработать ответ модели.');
    } finally {
      this.#active = false;
    }
  }

  getHistory() {
    return this.#history.map((item) => Object.freeze({ ...item }));
  }

  reset() {
    if (this.#active) {
      throw new AgentError('Нельзя очистить историю во время ответа модели.');
    }
    this.#history = [];
  }
}
