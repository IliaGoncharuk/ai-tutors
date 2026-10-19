import { writeFile, mkdir } from 'node:fs/promises';
import { Provider } from '../server/provider.mjs';
import { build, run } from '../server/feature.mjs';
import { EXAMPLES } from '../server/config.mjs';
const provider = new Provider();
try {
  const before = provider.budget(), index = await build(provider), runs = [];
  for (const question of [...EXAMPLES, '/help Какой пароль у production базы данных?']) runs.push(await run(provider, { question }));
  const result = { executedAt: new Date().toISOString(), kind: 'real-cloud', index, before, after: provider.budget(), runs };
  await mkdir(new URL('../results/', import.meta.url), { recursive: true }); await writeFile(new URL('../results/experiment.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ index, runs: runs.length, budget: provider.budget() }));
} finally { provider.close(); }
