import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DAY } from './config.mjs';
import { PublicError } from './domain.mjs';
import { fileURLToPath } from 'node:url';
export function dataDirectory() { return process.env.TRACKER_LAB_DATA_DIR || join(homedir(), '.ai-tutors', `tracker-lab-day-${DAY}`); }
export class Store {
  constructor(directory = dataDirectory()) {
    this.directory = resolve(directory);
    const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
    if (this.directory.toLowerCase() === repo.toLowerCase() || this.directory.toLowerCase().startsWith(repo.toLowerCase() + sep)) throw new PublicError('Рабочие данные должны храниться вне репозитория.');
    mkdirSync(this.directory, { recursive: true });
  }
  lock() {
    const file = this.file('.app.lock');
    if (existsSync(file)) {
      const pid = Number(readFileSync(file, 'utf8'));
      let alive = true;
      try { process.kill(pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
      if (alive) throw new PublicError('Каталог данных уже используется другим процессом.');
      unlinkSync(file);
    }
    try { const fd = openSync(file, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd); }
    catch { throw new PublicError('Не удалось заблокировать каталог данных.'); }
    return () => { if (existsSync(file)) unlinkSync(file); };
  }
  file(name) { if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new PublicError('Неверное имя локального файла.'); return join(this.directory, name); }
  read(name, fallback = null) { const file = this.file(name); if (!existsSync(file)) return fallback; try { return JSON.parse(readFileSync(file, 'utf8')); } catch { throw new PublicError('Локальный файл повреждён. Сохраните его копию перед восстановлением.'); } }
  write(name, data) { const file = this.file(name), temporary = `${file}.${randomUUID()}.tmp`; writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 }); renameSync(temporary, file); }
  text(name, data) { const file = this.file(name), temporary = `${file}.${randomUUID()}.tmp`; writeFileSync(temporary, data, { mode: 0o600 }); renameSync(temporary, file); return file; }
}
