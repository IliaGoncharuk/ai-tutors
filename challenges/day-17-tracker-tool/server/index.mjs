import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serve } from './http.mjs';
import { McpConnection } from './mcp-client.mjs';
import { DAY, PORT, TITLE } from './config.mjs';
import { Store } from './store.mjs';
import { Budget, runAgent, requests } from './agent.mjs';
import { trackerConfig } from './tracker.mjs';
import { PublicError } from './domain.mjs';

export function childEnvironment(source) {
  const config = trackerConfig();
  return { TRACKER_SOURCE: source, ...(source === 'live' ? {
    ...(config.token ? { YANDEX_TRACKER_TOKEN: config.token } : {}),
    ...(config.org ? { YANDEX_TRACKER_ORG_ID: config.org } : {}),
    ...(config.cloudOrg ? { YANDEX_TRACKER_CLOUD_ORG_ID: config.cloudOrg } : {}),
  } : {}) };
}
export async function createApp({ port = Number(process.env.PORT ?? PORT), production, directory, budgetDirectory, responder } = {}) {
  const store = new Store(directory); const budget = new Budget(budgetDirectory ? new Store(budgetDirectory) : store);
  const unlock = store.lock();
  let source = 'demo', connection = new McpConnection({ env: childEnvironment(source) }), busy = false, last = null;
  const view = () => ({ day: DAY, title: TITLE, source, busy, connection: connection.view(), last, requests, budget: budget.view(), hasTracker: Boolean(trackerConfig().token && (trackerConfig().org || trackerConfig().cloudOrg)), hasOpenAI: Boolean(process.env.OPENAI_API_KEY), dataDirectory: store.directory });
  const web = await serve({ root: fileURLToPath(new URL('../', import.meta.url)), port, production, route: async (method, path, body) => {
    if (method === 'GET' && path === '/api/state') return view();
    if (method !== 'POST' || !['/api/connect', '/api/disconnect', '/api/run', '/api/source'].includes(path)) return { status: 404, body: { error: 'Маршрут не найден.' } };
    if (busy) return { status: 409, body: { error: 'Дождитесь текущего действия.' } };
    busy = true;
    try {
      if (path === '/api/source') {
        if (!['demo', 'live'].includes(body.source)) throw new PublicError('Неизвестный источник.');
        await connection.close(); source = body.source; connection = new McpConnection({ env: childEnvironment(source) }); last = null;
      }
      if (path === '/api/connect') await connection.connect();
      if (path === '/api/disconnect') await connection.close();
      if (path === '/api/run') {
        await connection.connect();
        last = await runAgent({ request: body.request, mode: body.mode, connection, budget, responder });
        store.write(`last-${source}.json`, last);
      }
      return view();
    } finally { busy = false; }
  } }).catch(error => { unlock(); throw error; });
  return { ...web, close: async () => { await web.close(); await connection.close(); unlock(); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp(); console.log(`День ${DAY}: http://127.0.0.1:${app.port}`);
  let stopping = false; const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
