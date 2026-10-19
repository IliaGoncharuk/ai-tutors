#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { Provider, PublicError } from './server/provider.mjs';
import { inspectRepository, initConfiguration, prepareRelease, saveReport } from './server/release.mjs';
const help = `ai-release — локальная подготовка релиза pet-проекта

ai-release init --repo .
ai-release inspect --repo . --base v0.1.0
ai-release prepare --repo . --base v0.1.0 --run-checks --out ./release-drafts

--head REF                Конечный коммит (по умолчанию HEAD)
--include-working-tree    Включить незакоммиченные текстовые изменения
--run-checks              Выполнить доверенные команды конфигурации проекта
--no-ai                   Сформировать отчёт без облачного вызова
--out DIR                 Каталог новых отчётов (по умолчанию ./release-drafts)
--help                    Показать справку

init сохраняет ai-release.config.json без перезаписи существующего файла.
inspect только читает Git и конфигурацию. prepare создаёт отчёт и release notes.
В облако передаются разрешённые тексты проекта и diff; ключ — OPENAI_API_KEY.
Коммиты, теги, push, установка зависимостей и публикация не выполняются.
`;
let provider;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { repo: { type: 'string', default: '.' }, base: { type: 'string' }, head: { type: 'string', default: 'HEAD' }, out: { type: 'string', default: 'release-drafts' }, 'include-working-tree': { type: 'boolean' }, 'run-checks': { type: 'boolean' }, 'no-ai': { type: 'boolean' }, help: { type: 'boolean' } } });
  const command = positionals[0];
  if (values.help || !command) console.log(help);
  else if (command === 'init') console.log(JSON.stringify(await initConfiguration(values.repo), null, 2));
  else if (command === 'inspect') { const { root: _root, files: _files, diff: _diff, config: _config, ...view } = await inspectRepository({ repo: values.repo, base: values.base, head: values.head, includeWorkingTree: values['include-working-tree'] }); console.log(JSON.stringify(view, null, 2)); }
  else if (command === 'prepare') {
    provider = values['no-ai'] ? null : new Provider(); const report = await prepareRelease(provider, { repo: values.repo, base: values.base, head: values.head, includeWorkingTree: values['include-working-tree'], runChecks: values['run-checks'], noAi: values['no-ai'] });
    const output = await saveReport(report, resolve(values.out));
    console.log(JSON.stringify({ readiness: report.readiness, output, changedFiles: report.changedFiles.length, checks: report.checks.map(c => ({ name: c.name, status: c.status })), budget: provider?.budget() || null }, null, 2));
    if (report.readiness === 'blocked') process.exitCode = 2;
  } else throw new PublicError('Неизвестная команда. Используйте --help.');
} catch (error) { console.error(error instanceof PublicError ? error.message : 'Подготовка не выполнена. Проверьте Git, конфигурацию, пути и параметры. Существующие файлы не перезаписаны.'); process.exitCode = 1; }
finally { provider?.close(); }
