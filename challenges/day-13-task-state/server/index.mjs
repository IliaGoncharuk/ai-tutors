import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createInitialState, view, applyAction, ask, compare, compareProfiles, generateWorkflow, buildContext, InputError } from './core.mjs';
import { Repository } from './store.mjs';
import { liveGenerator } from './provider.mjs';
import { DAY, MODEL, PORT } from './config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function createServer({ directory = process.env.MEMORY_DATA_DIR ?? join(homedir(), '.ai-tutors', `memory-lab-day-${DAY}`), port = Number(process.env.PORT ?? PORT), generator, production = process.env.NODE_ENV === 'production' } = {}) {
  directory = resolve(directory); mkdirSync(directory, { recursive: true });
  const lock = join(directory, '.server.lock');
  try { const fd = openSync(lock, 'wx'); closeSync(fd); } catch {
    throw new Error(`Каталог данных уже занят либо остался lock после аварии: ${lock}. Остановите другой сервер перед удалением lock.`);
  }
  const repository = new Repository(directory);
  let state, vite;
  try {
    state = repository.read() ?? createInitialState();
    if (!repository.read()) repository.write(state);
    if (!production) { const { createServer: createVite } = await import('vite'); vite = await createVite({ root, server: { middlewareMode: true, hmr: false }, appType: 'spa' }); }
  } catch (e) { unlinkSync(lock); throw e; }
  const runtime = { model: MODEL, hasApiKey: Boolean(process.env.OPENAI_API_KEY) || Boolean(generator), dataDirectory: directory };
  const generate = generator ?? liveGenerator();
  let busy = false;
  const server = http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      let url; try { url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`); } catch { throw new InputError('Некорректный URL.', 400); }
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host ?? '')) throw new InputError('Разрешены только локальные запросы.', 403);
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && url.pathname === '/api/health') return json(200, { ok: true, day: DAY });
        if (req.method === 'GET' && url.pathname === '/api/state') return json(200, view(state, runtime));
        if (req.method !== 'POST') throw new InputError('Маршрут не найден.', 404);
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new InputError('Запрос с другого сайта отклонён.', 403);
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new InputError('Нужен Content-Type application/json.', 415);
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 32000) throw new InputError('Запрос слишком большой.', 413); chunks.push(chunk); }
        const raw = Buffer.concat(chunks).toString('utf8');
        let body; try { body = JSON.parse(raw); } catch { throw new InputError('Некорректный JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Нужен объект запроса.');
        if (url.pathname === '/api/context') return json(200, buildContext(state, body.message, body.layers));
        if (!['/api/action', '/api/chat', '/api/compare', '/api/profiles/compare', '/api/workflow'].includes(url.pathname)) throw new InputError('Маршрут не найден.', 404);
        if (busy) throw new InputError('Дождитесь завершения текущего запроса.', 409);
        busy = true;
        try {
          let output;
          if (url.pathname === '/api/action') output = { state: applyAction(state, body) };
          else { if (!['live', 'demo'].includes(body.mode)) throw new InputError('Выберите live или demo.'); output = await (url.pathname === '/api/chat' ? ask : url.pathname === '/api/profiles/compare' ? compareProfiles : url.pathname === '/api/workflow' ? generateWorkflow : compare)(state, body, body.mode === 'live' ? generate : undefined); }
          repository.write(output.state); state = output.state;
          return json(200, url.pathname === '/api/action' ? view(state, runtime) : { ...output, state: view(state, runtime) });
        } finally { busy = false; }
      }
      if (vite) return vite.middlewares(req, res, () => { res.writeHead(404); res.end(); });
      const dist = join(root, 'dist'), requested = resolve(dist, '.' + decodeURIComponent(url.pathname));
      if (!requested.startsWith(dist + sep) && requested !== dist) throw new InputError('Неверный путь.', 403);
      let file = requested; try { if (!(await stat(file)).isFile()) file = join(dist, 'index.html'); } catch { file = join(dist, 'index.html'); }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file));
    } catch (error) { if (!res.headersSent) json(error.status ?? 500, { error: error instanceof InputError ? error.message : 'Не удалось обработать запрос. Проверьте доступ к каталогу памяти.' }); else res.end(); }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); }).catch(async e => { await vite?.close(); unlinkSync(lock); throw e; });
  return { server, port: server.address().port, close: async () => { await vite?.close(); await new Promise(done => server.close(done)); try { unlinkSync(lock); } catch {} } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createServer();
  console.log(`День ${DAY}: http://127.0.0.1:${app.port}`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
