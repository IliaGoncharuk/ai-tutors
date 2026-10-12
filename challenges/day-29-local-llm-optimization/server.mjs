import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 3029), lmBase = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234').replace(/\/$/, '');
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
async function readBody(req) { let raw = ''; for await (const part of req) { raw += part; if (raw.length > 24_000) throw new Error('Запрос слишком большой.'); } return JSON.parse(raw || '{}'); }
async function lm(path, init = {}) { const r = await fetch(`${lmBase}${path}`, { ...init, signal: AbortSignal.timeout(180_000), headers: { 'content-type': 'application/json', ...(process.env.LM_STUDIO_TOKEN ? { authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` } : {}), ...init.headers } }); const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error?.message || `LM Studio вернул HTTP ${r.status}.`); return data; }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/status' && req.method === 'GET') { try { const data = await lm('/api/v1/models'); const models = (data.models || []).filter(m => m.type === 'llm' && m.loaded_instances?.length).map(m => ({ id: m.key, name: m.display_name, quantization: m.quantization?.name || null })); return json(res, 200, { available: true, models }); } catch (e) { return json(res, 200, { available: false, message: e.message, models: [] }); } }
    if (url.pathname === '/api/run' && req.method === 'POST') {
      const input = await readBody(req); const cfg = input.config;
      if (!cfg || typeof cfg.model !== 'string' || cfg.model.length > 200 || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 3000 || typeof cfg.instruction !== 'string' || cfg.instruction.length > 2000 || !Number.isFinite(cfg.temperature) || cfg.temperature < 0 || cfg.temperature > 1 || !Number.isInteger(cfg.maxOutputTokens) || cfg.maxOutputTokens < 16 || cfg.maxOutputTokens > 1500 || !Number.isInteger(cfg.contextLength) || cfg.contextLength < 512 || cfg.contextLength > 131072 || Math.ceil((input.question.length + cfg.instruction.length) / 3) + cfg.maxOutputTokens > cfg.contextLength) return json(res, 400, { error: 'Проверьте модель и параметры: ввод и лимит ответа должны помещаться в выбранный контекст.' });
      const started = performance.now(); const data = await lm('/api/v1/chat', { method: 'POST', body: JSON.stringify({ model: cfg.model, input: input.question, system_prompt: cfg.instruction, temperature: cfg.temperature, max_output_tokens: cfg.maxOutputTokens, context_length: cfg.contextLength, store: false }) });
      const answer = (data.output || []).filter(x => x.type === 'message').map(x => x.content).join('\n');
      return json(res, 200, { answer, model: data.model_instance_id || cfg.model, elapsedMs: Math.round(performance.now() - started), stats: data.stats || {}, contextLength: cfg.contextLength, settings: cfg });
    }
    const file = resolve(publicDir, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''))), rel = relative(publicDir, file); if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return json(res, 404, { error: 'Файл не найден.' }); const content = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(content);
  } catch (error) { json(res, 502, { error: error.message || 'Не удалось выполнить запрос.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`День 29: http://127.0.0.1:${port}`));
