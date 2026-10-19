import { writeFile, mkdir } from 'node:fs/promises';
import { Provider } from '../server/provider.mjs';
import { run } from '../server/feature.mjs';
import { initialize } from '../server/workspace.mjs';
const provider = new Provider();
try {
  await initialize(undefined, true); const before = provider.budget(), runs = [];
  runs.push(await run(provider, { scenario: 'find', question: 'Найди все места использования API и объясни, как связаны клиент, экран и документация.' }));
  runs.push(await run(provider, { scenario: 'update', question: 'Приведи документацию API в соответствие с фактическим кодом. Сохрани результат и проверь его.' }));
  runs.push(await run(provider, { scenario: 'update', question: 'Повторно проверь соответствие документации коду. Если уже соответствует, не меняй файлы.' }));
  await mkdir(new URL('../results/', import.meta.url), { recursive: true });
  await writeFile(new URL('../results/experiment.json', import.meta.url), JSON.stringify({ executedAt: new Date().toISOString(), kind: 'real-cloud-file-agent', before, after: provider.budget(), runs }, null, 2) + '\n');
  await writeFile(new URL('../results/update.diff', import.meta.url), runs[1].diff + '\n');
  console.log(JSON.stringify({ runs: runs.map(r => ({ scenario: r.scenario, steps: r.events.length, changed: Boolean(r.diff), verified: r.verification.ok })), budget: provider.budget() }));
} finally { provider.close(); }
