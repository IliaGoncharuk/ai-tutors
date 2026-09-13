import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { HistoryError, validateMessages } from '../day-07-context-persistence/history-store.mjs';

export { HistoryError };

export function emptyContext() {
  return { version: 1, summary: '', recentMessages: [], summarizedMessages: 0, messagesSinceSummary: 0 };
}

export function validateContext(data) {
  const even = (n) => Number.isSafeInteger(n) && n >= 0 && n % 2 === 0;
  if (!data || Object.keys(data).sort().join(',') !== Object.keys(emptyContext()).sort().join(',') ||
      data.version !== 1 || typeof data.summary !== 'string' ||
      !even(data.summarizedMessages) || !even(data.messagesSinceSummary)) {
    throw new HistoryError('Некорректный формат памяти Дня 9. Файл не изменён.');
  }
  const recentMessages = validateMessages(data.recentMessages);
  if (Boolean(data.summary.trim()) !== (data.summarizedMessages > 0) ||
      data.messagesSinceSummary > recentMessages.length ||
      (data.summarizedMessages === 0 && data.messagesSinceSummary !== recentMessages.length)) {
    throw new HistoryError('Summary и счётчики памяти не согласованы. Файл не изменён.');
  }
  return { ...data, recentMessages };
}

export function contextPath(env = process.env, compression = true) {
  const custom = env.CONTEXT_AGENT_HISTORY_FILE?.trim();
  if (custom && !isAbsolute(custom)) throw new HistoryError('CONTEXT_AGENT_HISTORY_FILE должен быть абсолютным путём.');
  return custom || join(homedir(), '.ai-tutors', 'day-09', compression ? 'context.json' : 'full-history.json');
}

export class MemoryContextStore {
  #state;
  constructor(state = emptyContext()) { this.#state = validateContext(state); }
  load() { return validateContext(this.#state); }
  save(state) { this.#state = validateContext(state); }
}

// A single file keeps summary, tail and counters consistent across a restart.
// Use only one running CLI per file; this is not a multi-process database.
export class JsonContextStore {
  constructor(file = contextPath()) { this.file = resolve(file); }

  load() {
    let raw;
    try { raw = readFileSync(this.file, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return emptyContext();
      throw new HistoryError('Не удалось прочитать память. Проверьте путь и права.');
    }
    try { return validateContext(JSON.parse(raw)); }
    catch { throw new HistoryError('Память повреждена или имеет неподдерживаемый формат. Выберите другой файл или восстановите копию. Файл не изменён.'); }
  }

  save(state) {
    const data = JSON.stringify(validateContext(state), null, 2);
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, `${data}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true });
      renameSync(temporary, this.file);
    } catch { throw new HistoryError('Не удалось сохранить память. Ход и сжатие не зафиксированы.'); }
    finally {
      try { rmSync(temporary, { force: true }); } catch { /* Preserve the original error. */ }
    }
  }
}
