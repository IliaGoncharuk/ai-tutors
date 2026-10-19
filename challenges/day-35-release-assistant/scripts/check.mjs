import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
async function visit(directory) { for (const entry of await readdir(new URL(directory, new URL('../', import.meta.url)), { withFileTypes: true })) { const path = `${directory}${entry.name}`; if (entry.isDirectory()) await visit(`${path}/`); else if (/\.(mjs|js)$/.test(path)) execFileSync(process.execPath, ['--check', path], { cwd: root, stdio: 'inherit', windowsHide: true }); } }
for (const directory of ['server/', 'public/', 'scripts/', 'tests/']) await visit(directory);
execFileSync(process.execPath, ['--check', 'cli.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true });
execFileSync(process.execPath, ['--test', 'tests/*.test.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true });
