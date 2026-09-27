import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';

export async function serve({ root, port, route, production = process.env.NODE_ENV === 'production' }) {
  let vite;
  if (!production) {
    const { createServer } = await import('vite');
    vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  }
  const server = http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host ?? '')) return json(403, { error: 'Разрешены только локальные запросы.' });
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: 'Запрос с другого сайта отклонён.' });
        let body = {};
        if (req.method === 'POST') {
          if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { error: 'Нужен JSON.' });
          let size = 0; const chunks = [];
          for await (const chunk of req) { size += chunk.length; if (size > 16000) return json(413, { error: 'Запрос слишком большой.' }); chunks.push(chunk); }
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(400, { error: 'Некорректный JSON.' }); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Нужен объект JSON.' });
        }
        const result = await route(req.method, url.pathname, body);
        return json(result?.status ?? 200, result?.body ?? result);
      }
      if (vite) return vite.middlewares(req, res, () => { res.writeHead(404); res.end(); });
      const dist = join(root, 'dist');
      let file = resolve(dist, '.' + decodeURIComponent(url.pathname));
      if (file !== dist && !file.startsWith(dist + sep)) return json(403, { error: 'Недопустимый путь.' });
      try { if (!(await stat(file)).isFile()) file = join(dist, 'index.html'); } catch { file = join(dist, 'index.html'); }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file));
    } catch (error) { if (!res.headersSent) json(400, { error: error.publicMessage ?? 'Не удалось выполнить действие. Проверьте состояние подключения.' }); else res.end(); }
  });
  try { await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); }); }
  catch (error) { await vite?.close(); throw error; }
  return { port: server.address().port, close: async () => { await vite?.close(); await new Promise(done => server.close(done)); } };
}
