import { readFile, writeFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDirectory, assert } from './provider.mjs';
export const FILES = ['README.md', 'src/client.mjs', 'src/dashboard.mjs', 'docs/api.md'];
const seed = fileURLToPath(new URL('../sample-project/', import.meta.url));
export const workspaceRoot = () => resolve(dataDirectory(), 'day-34-workspace');
export async function safeFile(root, path) {
  assert(FILES.includes(path), 'Файл вне учебной области.');
  const rootReal = await realpath(root), candidate = resolve(root, path), parentReal = await realpath(dirname(candidate)), rel = relative(rootReal, parentReal);
  assert(rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'Выход из рабочей копии запрещён.');
  const stats = await lstat(candidate).catch(() => null); assert(!stats?.isSymbolicLink(), 'Символические ссылки запрещены.'); return candidate;
}
export async function initialize(root = workspaceRoot(), reset = false) {
  await mkdir(root, { recursive: true });
  const info = await lstat(root); assert(!info.isSymbolicLink(), 'Корень рабочей копии не должен быть ссылкой.');
  for (const path of FILES) {
    await mkdir(dirname(resolve(root, path)), { recursive: true }); const file = await safeFile(root, path);
    if (reset || !(await lstat(file).catch(() => null))) await writeFile(file, await readFile(resolve(seed, path)), { flag: reset ? 'w' : 'wx' });
  }
  return root;
}
export async function readWorkspace(root, path) { return readFile(await safeFile(root, path), 'utf8'); }
export async function writeWorkspace(root, path, content) {
  assert(path === 'docs/api.md', 'Запись разрешена только в документацию API учебной копии.');
  assert(typeof content === 'string' && content.length > 30 && content.length < 15000, 'Недопустимый размер документа.');
  content = content.replace(/\r\n/g, '\n'); if (!content.endsWith('\n')) content += '\n';
  const file = await safeFile(root, path), previous = await readFile(file, 'utf8');
  if (previous === content) return { path, changed: false };
  await writeFile(file, content); return { path, changed: true };
}
export async function verify(root) {
  const client = await readWorkspace(root, 'src/client.mjs'), doc = await readWorkspace(root, 'docs/api.md');
  const endpoints = [...new Set([...client.matchAll(/'(\/api\/[^']+)'/g)].map(m => m[1]))];
  const missing = endpoints.filter(endpoint => !doc.includes(endpoint));
  return { ok: missing.length === 0 && !doc.includes('/api/v1/') && /v2/.test(doc), endpoints, missing, staleVersion: doc.includes('/api/v1/'), note: 'Проверены имена маршрутов и версия, не полнота всего описания.' };
}
export async function snapshot(root) { const result = {}; for (const path of FILES) result[path] = await readWorkspace(root, path); return result; }
export function makeDiff(before, after) {
  const lines = text => text.replace(/\n$/, '').split('\n');
  return FILES.filter(path => before[path] !== after[path]).map(path => `--- a/${path}\n+++ b/${path}\n@@ -1,${lines(before[path]).length} +1,${lines(after[path]).length} @@\n${lines(before[path]).map(line => `-${line}`).join('\n')}\n${lines(after[path]).map(line => `+${line}`).join('\n')}\n`).join('');
}
