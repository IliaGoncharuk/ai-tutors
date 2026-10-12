import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 3027);
const lmBase = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234').replace(/\/$/, '');
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
async function readBody(req) { let raw = ''; for await (const part of req) { raw += part; if (raw.length > 96_000) throw new Error('Запрос слишком большой.'); } return JSON.parse(raw || '{}'); }
async function lm(path, init = {}) {
  const response = await fetch(`${lmBase}${path}`, { ...init, signal: AbortSignal.timeout(120_000), headers: { 'content-type': 'application/json', ...(process.env.LM_STUDIO_TOKEN ? { authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error?.message || `LM Studio вернул HTTP ${response.status}.`); return data;
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/models' && req.method === 'GET') { try { const data = await lm('/api/v1/models'); const models = (data.models || []).filter(m => m.type === 'llm' && m.loaded_instances?.length).map(m => ({ id: m.key, name: m.display_name, quantization: m.quantization?.name || null })); return json(res, 200, { available: true, models }); } catch (e) { return json(res, 200, { available: false, message: e.message, models: [] }); } }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const input = await readBody(req);
      if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 40 || input.messages.some(m => !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') || input.messages.reduce((n, m) => n + m.content.length, 0) > 12_000) return json(res, 400, { error: 'Проверьте историю: до 40 текстовых реплик и не более 12 000 символов за запрос.' });
      const messages = [{ role: 'system', content: 'Отвечай по-русски ясно и кратко. Точно соблюдай числовые ограничения пользователя. Если составляешь расписание, проверь, что длительности всех этапов вместе с перерывами укладываются в заданное общее время.' }, ...input.messages];
      const data = await lm('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: input.model || 'local-model', messages, temperature: 0.4, max_tokens: 1000 }) });
      return json(res, 200, { answer: data.choices?.[0]?.message?.content || '', model: data.model || input.model || 'локальная модель', finishReason: data.choices?.[0]?.finish_reason || null, usage: data.usage || null });
    }
    const file = resolve(publicDir, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''))), rel = relative(publicDir, file);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return json(res, 404, { error: 'Файл не найден.' });
    const content = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(content);
  } catch (error) { json(res, 502, { error: error.message || 'Не удалось выполнить запрос.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`День 27: http://127.0.0.1:${port}`));
