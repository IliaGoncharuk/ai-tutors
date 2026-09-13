import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { validateMessages } from '../day-07-context-persistence/history-store.mjs';

export class ContextError extends Error {
  constructor(message) { super(message); this.name = 'ContextError'; }
}
export const STRATEGIES = ['window', 'facts', 'branching'];
export const validName = (name) => typeof name === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(name) && !['constructor', 'prototype', '__proto__'].includes(name);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, expected) => object(v) && Object.keys(v).sort().join(',') === expected.split(',').sort().join(',');
const validN = (n) => Number.isSafeInteger(n) && n >= 2 && n <= 1000 && n % 2 === 0;
const validTurn = (n) => Number.isSafeInteger(n) && n >= 0;

export function validateFacts(facts) {
  if (!object(facts) || Object.keys(facts).length > 40 || JSON.stringify(facts).length > 8000 ||
      Object.entries(facts).some(([key, value]) => !validName(key) || typeof value !== 'string' || !value.trim() || value.length > 400)) {
    throw new ContextError('Facts: до 40 ключей, значения — непустые строки до 400 символов, всего до 8000 символов.');
  }
  return structuredClone(facts);
}

export function emptyState(keepLatest = 6, strategy = 'window') {
  return { version: 1, keepLatest, strategy,
    window: { messages: [], turns: 0 },
    facts: { messages: [], turns: 0, values: {} },
    branching: { active: 'main', branches: { main: { messages: [], turns: 0, checkpoint: null } }, checkpoints: {} },
  };
}

export function validateState(state) {
  const fail = () => { throw new ContextError('Некорректный формат памяти Дня 10. Файл не изменён.'); };
  if (!keys(state, 'version,keepLatest,strategy,window,facts,branching') || state.version !== 1 ||
      !validN(state.keepLatest) || !STRATEGIES.includes(state.strategy)) fail();
  const history = (session, shape, bounded) => {
    if (!keys(session, shape) || !validTurn(session.turns)) fail();
    try { validateMessages(session.messages); } catch { fail(); }
    if (session.messages.length !== (bounded ? Math.min(state.keepLatest, session.turns * 2) : session.turns * 2)) fail();
  };
  history(state.window, 'messages,turns', true);
  history(state.facts, 'messages,turns,values', true);
  validateFacts(state.facts.values);
  const b = state.branching;
  if (!keys(b, 'active,branches,checkpoints') || !object(b.branches) || !object(b.checkpoints) ||
      !Object.hasOwn(b.branches, b.active) || !Object.hasOwn(b.branches, 'main')) fail();
  for (const [name, cp] of Object.entries(b.checkpoints)) {
    if (!validName(name)) fail();
    history(cp, 'messages,turns,sourceBranch', false);
    if (!Object.hasOwn(b.branches, cp.sourceBranch)) fail();
  }
  for (const [name, branch] of Object.entries(b.branches)) {
    if (!validName(name)) fail();
    history(branch, 'messages,turns,checkpoint', false);
    if (branch.checkpoint !== null) {
      if (!Object.hasOwn(b.checkpoints, branch.checkpoint)) fail();
      const cp = b.checkpoints[branch.checkpoint];
      if (JSON.stringify(branch.messages.slice(0, cp.messages.length)) !== JSON.stringify(cp.messages)) fail();
    }
  }
  return structuredClone(state);
}

export function contextPath(env = process.env) {
  const custom = env.STRATEGIES_AGENT_FILE?.trim();
  if (custom && !isAbsolute(custom)) throw new ContextError('STRATEGIES_AGENT_FILE должен быть абсолютным путём.');
  return custom || join(homedir(), '.ai-tutors', 'day-10', 'context.json');
}

export class MemoryStore {
  #state;
  constructor(initial = emptyState()) { this.#state = validateState(initial); }
  load() { return validateState(this.#state); }
  save(state) { this.#state = validateState(state); }
}

// One CLI process per file. Replace the complete validated snapshot atomically.
export class JsonStore {
  constructor(file = contextPath(), initial = emptyState()) { this.file = resolve(file); this.initial = validateState(initial); }
  load() {
    let raw;
    try { raw = readFileSync(this.file, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return structuredClone(this.initial);
      throw new ContextError('Не удалось прочитать память.');
    }
    try { return validateState(JSON.parse(raw)); }
    catch { throw new ContextError('Память повреждена или несовместима. Файл не изменён.'); }
  }
  save(state) {
    const data = JSON.stringify(validateState(state), null, 2);
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, `${data}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true });
      renameSync(temporary, this.file);
    } catch { throw new ContextError('Не удалось сохранить память. Изменение не зафиксировано.'); }
    finally { try { rmSync(temporary, { force: true }); } catch { /* Preserve the original failure. */ } }
  }
}
