import { writeFile, mkdir } from 'node:fs/promises';
import { Provider } from '../server/provider.mjs';
import { build, run } from '../server/feature.mjs';
import { reportMarkdown } from '../server/review.mjs';
const provider = new Provider();
try {
  const before = provider.budget(), index = await build(provider), runs = [];
  for (const fixture of ['bugs', 'clean']) runs.push(await run(provider, { fixture, question: 'Проверь потенциальные баги, архитектуру и рекомендации.' }));
  const result = { executedAt: new Date().toISOString(), kind: 'real-cloud-on-synthetic-diffs', index, before, after: provider.budget(), runs };
  await mkdir(new URL('../results/', import.meta.url), { recursive: true }); await writeFile(new URL('../results/experiment.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  for (let i = 0; i < runs.length; i++) await writeFile(new URL(`../results/review-${i + 1}.md`, import.meta.url), reportMarkdown(runs[i]));
  console.log(JSON.stringify({ findings: runs.map(r => r.findings.length), budget: provider.budget() }));
} finally { provider.close(); }
