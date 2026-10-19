import { writeFile, mkdir } from 'node:fs/promises';
import { Provider } from '../server/provider.mjs';
import { build, run } from '../server/feature.mjs';
import { support } from '../server/support.mjs';
const provider = new Provider();
try {
  const before = provider.budget(), index = await build(provider), runs = [];
  for (const ticket of support.tickets) runs.push(await run(provider, { ticket: ticket.id, question: 'Почему не работает авторизация? Что мне сделать?' }));
  await mkdir(new URL('../results/', import.meta.url), { recursive: true });
  await writeFile(new URL('../results/experiment.json', import.meta.url), JSON.stringify({ executedAt: new Date().toISOString(), kind: 'real-cloud-on-synthetic-tickets', before, after: provider.budget(), index, runs }, null, 2) + '\n');
  console.log(JSON.stringify({ tickets: runs.map(r => r.ticketId), budget: provider.budget() }));
} finally { provider.close(); }
