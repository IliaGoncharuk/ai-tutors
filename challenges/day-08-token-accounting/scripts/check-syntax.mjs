import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const directory of ['', 'scripts', 'test']) {
  for (const file of readdirSync(join(root, directory)).filter((name) => name.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', join(root, directory, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
console.log('Синтаксис всех .mjs проверен.');
