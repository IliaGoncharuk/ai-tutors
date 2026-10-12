import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { index, questions, chunks, retrieve } from './retrieval.mjs';

const port = Number(process.env.PORT || 3028), lmBase = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234').replace(/\/$/, '');
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
async function readBody(req) { let raw = ''; for await (const part of req) { raw += part; if (raw.length > 96_000) throw new Error('Запрос слишком большой.'); } return JSON.parse(raw || '{}'); }
async function lm(path, init = {}) { const r = await fetch(`${lmBase}${path}`, { ...init, signal: AbortSignal.timeout(120_000), headers: { 'content-type': 'application/json', ...(process.env.LM_STUDIO_TOKEN ? { authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` } : {}), ...init.headers } }); const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error?.message || `LM Studio вернул HTTP ${r.status}.`); return data; }
async function generateLocal(model, question, context) {
  const started = performance.now(); const data = await lm('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model, temperature: 0.2, max_tokens: 700, messages: [{ role: 'system', content: 'Отвечай по-русски, используя только фрагменты контекста. Если сведений недостаточно, скажи об этом. В конце укажи источники в формате [source#chunk_id].' }, { role: 'user', content: `Контекст:\n${context}\n\nВопрос: ${question}` }] }) });
  return { answer: data.choices?.[0]?.message?.content || '', model: data.model || model, elapsedMs: Math.round(performance.now() - started), usage: data.usage || null };
}
async function generateCloud(question, context) {
  const key = process.env.OPENAI_API_KEY; if (!key) throw new Error('Серверу не задан OPENAI_API_KEY; облачный вызов не отправлен.');
  const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna'; const started = performance.now();
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(120_000), headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, temperature: 1, max_completion_tokens: 700, messages: [{ role: 'developer', content: 'Отвечай по-русски, используя только фрагменты контекста. Если сведений недостаточно, скажи об этом. В конце укажи источники в формате [source#chunk_id].' }, { role: 'user', content: `Контекст:\n${context}\n\nВопрос: ${question}` }] }) });
  const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error?.message || `Облачный API вернул HTTP ${r.status}.`);
  return { answer: data.choices?.[0]?.message?.content || '', model: data.model || model, elapsedMs: Math.round(performance.now() - started), usage: data.usage || null };
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/status' && req.method === 'GET') { try { const data = await lm('/api/v1/models'); const models = (data.models || []).filter(m => m.type === 'llm' && m.loaded_instances?.length).map(m => ({ id: m.key, name: m.display_name, quantization: m.quantization?.name || null })); return json(res, 200, { localAvailable: true, models, questions, corpusFingerprint: index.fingerprint, chunks: chunks.length, cloudConfigured: Boolean(process.env.OPENAI_API_KEY) }); } catch (e) { return json(res, 200, { localAvailable: false, message: e.message, models: [], questions, corpusFingerprint: index.fingerprint, chunks: chunks.length, cloudConfigured: Boolean(process.env.OPENAI_API_KEY) }); } }
    if (url.pathname === '/api/retrieve' && req.method === 'POST') { const input = await readBody(req); if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > 3000) return json(res, 400, { error: 'Введите вопрос длиной до 3 000 символов.' }); const start = performance.now(), results = retrieve(input.question); return json(res, 200, { results, elapsedMs: Math.round(performance.now() - start), method: 'BM25-подобный поиск по тексту, локально' }); }
    if (url.pathname === '/api/generate' && req.method === 'POST') { const input = await readBody(req); if (typeof input.question !== 'string' || input.question.length > 3000 || !Array.isArray(input.results) || input.results.length > 5) return json(res, 400, { error: 'Некорректный вопрос или число фрагментов.' }); const context = input.results.map(c => `[${c.source}#${c.chunk_id}] ${c.title} / ${c.section}\n${c.text}`).join('\n\n'); const answer = input.provider === 'cloud' ? await generateCloud(input.question, context) : await generateLocal(input.model || 'local-model', input.question, context); return json(res, 200, { ...answer, provider: input.provider === 'cloud' ? 'cloud' : 'local' }); }
    const file = resolve(publicDir, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''))), rel = relative(publicDir, file); if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return json(res, 404, { error: 'Файл не найден.' }); const content = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(content);
  } catch (error) { json(res, 502, { error: error.message || 'Не удалось выполнить запрос.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`День 28: http://127.0.0.1:${port} · индекс ${index.fingerprint}`));
