import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { HistoryError, JsonHistoryStore, validateMessages } from '../day-07-context-persistence/history-store.mjs';

export { HistoryError, JsonHistoryStore, validateMessages };

export function historyPath(env = process.env) {
  const custom = env.TOKEN_AGENT_HISTORY_FILE?.trim();
  if (custom && !isAbsolute(custom)) {
    throw new HistoryError('TOKEN_AGENT_HISTORY_FILE должен содержать абсолютный путь.');
  }
  return custom || join(homedir(), '.ai-tutors', 'day-08', 'messages.json');
}

export class MemoryHistoryStore {
  #messages;
  constructor(messages = []) { this.#messages = validateMessages(messages); }
  load() { return validateMessages(this.#messages); }
  save(messages) { this.#messages = validateMessages(messages); }
}
