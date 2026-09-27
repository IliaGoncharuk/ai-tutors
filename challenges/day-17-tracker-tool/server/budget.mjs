import { randomUUID } from 'node:crypto';
import { PublicError } from './domain.mjs';

const RESERVE_USD = 0.05;
const round = value => Number(value.toFixed(10));
const empty = () => ({ version: 2, reservedUsd: 0, estimatedUsd: 0, requests: 0, inputTokens: 0, outputTokens: 0, reservations: {} });
const count = value => Number.isSafeInteger(value) && value >= 0;
const money = value => Number.isFinite(value) && value >= 0;

export class Budget {
  constructor(store, limit = 1) { this.store = store; this.limit = limit; }

  read() {
    const value = this.store.read('budget.json', empty());
    if (!value || !money(value.reservedUsd) || !money(value.estimatedUsd) ||
        !['requests', 'inputTokens', 'outputTokens'].every(key => count(value[key]))) {
      throw new PublicError('Журнал расходов повреждён. Сохраните его копию перед восстановлением.');
    }
    if (value.version === undefined) {
      // Version 1 never released successful reservations. Preserve its exact
      // counters and a backup; historical failures cannot be reconstructed.
      if (!this.store.read('budget-v1-backup.json')) this.store.write('budget-v1-backup.json', value);
      const migrated = { ...value, version: 2, reservedUsd: 0, reservations: {} };
      this.store.write('budget.json', migrated);
      return migrated;
    }
    if (value.version !== 2 || !value.reservations || typeof value.reservations !== 'object' ||
        Array.isArray(value.reservations) || !Object.values(value.reservations).every(amount => amount === RESERVE_USD) ||
        Math.abs(value.reservedUsd - round(Object.values(value.reservations).reduce((sum, amount) => sum + amount, 0))) > 1e-9) {
      throw new PublicError('Неизвестный или повреждённый формат журнала расходов.');
    }
    return value;
  }

  view() {
    const value = this.read();
    return { ...value, limitUsd: this.limit, remainingUsd: Math.max(0, round(this.limit - value.estimatedUsd - value.reservedUsd)) };
  }

  reserve() {
    const value = this.read();
    if (value.estimatedUsd + value.reservedUsd + RESERVE_USD > this.limit + 1e-9) {
      throw new PublicError(`Лимит расходов приложения $${this.limit.toFixed(2)}: оценка $${value.estimatedUsd.toFixed(5)}, резерв $${value.reservedUsd.toFixed(2)}. Для нового запроса нужен резерв $0.05. Это локальный лимит, не баланс OpenAI; запрос не отправлен.`);
    }
    const id = randomUUID();
    value.reservations[id] = RESERVE_USD;
    value.reservedUsd = round(value.reservedUsd + RESERVE_USD);
    value.requests++;
    this.store.write('budget.json', value);
    return id;
  }

  finish(id, usage) {
    const value = this.read();
    if (!Object.hasOwn(value.reservations, id)) throw new PublicError('Резерв запроса уже учтён или не найден.');
    // Without valid usage the cost is unknown, even for an HTTP success.
    // Keep that request's reservation across later requests and restarts.
    if (!usage || !count(usage.input_tokens) || !count(usage.output_tokens)) return false;
    value.inputTokens += usage.input_tokens;
    value.outputTokens += usage.output_tokens;
    value.estimatedUsd = round(value.estimatedUsd + (usage.input_tokens * .25 + usage.output_tokens * 1.2) / 1e6);
    value.reservedUsd = round(value.reservedUsd - value.reservations[id]);
    delete value.reservations[id];
    this.store.write('budget.json', value);
    return true;
  }
}
