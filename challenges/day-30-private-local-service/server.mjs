import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 3030), host = process.env.HOST || '0.0.0.0';
const lmBase = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234').replace(/\/$/, ''), serviceToken = process.env.DAY30_SERVICE_TOKEN || '';
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const maxContextChars = 12_000, maxOutputTokens = 512, maxConcurrent = 2, maxPerMinute = 12, contextTokens = Math.max(1024, Math.min(131072, Math.trunc(Number(process.env.SERVICE_CONTEXT_TOKENS) || 8192)));
const activeByIp = new Map(), requestsByIp = new Map();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
async function readBody(req) { let raw = ''; for await (const part of req) { raw += part; if (raw.length > 48_000) throw new Error('Запрос слишком большой.'); } return JSON.parse(raw || '{}'); }
function authorized(req) { if (!serviceToken || serviceToken.length < 24) return false; const value = req.headers.authorization?.replace(/^Bearer\s+/i, '') || ''; const a = Buffer.from(value), b = Buffer.from(serviceToken); return a.length === b.length && timingSafeEqual(a, b); }
async function lm(path, init = {}) { const r = await fetch(`${lmBase}${path}`, { ...init, signal: AbortSignal.timeout(120_000), headers: { 'content-type': 'application/json', ...(process.env.LM_STUDIO_TOKEN ? { authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` } : {}), ...init.headers } }); const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error?.message || `LM Studio вернул HTTP ${r.status}.`); return data; }
function clientIp(req) { return req.socket.remoteAddress || 'unknown'; }
function takeRate(ip) { const now = Date.now(), list = (requestsByIp.get(ip) || []).filter(t => now - t < 60_000); if (list.length >= maxPerMinute) return false; list.push(now); requestsByIp.set(ip, list); return true; }
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!serviceToken || serviceToken.length < 24) return json(res, 503, { error: 'Настройте DAY30_SERVICE_TOKEN (минимум 24 символа) перед использованием API.' });
      const ip = clientIp(req);
      if (!takeRate(ip)) return json(res, 429, { error: `Достигнут предел ${maxPerMinute} запросов в минуту.` });
      if (!authorized(req)) return json(res, 401, { error: 'Неверный токен доступа к сервису.' });
      if (url.pathname === '/api/status' && req.method === 'GET') { try { const data = await lm('/api/v1/models'); const models = (data.models || []).filter(m => m.type === 'llm' && m.loaded_instances?.length).map(m => ({ id: m.key, name: m.display_name, quantization: m.quantization?.name || null })); return json(res, 200, { available: true, models, limits: { maxContextChars, contextTokens, maxOutputTokens, maxConcurrent, maxPerMinute }, active: activeByIp.get(ip) || 0 }); } catch (e) { return json(res, 200, { available: false, message: e.message, models: [], limits: { maxContextChars, contextTokens, maxOutputTokens, maxConcurrent, maxPerMinute } }); } }
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        const messages = (await readBody(req)).messages;
        const characters = Array.isArray(messages) ? messages.reduce((n,m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0) : 0;
        if (!Array.isArray(messages) || !messages.length || messages.length > 20 || messages.some(m => !['user','assistant'].includes(m.role) || typeof m.content !== 'string') || characters > maxContextChars || Math.ceil(characters / 3) + maxOutputTokens > contextTokens) return json(res, 400, { error: `Контекст должен укладываться примерно в ${contextTokens} токенов и ${maxContextChars} символов; ответ ограничен ${maxOutputTokens} токенами.` });
        if ((activeByIp.get(ip) || 0) >= maxConcurrent) return json(res, 429, { error: `Одновременно обрабатывается максимум ${maxConcurrent} запроса.` });
        activeByIp.set(ip, (activeByIp.get(ip) || 0) + 1);
        try {
          const model = typeof messages.at(-1).model === 'string' ? messages.at(-1).model : '';
          const conversation = messages.map(m => `${m.role === 'user' ? 'Пользователь' : 'Помощник'}: ${m.content}`).join('\n\n');
          const started = performance.now(), data = await lm('/api/v1/chat', { method: 'POST', body: JSON.stringify({ model: model || 'local-model', input: conversation, system_prompt: 'Это приватный домашний сервис. Отвечай по-русски. Не подключай внешние инструменты.', context_length: contextTokens, max_output_tokens: maxOutputTokens, temperature: 0.4, store: false }) });
          const answer = (data.output || []).filter(x => x.type === 'message').map(x => x.content).join('\n');
          return json(res, 200, { answer, model: data.model_instance_id || model || 'локальная модель', elapsedMs: Math.round(performance.now() - started), usage: data.stats || null, limits: { maxContextChars, contextTokens, maxOutputTokens, maxConcurrent, maxPerMinute } });
        } finally { const n = activeByIp.get(ip) || 1; if (n <= 1) activeByIp.delete(ip); else activeByIp.set(ip, n - 1); }
      }
      return json(res, 404, { error: 'API-маршрут не найден.' });
    }
    const file = resolve(publicDir, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''))), rel = relative(publicDir, file); if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return json(res, 404, { error: 'Файл не найден.' }); const content = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' }); res.end(content);
  } catch (error) { json(res, 502, { error: error.message || 'Внутренняя ошибка сервиса.' }); }
});
server.listen(port, host, () => console.log(`День 30 слушает ${host}:${port}; LM Studio остаётся локальной: ${lmBase}`));
