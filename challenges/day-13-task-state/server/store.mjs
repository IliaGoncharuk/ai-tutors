import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// A commit publishes one pointer only after all four independent layer files exist.
// A crash before that publication leaves the preceding generation readable.
export class Repository {
  constructor(directory) { this.directory = resolve(directory); }
  read() {
    const current = join(this.directory, 'CURRENT.json');
    if (!existsSync(current)) return null;
    const pointer = JSON.parse(readFileSync(current, 'utf8'));
    if (!/^[a-f0-9-]{36}$/.test(pointer.generation)) throw new Error('Некорректный указатель памяти.');
    const folder = join(this.directory, 'generations', pointer.generation);
    const read = name => JSON.parse(readFileSync(join(folder, name), 'utf8'));
    const state = { ...read('system.json'), sessions: read('sessions.json'), tasks: read('tasks.json'), longTerm: read('long-term.json'), workflows: read('task-state.json') };
    if (!state.workflows?.[state.activeTask] || !['planning', 'execution', 'validation', 'done'].includes(state.workflows[state.activeTask].stage)) throw new Error('Некорректное состояние задачи.');
    if (!state.sessions?.[state.activeSession] || !state.tasks?.[state.activeTask] || !Array.isArray(state.longTerm?.entriesByProfile?.[state.activeProfile]) || !state.longTerm?.profiles?.[state.activeProfile] || state.sessions[state.activeSession].taskId !== state.activeTask || state.sessions[state.activeSession].profileId !== state.activeProfile || state.tasks[state.activeTask].profileId !== state.activeProfile) throw new Error('Память повреждена; сохранённые файлы не перезаписаны.');
    return state;
  }
  write(state) {
    mkdirSync(this.directory, { recursive: true });
    const generation = randomUUID(), folder = join(this.directory, 'generations', generation);
    mkdirSync(folder, { recursive: true });
    const { sessions, tasks, longTerm, workflows, ...system } = state;
    for (const [name, data] of Object.entries({ 'sessions.json': sessions, 'tasks.json': tasks, 'long-term.json': longTerm, 'task-state.json': workflows, 'system.json': system })) {
      writeFileSync(join(folder, name), JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', flush: true });
    }
    const temp = join(this.directory, `CURRENT.${generation}.tmp`);
    writeFileSync(temp, JSON.stringify({ generation }) + '\n', { encoding: 'utf8', flag: 'wx', flush: true });
    renameSync(temp, join(this.directory, 'CURRENT.json'));
    // The pointer is now durable. Remove prior copies so deleted facts do not accumulate.
    try { for (const name of readdirSync(join(this.directory, 'generations'))) {
      if (name !== generation && /^[a-f0-9-]{36}$/.test(name)) {
        try { rmSync(join(this.directory, 'generations', name), { recursive: true }); } catch { /* committed state remains valid */ }
      }
    } } catch { /* housekeeping failure must not turn a successful commit into an error */ }
  }
}
