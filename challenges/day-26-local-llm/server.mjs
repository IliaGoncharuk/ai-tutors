import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 3026);
const lmBase = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234').replace(/\/$/, '');
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
async function body(req) {
  let raw = ''; for await (const part of req) { raw += part; if (raw.length > 64_000) throw new Error('Запрос слишком большой.'); }
  return JSON.parse(raw || '{}');
}
async function lm(path, init = {}) {
  const response = await fetch(`${lmBase}${path}`, { ...init, signal: AbortSignal.timeout(120_000), headers: { 'content-type': 'application/json', ...(process.env.LM_STUDIO_TOKEN ? { authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` } : {}), ...init.headers } });
  if (!response.ok) throw new Error(`LM Studio вернул HTTP ${response.status}.`);
  return response.json();
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/status' && req.method === 'GET') {
      try { const data = await lm('/api/v1/models'); const models = (data.models || []).filter(m => m.type === 'llm' && m.loaded_instances?.length).map(m => ({ id: m.key, name: m.display_name, quantization: m.quantization?.name || null })); return json(res, 200, { ok: true, models }); }
      catch (error) { return json(res, 200, { ok: false, error: error.message, models: [] }); }
    }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const input = await body(req);
      if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 12_000) return json(res, 400, { error: 'Введите запрос до 12 000 символов.' });
      const started = performance.now();
      const data = await lm('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: input.model || 'local-model', messages: [{ role: 'user', content: input.prompt }], temperature: 0.7, max_tokens: 500 }) });
      return json(res, 200, { answer: data.choices?.[0]?.message?.content || '', elapsedMs: Math.round(performance.now() - started), usage: data.usage || null, model: data.model || input.model || 'локальная модель' });
    }
    const file = resolve(publicDir, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '')));
    const rel = relative(publicDir, file); if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return json(res, 404, { error: 'Файл не найден.' });
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(content);
  } catch (error) { json(res, 502, { error: error.message || 'Не удалось выполнить запрос.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`День 26: http://127.0.0.1:${port}`));
