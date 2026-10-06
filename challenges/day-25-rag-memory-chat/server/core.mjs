import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { DAY, EMBEDDING_MODEL, DIMENSIONS } from './config.mjs';

export class PublicError extends Error { get publicMessage() { return this.message; } }
export const hash = text => createHash('sha256').update(text).digest('hex');
export const corpus = JSON.parse(readFileSync(new URL('../data/corpus.json', import.meta.url), 'utf8'));
export const questions = JSON.parse(readFileSync(new URL('../data/questions.json', import.meta.url), 'utf8'));
export const fingerprint = hash(JSON.stringify(corpus));
export const rootDirectory = () => process.env.RAG_DATA_DIR || join(homedir(), '.ai-tutors', 'rag-campaign');
export const words = text => text.match(/\S+/gu)?.length ?? 0;

// Offsets refer to the frozen, LF-normalized source text, not a rendered page.
export function chunkDocument(doc, strategy, size = 1800, overlap = 200) {
  if (!['fixed', 'structure'].includes(strategy) || !Number.isInteger(size) || size < 100 || size > 6000 || !Number.isInteger(overlap) || overlap < 0 || overlap >= size) throw new PublicError('Неверные параметры разбиения.');
  const headers = []; let fence = null;
  for (const line of doc.text.matchAll(/^.*$/gm)) {
    const marker = line[0].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null; continue; }
    if (!fence && /^#{1,6} .+$/.test(line[0])) headers.push({ start: line.index, title: line[0].replace(/^#+ /, '') });
  }
  const sections = strategy === 'structure' ? [...new Set([0, ...headers.map(h => h.start), doc.text.length])] : [0, doc.text.length];
  const result = [];
  for (let s = 0; s < sections.length - 1; s++) {
    for (let start = sections[s]; start < sections[s + 1]; start += size - overlap) {
      const end = Math.min(start + size, sections[s + 1]);
      const text = doc.text.slice(start, end);
      if (text.trim()) result.push({ source: doc.source, title: doc.title, section: headers.filter(h => h.start <= start).at(-1)?.title ?? doc.title, chunk_id: `${strategy}-${hash(`${doc.source}:${start}:${end}:${text}`).slice(0, 16)}`, strategy, start, end, text });
      if (end === sections[s + 1]) break;
    }
  }
  return result;
}
export const makeChunks = strategy => corpus.flatMap(doc => chunkDocument(doc, strategy));
export const embeddingText = chunk => `${chunk.title}\n${chunk.section}\n${chunk.text}`;
export function cosine(a, b) {
  if (a.length !== b.length || !a.length) throw new PublicError('Размерности эмбеддингов не совпадают.');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export function validateVector(vector) {
  if (!Array.isArray(vector) || vector.length !== DIMENSIONS || !vector.every(Number.isFinite) || !vector.some(x => x !== 0)) throw new PublicError('API вернул некорректный эмбеддинг.');
  return vector;
}
export class Store {
  constructor(directory = rootDirectory()) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, `day-${DAY}.sqlite`));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS indexes(strategy TEXT PRIMARY KEY, fingerprint TEXT, model TEXT, dimensions INTEGER); CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY, strategy TEXT, data TEXT, vector TEXT); CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, data TEXT);');
    const artifact = new URL('../data/index.json.gz', import.meta.url);
    if (!this.db.prepare('SELECT 1 FROM indexes LIMIT 1').get() && existsSync(artifact)) {
      const saved = JSON.parse(gunzipSync(readFileSync(artifact)));
      if (saved.fingerprint === fingerprint && saved.model === EMBEDDING_MODEL && saved.dimensions === DIMENSIONS) {
        for (const strategy of ['fixed', 'structure']) this.replace(strategy, saved.chunks.filter(c => c.strategy === strategy));
      }
    }
  }
  replace(strategy, chunks) {
    for (const c of chunks) validateVector(c.vector);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM chunks WHERE strategy=?').run(strategy);
      const insert = this.db.prepare('INSERT INTO chunks VALUES(?,?,?,?)');
      for (const { vector, ...c } of chunks) insert.run(c.chunk_id, strategy, JSON.stringify(c), JSON.stringify(vector));
      this.db.prepare('INSERT OR REPLACE INTO indexes VALUES(?,?,?,?)').run(strategy, fingerprint, EMBEDDING_MODEL, DIMENSIONS);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  chunks(strategy) {
    const meta = this.db.prepare('SELECT * FROM indexes WHERE strategy=?').get(strategy);
    if (!meta || meta.fingerprint !== fingerprint || meta.model !== EMBEDDING_MODEL || meta.dimensions !== DIMENSIONS) throw new PublicError('Сначала постройте индекс для выбранной стратегии.');
    return this.db.prepare('SELECT data,vector FROM chunks WHERE strategy=? ORDER BY rowid').all(strategy).map(r => ({ ...JSON.parse(r.data), vector: JSON.parse(r.vector) }));
  }
  status() { return ['fixed', 'structure'].map(strategy => { try { return { strategy, ready: true, count: this.chunks(strategy).length }; } catch { return { strategy, ready: false, count: makeChunks(strategy).length }; } }); }
  get(id, fallback = null) { const row = this.db.prepare('SELECT data FROM records WHERE id=?').get(id); return row ? JSON.parse(row.data) : fallback; }
  set(id, value) { this.db.prepare('INSERT OR REPLACE INTO records VALUES(?,?)').run(id, JSON.stringify(value)); }
  close() { this.db.close(); }
}

