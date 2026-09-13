import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export class HistoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HistoryError';
  }
}

export function historyPath(env = process.env) {
  const custom = env.AGENT_HISTORY_FILE?.trim();
  if (custom && !isAbsolute(custom)) {
    throw new HistoryError('AGENT_HISTORY_FILE должен содержать абсолютный путь.');
  }
  return custom || join(homedir(), '.ai-tutors', 'day-07', 'messages.json');
}

export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length % 2 !== 0) {
    throw new HistoryError('История должна содержать полные пары user/assistant.');
  }
  return messages.map((message, index) => {
    if (
      !message || typeof message !== 'object' ||
      Object.keys(message).length !== 2 ||
      message.role !== (index % 2 === 0 ? 'user' : 'assistant') ||
      typeof message.content !== 'string' || !message.content.trim()
    ) {
      throw new HistoryError('История содержит недопустимое сообщение.');
    }
    return { role: message.role, content: message.content };
  });
}

// Synchronous disk operations keep commits indivisible within this small CLI.
// One running application per history file; no multi-process database semantics.
export class JsonHistoryStore {
  constructor(file = historyPath()) {
    this.file = resolve(file);
  }

  load() {
    let raw;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new HistoryError('Не удалось прочитать историю. Проверьте путь и права доступа.');
    }
    try {
      const data = JSON.parse(raw);
      if (!data || data.version !== 1 || Object.keys(data).length !== 2) {
        throw new Error('Unsupported history format');
      }
      return validateMessages(data.messages);
    } catch {
      throw new HistoryError(
        'История повреждена или имеет неподдерживаемый формат. Файл не изменён. ' +
        'Восстановите его из копии или задайте другой AGENT_HISTORY_FILE.',
      );
    }
  }

  save(messages) {
    const data = JSON.stringify({ version: 1, messages: validateMessages(messages) }, null, 2);
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, `${data}\n`, {
        encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true,
      });
      // Replace only after the complete new transcript has been written and flushed.
      renameSync(temporary, this.file);
    } catch {
      throw new HistoryError(
        'Не удалось сохранить историю. Ход не зафиксирован; проверьте путь, место и права доступа.',
      );
    } finally {
      try { rmSync(temporary, { force: true }); } catch { /* Keep the original error. */ }
    }
  }
}
