import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert } from './provider.mjs';
const execute = promisify(execFile);
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export async function git(args) { return (await execute('git', args, { cwd: REPO, windowsHide: true, maxBuffer: 4e6, timeout: 15000 })).stdout.trim(); }
export const allowedSource = path => /^(README\.md|AGENTS\.md|docs\/[\w./-]+\.md|challenges\/day-[\w/-]+\/(?:README\.md|server\.mjs|(?:server|src|public|data|fixtures|sample-project)\/[\w./-]+\.(?:mjs|js|jsx|ts|tsx|md|json)))$/.test(path) && !path.includes('..') && !/(?:^|\/)(?:results|node_modules|dist|\.env)(?:\/|$)/.test(path);
export async function listFiles() { return (await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).split('\0').filter(allowedSource).sort(); }
export async function readSource(path) {
  assert(typeof path === 'string' && allowedSource(path) && (await listFiles()).includes(path), 'Файл не входит в разрешённый корпус.');
  const file = await realpath(resolve(REPO, path)), root = await realpath(REPO), rel = relative(root, file);
  assert(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'Выход за каталог проекта запрещён.');
  assert((await stat(file)).size <= 100000, 'Файл больше 100 KB; разбейте его.');
  const text = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
  assert(!/sk-[a-zA-Z0-9_-]{20,}/.test(text), 'В файле обнаружена строка, похожая на секрет.');
  return text;
}
export async function branch() { return { branch: await git(['branch', '--show-current']) || '(detached HEAD)', head: await git(['rev-parse', '--short', 'HEAD']) }; }
export async function documentation() {
  const paths = (await listFiles()).filter(path => path === 'README.md' || path.startsWith('docs/') || /^challenges\/day-\d+-[^/]+\/README\.md$/.test(path));
  assert(paths.length <= 250, 'Слишком много документов.');
  const docs = []; for (const path of paths) docs.push({ source: path, text: await readSource(path) }); return docs;
}
