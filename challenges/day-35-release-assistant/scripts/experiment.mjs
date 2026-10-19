import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Provider, dataDirectory } from '../server/provider.mjs';
import { ownRepository, prepareRelease } from '../server/release.mjs';
const execute = promisify(execFile), provider = new Provider();
async function command(file, args, cwd) { return (await execute(file, args, { cwd, windowsHide: true, timeout: 120000, maxBuffer: 500000 })).stdout; }
async function git(root, args) { return (await command('git', ['-c', 'core.autocrlf=false', ...args], root)).trim(); }
try {
  const before = provider.budget();
  const rootReport = await prepareRelease(provider, { repo: ownRepository, base: 'HEAD', includeWorkingTree: true, runChecks: true, question: 'Опиши добавленные помощники дней 31–35. Опирайся только на факты и покажи ограничения контекста.' });
  const fixture = resolve(dataDirectory(), `day-35-portable-${Date.now()}`); await mkdir(fixture, { recursive: true });
  await writeFile(join(fixture, 'README.md'), '# Pet Calendar\n\nLocal calendar helpers.\n');
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'pet-calendar', version: '0.1.0', private: true, type: 'module', scripts: { test: 'node tests.mjs' } }, null, 2));
  await writeFile(join(fixture, '.gitignore'), 'node_modules/\nrelease-drafts/\n.env\n');
  await writeFile(join(fixture, 'calendar.mjs'), 'export const label = day => String(day);\n');
  await writeFile(join(fixture, 'tests.mjs'), "import assert from 'node:assert/strict';\nimport {label} from './calendar.mjs';\nassert.equal(label(5), '5');\nconsole.log('Calendar checks passed');\n");
  await git(fixture, ['init', '-q']); await git(fixture, ['add', '.']);
  const commit = message => git(fixture, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', message]);
  await commit('Initial calendar helper'); const base = await git(fixture, ['rev-parse', 'HEAD']);
  await writeFile(join(fixture, 'calendar.mjs'), 'export const label = day => String(day).padStart(2, "0");\n');
  await writeFile(join(fixture, 'tests.mjs'), "import assert from 'node:assert/strict';\nimport {label} from './calendar.mjs';\nassert.equal(label(5), '05');\nassert.equal(label(12), '12');\nconsole.log('Calendar checks passed');\n");
  await git(fixture, ['add', '.']); await commit('Pad day labels to two digits');
  const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const archive = resolve(ownRepository, '.local-days-31-35/packages/ai-pet-release-1.0.0.tgz');
  await command(process.execPath, [npmCli, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', archive], fixture);
  const installedCli = resolve(fixture, 'node_modules/ai-pet-release/cli.mjs');
  await command(process.execPath, [installedCli, 'init', '--repo', fixture], fixture);
  // Commit only synthetic setup metadata so the prepared version is reproducible.
  await git(fixture, ['add', 'package.json', 'package-lock.json', 'ai-release.config.json']); await commit('Connect portable release helper');
  const output = JSON.parse(await command(process.execPath, [installedCli, 'prepare', '--repo', fixture, '--base', base, '--run-checks', '--out', join(fixture, 'release-drafts')], fixture));
  const portableReport = JSON.parse(await readFile(join(output.output, 'report.json'), 'utf8'));
  const result = { executedAt: new Date().toISOString(), kind: 'real-cloud-and-installed-cli', before, after: provider.budget(), installation: { package: 'ai-pet-release@1.0.0', from: 'local-tgz', independentRepository: 'pet-calendar', command: 'ai-release prepare --base <first-commit> --run-checks', checks: output.checks }, runs: [rootReport, portableReport] };
  await mkdir(new URL('../results/', import.meta.url), { recursive: true });
  await writeFile(new URL('../results/experiment.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  await writeFile(new URL('../results/ai-tutors-release-notes.md', import.meta.url), rootReport.releaseNotes);
  await writeFile(new URL('../results/pet-calendar-release-notes.md', import.meta.url), portableReport.releaseNotes);
  console.log(JSON.stringify({ readiness: result.runs.map(r => r.readiness), checks: result.runs.map(r => r.checks.map(c => `${c.name}:${c.status}`)), budget: provider.budget() }));
} finally { provider.close(); }