// One SQLite ledger is shared by all five apps; reservations survive crashes.
export class Provider {
  constructor(directory = rootDirectory(), transport = fetch) {
    mkdirSync(directory, { recursive: true }); this.transport = transport;
    this.db = new DatabaseSync(join(directory, 'campaign.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, kind TEXT, reserve REAL, cost REAL, input INTEGER, output INTEGER); CREATE TABLE IF NOT EXISTS embeddings(id TEXT PRIMARY KEY, vector TEXT);');
  }
  budget() {
    return { ...this.db.prepare('SELECT COUNT(*) AS calls, COALESCE(SUM(cost),0) AS spent, COALESCE(SUM(reserve),0) AS reserved, COALESCE(SUM(input),0) AS inputTokens, COALESCE(SUM(output),0) AS outputTokens FROM calls').get(), limit: 1 };
  }
  reserve(kind, amount) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const b = this.budget();
      if (b.spent + b.reserved + amount > 1) throw new PublicError('Общий лимит серии $1 исчерпан. Запрос не отправлен.');
      const id = randomUUID(); this.db.prepare('INSERT INTO calls VALUES(?,?,?,0,0,0)').run(id, kind, amount); this.db.exec('COMMIT'); return id;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  async call(kind, payload) {
    if (!process.env.OPENAI_API_KEY) throw new PublicError('Нужен OPENAI_API_KEY в окружении сервера. Сохранённые результаты доступны без ключа.');
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (bytes > 180000) throw new PublicError('Контекст слишком велик: сократите запрос.');
    // A UTF-8 byte upper-bounds BPE tokens; conservative cache-write input tariff.
    const reserve = kind === 'embeddings' ? bytes * .02 / 1e6 : (bytes * .25 + (payload.max_output_tokens ?? 1600) * 1.2) / 1e6;
    const id = this.reserve(kind, reserve);
    let response;
    try { response = await this.transport(`https://api.openai.com/v1/${kind}`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60000) }); }
    catch { throw new PublicError('Нет ответа OpenAI. Резерв сохранён; автоматических повторов нет.'); }
    if (!response.ok) throw new PublicError(`OpenAI вернул HTTP ${response.status}. Резерв сохранён; ключ и ответ сервера не выводятся.`);
    const data = await response.json();
    const input = kind === 'embeddings' ? data.usage?.prompt_tokens : data.usage?.input_tokens;
    const output = kind === 'embeddings' ? 0 : data.usage?.output_tokens;
    if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) throw new PublicError('Нет достоверной статистики расхода. Резерв сохранён.');
    const cost = (input * (kind === 'embeddings' ? .02 : .25) + output * 1.2) / 1e6;
    this.db.prepare('UPDATE calls SET reserve=0,cost=?,input=?,output=? WHERE id=?').run(cost, input, output, id);
    return data;
  }
  async embed(texts) {
    const vectors = texts.map(t => { const hit = this.db.prepare('SELECT vector FROM embeddings WHERE id=?').get(hash(`${EMBEDDING_MODEL}:${DIMENSIONS}:${t}`)); return hit ? validateVector(JSON.parse(hit.vector)) : null; });
    const missing = texts.map((text, i) => ({ text, i })).filter(x => !vectors[x.i]);
    for (let offset = 0; offset < missing.length; offset += 12) {
      const batch = missing.slice(offset, offset + 12);
      const data = await this.call('embeddings', { model: EMBEDDING_MODEL, dimensions: DIMENSIONS, input: batch.map(x => x.text), encoding_format: 'float' });
      if (!Array.isArray(data.data) || data.data.length !== batch.length || new Set(data.data.map(x => x.index)).size !== batch.length) throw new PublicError('Неполный ответ эмбеддингов.');
      for (const item of data.data) {
        if (!Number.isInteger(item.index) || !batch[item.index]) throw new PublicError('Неверный порядок эмбеддингов.');
        const entry = batch[item.index], vector = validateVector(item.embedding);
        vectors[entry.i] = vector;
        this.db.prepare('INSERT OR REPLACE INTO embeddings VALUES(?,?)').run(hash(`${EMBEDDING_MODEL}:${DIMENSIONS}:${entry.text}`), JSON.stringify(vector));
      }
    }
    return vectors;
  }
  close() { this.db.close(); }
}
export async function buildIndex(store, provider, strategy) {
  const chunks = makeChunks(strategy), vectors = await provider.embed(chunks.map(embeddingText));
  store.replace(strategy, chunks.map((c, i) => ({ ...c, vector: vectors[i] })));
  return store.status();
}
export async function search(store, provider, question, strategy = 'structure', k = 5) {
  if (typeof question !== 'string' || !question.trim() || question.length > 2000) throw new PublicError('Введите вопрос длиной от 1 до 2000 символов.');
  if (!Number.isInteger(k) || k < 1 || k > 20) throw new PublicError('K должен быть от 1 до 20.');
  const chunks = store.chunks(strategy), [query] = await provider.embed([question]);
  return chunks.map(({ vector, ...c }) => ({ ...c, score: cosine(query, vector) })).sort((a, b) => b.score - a.score || a.chunk_id.localeCompare(b.chunk_id)).slice(0, k);
}
