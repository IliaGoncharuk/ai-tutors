import { createInputPolicy, createOutputPolicy, PolicyError } from '../day-06-first-agent/policies.mjs';
import { HistoryError, MemoryHistoryStore, validateMessages } from './history.mjs';
import { MODEL, measureInput, normalizeUsage, estimateCost, estimateMaximumCost, summarize } from './accounting.mjs';

export const INSTRUCTIONS = 'Ты дружелюбный учебный ассистент. Отвечай по-русски, ясно и по существу.';

export class AgentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
  }
}

function providerError(error, stage) {
  // Do not print provider messages: they may echo the submitted text or credentials.
  const code = error?.code ?? error?.error?.code;
  if (code === 'context_length_exceeded') {
    return new AgentError('context_length_exceeded',
      `API отклонил переполненный контекст на этапе «${stage}». История сохранена.`);
  }
  if (error?.status === 429) {
    return new AgentError('rate_limit', 'API вернул 429: лимит запросов, токенов в минуту или квота. Это не доказательство переполнения контекста.');
  }
  return new AgentError(stage === 'подсчёт' ? 'count_failed' : 'api_failed',
    `Ошибка API на этапе «${stage}». Проверьте подключение, ключ и доступ к модели. История сохранена.`);
}

export class Agent {
  #client;
  #store;
  #history;
  #records = [];
  #active = false;
  #instructions;
  #maxOutputTokens;
  #contextLimit;
  #budgetUsd;
  #inputPolicy = createInputPolicy();
  #outputPolicy = createOutputPolicy();

  constructor({ client, store = new MemoryHistoryStore(), instructions = INSTRUCTIONS,
    maxOutputTokens = 800, contextLimit = MODEL.contextWindow, budgetUsd = Infinity } = {}) {
    if (typeof client?.responses?.create !== 'function' ||
        typeof client?.responses?.inputTokens?.count !== 'function') {
      throw new TypeError('Нужны responses.create() и responses.inputTokens.count().');
    }
    if (typeof instructions !== 'string' || !instructions.trim()) throw new TypeError('Нужны инструкции.');
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 16 || maxOutputTokens > MODEL.maxOutputTokens ||
        !Number.isSafeInteger(contextLimit) || contextLimit <= maxOutputTokens || contextLimit > MODEL.contextWindow) {
      throw new TypeError('Некорректный лимит контекста или ответа.');
    }
    if (typeof budgetUsd !== 'number' || !(budgetUsd > 0)) throw new TypeError('Бюджет должен быть положительным.');
    if (typeof store?.load !== 'function' || typeof store?.save !== 'function') throw new TypeError('Нужно хранилище истории.');
    this.#client = client;
    this.#store = store;
    this.#history = validateMessages(store.load());
    this.#instructions = instructions.trim();
    this.#maxOutputTokens = maxOutputTokens;
    this.#contextLimit = contextLimit;
    this.#budgetUsd = budgetUsd;
  }

  async ask(value, { onPreflight = () => {}, allowOverflow = false } = {}) {
    if (this.#active) throw new AgentError('busy', 'Дождитесь завершения предыдущего запроса.');
    const message = this.#inputPolicy.apply(value);
    this.#active = true;
    const record = { turn: this.#records.length + 1, status: 'counting', stage: 'подсчёт', sent: false,
      historyMessages: this.#history.length, counts: null, contextLimit: this.#contextLimit,
      outputReserve: this.#maxOutputTokens, usage: null, costUsd: 0, error: null };
    const payload = { model: MODEL.id, instructions: this.#instructions,
      input: [...this.getHistory(), { role: 'user', content: message }], reasoning: { effort: 'none' } };
    try {
      try { record.counts = await measureInput(this.#client, payload); }
      catch (error) { throw providerError(error, record.stage); }
      record.stage = 'проверка';
      await onPreflight(structuredClone(record));
      if (!allowOverflow && record.counts.full + this.#maxOutputTokens > this.#contextLimit) {
        throw new AgentError('local_context_limit',
          `Локальная проверка: вход ${record.counts.full} + резерв ответа ${this.#maxOutputTokens} > ${this.#contextLimit}. Генерация не отправлена; история сохранена.`);
      }
      const totals = this.getTotals();
      if (Number.isFinite(this.#budgetUsd) && (totals.unknownCostCalls ||
          totals.knownCostUsd + estimateMaximumCost(record.counts.full, this.#maxOutputTokens) > this.#budgetUsd)) {
        throw new AgentError('budget_limit', 'Расчётный бюджет генерации исчерпан или предыдущая стоимость неизвестна.');
      }
      record.stage = 'генерация';
      record.sent = true;
      record.costUsd = null;
      let response;
      try {
        response = await this.#client.responses.create({ ...payload, max_output_tokens: this.#maxOutputTokens,
          store: false, truncation: 'disabled', service_tier: 'default' });
      } catch (error) { throw providerError(error, record.stage); }
      // Account for usage before validating or committing an answer. Failed commits still cost tokens.
      record.usage = normalizeUsage(response?.usage);
      record.costUsd = response?.service_tier && response.service_tier !== 'default' ? null :
        estimateCost(record.usage, response?.model ?? MODEL.id);
      if (response?.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens') {
        throw new AgentError('output_limit', 'Ответ оборван по max_output_tokens. Полученный usage учтён; незавершённый ход не сохранён.');
      }
      record.stage = 'проверка ответа';
      const text = this.#outputPolicy.apply(response);
      const next = [...payload.input, { role: 'assistant', content: text }];
      record.stage = 'сохранение';
      this.#store.save(next);
      this.#history = next;
      record.status = 'completed';
      return { text, record: structuredClone(record) };
    } catch (error) {
      const known = error instanceof AgentError || error instanceof PolicyError || error instanceof HistoryError;
      const safe = known ? error : new AgentError('agent_failed', 'Не удалось обработать запрос.');
      record.status = safe.code ?? (safe instanceof HistoryError ? 'history_failed' : 'invalid_response');
      record.error = safe.message;
      throw safe;
    } finally {
      this.#records.push(record);
      this.#active = false;
    }
  }

  getHistory() { return this.#history.map((item) => Object.freeze({ ...item })); }
  getRecords() { return structuredClone(this.#records); }
  getTotals() { return summarize(this.#records); }

  reset() {
    if (this.#active) throw new AgentError('busy', 'Нельзя очистить историю во время запроса.');
    this.#store.save([]);
    this.#history = [];
    // Session spending remains visible after /reset.
  }
}
