import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serve } from './http.mjs';
import { extension as ragExtension } from './chat.mjs';
import { DAY, TITLE, DESCRIPTION } from './config.mjs';
import { Store, Provider, corpus, questions, makeChunks, words, buildIndex, search, PublicError } from './core.mjs';

export async function createApp({ port = Number(process.env.PORT || 3000 + DAY), directory, production, extension = ragExtension } = {}) {
  const store = new Store(directory), provider = new Provider(directory); let busy = false;
  const reportFile = new URL('../results/experiment.json', import.meta.url);
  const state = () => ({ day: DAY, title: TITLE, description: DESCRIPTION, hasKey: Boolean(process.env.OPENAI_API_KEY), budget: provider.budget(), indexes: store.status(), documents: corpus.map(({ text, ...d }) => ({ ...d, words: words(text) })), words: corpus.reduce((sum, d) => sum + words(d.text), 0), questions, report: existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null, busy, ...(extension?.state?.(store) ?? {}) });
  try {
    const web = await serve({ root: fileURLToPath(new URL('../', import.meta.url)), port, production, route: async (method, path, body) => {
      if (method === 'GET' && path === '/api/state') return state();
      if (method !== 'POST') return { status: 404, body: { error: 'Маршрут не найден.' } };
      if (busy) throw new PublicError('Дождитесь завершения предыдущего действия.');
      busy = true;
      try {
        if (path === '/api/chunks') return makeChunks(body.strategy);
        if (path === '/api/build') { await buildIndex(store, provider, body.strategy); return state(); }
        if (path === '/api/search') return await search(store, provider, body.question, body.strategy, body.k ?? 5);
        if (extension) { const result = await extension.route({ path, body, store, provider }); if (result !== undefined) return result; }
        return { status: 404, body: { error: 'Маршрут не найден.' } };
      } finally { busy = false; }
    } });
    return { ...web, close: async () => { await web.close(); store.close(); provider.close(); } };
  } catch (error) { store.close(); provider.close(); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp(); console.log(`День ${DAY}: http://127.0.0.1:${app.port}`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
