import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DAY, TITLE, SUBTITLE, EXAMPLES } from './config.mjs';
import { Provider, PublicError, assert } from './provider.mjs';
import { build, run, featureState } from './feature.mjs';
const publicDirectory = new URL('../public/', import.meta.url);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
export function createApp(provider = new Provider()) {
  let busy = false;
  const server = createServer(async (req, res) => {
    try {
      const host = new URL(`http://${req.headers.host || 'localhost'}`);
      assert(['localhost', '127.0.0.1', '[::1]'].includes(host.hostname), 'Недопустимый Host.');
      if (req.headers.origin) assert(req.headers.origin === host.origin, 'Запрос с другого сайта запрещён.');
      const url = new URL(req.url, host);
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const index = provider.get('index');
        return json(res, 200, { day: DAY, title: TITLE, subtitle: SUBTITLE, examples: EXAMPLES, cloudConfigured: Boolean(process.env.OPENAI_API_KEY), budget: provider.budget(), busy,
          index: index ? { documents: index.documents.length, chunks: index.chunks.length, createdAt: index.createdAt } : null, latest: provider.get('latest'), ...await featureState(provider) });
      }
      if (req.method === 'GET' && url.pathname === '/api/example') {
        let data; try { data = JSON.parse(await readFile(new URL('../results/experiment.json', import.meta.url), 'utf8')); } catch { throw new PublicError('Сохранённого примера пока нет.'); }
        return json(res, 200, data);
      }
      if (req.method === 'POST' && ['/api/index', '/api/run'].includes(url.pathname)) {
        assert(!busy, 'Другой запрос ещё выполняется.'); assert(req.headers['content-type']?.startsWith('application/json'), 'Нужен application/json.');
        busy = true;
        try {
          let raw = ''; for await (const part of req) { raw += part; assert(Buffer.byteLength(raw) <= 150000, 'Запрос слишком большой.'); }
          let body; try { body = JSON.parse(raw || '{}'); } catch { throw new PublicError('Неверный JSON.'); }
          assert(body && typeof body === 'object' && !Array.isArray(body), 'Нужен JSON-объект.');
          const result = url.pathname === '/api/index' ? await build(provider) : await run(provider, body);
          if (url.pathname === '/api/run') provider.set('latest', result);
          return json(res, 200, { result, budget: provider.budget() });
        } finally { busy = false; }
      }
      const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method === 'GET' && Object.hasOwn(staticFiles, url.pathname)) {
        const [name, type] = staticFiles[url.pathname]; const content = await readFile(new URL(name, publicDirectory));
        res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" }); return res.end(content);
      }
      json(res, 404, { error: 'Маршрут не найден.' });
    } catch (error) { if (!res.headersSent) json(res, error instanceof PublicError ? 400 : 500, { error: error instanceof PublicError ? error.message : 'Операция не выполнена. Проверьте доступность Git и рабочей папки.' }); else res.end(); }
  });
  server.on('close', () => provider.close()); return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createApp(); const port = Number(process.env.PORT || 3000 + DAY);
  server.listen(port, '127.0.0.1', () => console.log(`День ${DAY}: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
