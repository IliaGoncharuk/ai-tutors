import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serve } from './http.mjs';
import { McpConnection } from './mcp-client.mjs';
import { DAY, PORT, TITLE } from './config.mjs';

export async function createApp({ port = Number(process.env.PORT ?? PORT), production } = {}) {
  const connection = new McpConnection(); let busy = false;
  const view = () => ({ day: DAY, title: TITLE, ...connection.view(), busy });
  const web = await serve({ root: fileURLToPath(new URL('../', import.meta.url)), port, production, route: async (method, path) => {
    if (method === 'GET' && path === '/api/state') return view();
    if (method !== 'POST' || !['/api/connect', '/api/disconnect', '/api/tools'].includes(path)) return { status: 404, body: { error: 'Маршрут не найден.' } };
    if (busy) return { status: 409, body: { error: 'Дождитесь текущего действия.' } };
    busy = true;
    try {
      if (path === '/api/connect') await connection.connect();
      if (path === '/api/disconnect') await connection.close();
      if (path === '/api/tools') await connection.list();
      return view();
    } catch (error) { error.publicMessage = error.message; throw error; }
    finally { busy = false; }
  } });
  return { ...web, close: async () => { await web.close(); await connection.close(); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  console.log(`День ${DAY}: http://127.0.0.1:${app.port}`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
