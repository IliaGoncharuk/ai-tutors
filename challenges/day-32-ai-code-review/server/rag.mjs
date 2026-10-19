import { assert, hash } from './provider.mjs';
export function chunkDocuments(documents) {
  return documents.flatMap(doc => {
    const lines = doc.text.split('\n'), chunks = []; let text = '', start = 1, heading = '';
    const flush = end => { if (text.trim()) chunks.push({ source: doc.source, start, end, heading, text, id: hash(`${doc.source}:${start}:${text}`).slice(0, 14) }); text = ''; start = end + 1; };
    lines.forEach((line, i) => { if ((/^#{1,3} /.test(line) && text.length > 300) || text.length + line.length > 2200) flush(i); if (/^#{1,3} /.test(line)) heading = line.replace(/^#+ /, ''); if (!text) start = i + 1; text += `${line}\n`; }); flush(lines.length); return chunks;
  });
}
export function cosine(a, b) { assert(a.length === b.length && a.length > 0, 'Размерности векторов различаются.'); let dot = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; } return aa && bb ? dot / Math.sqrt(aa * bb) : 0; }
export async function indexDocuments(provider, documents) {
  const fingerprint = hash(JSON.stringify(documents)), cached = provider.get('index');
  if (cached?.fingerprint === fingerprint) return { ...cached, reused: true };
  const chunks = chunkDocuments(documents); assert(chunks.length > 0 && chunks.length <= 1500, 'Недопустимый размер корпуса.');
  const vectors = await provider.embed(chunks.map(c => `${c.source}\n${c.heading}\n${c.text}`));
  const index = { fingerprint, documents: documents.map(d => d.source), chunks: chunks.map((c, i) => ({ ...c, vector: vectors[i] })), createdAt: new Date().toISOString() };
  provider.set('index', index); return index;
}
export async function retrieve(provider, question, k = 6) {
  assert(typeof question === 'string' && question.trim() && question.length <= 3000, 'Введите вопрос длиной до 3000 символов.');
  const index = provider.get('index'); assert(index, 'Сначала постройте индекс кнопкой «Обновить базу».');
  const [query] = await provider.embed([question]);
  return index.chunks.map(({ vector, ...c }) => ({ ...c, score: cosine(query, vector) })).sort((a, b) => b.score - a.score).slice(0, k).map(c => ({ ...c, score: Number(c.score.toFixed(4)) }));
}
export function validateCitations(text, context) {
  const cited = [...new Set([...text.matchAll(/\[S(\d+)\]/g)].map(m => Number(m[1])))];
  assert(cited.every(i => i >= 1 && i <= context.length), 'Модель сослалась на отсутствующий источник.');
  return { cited, supported: cited.length > 0, note: 'Проверены номера источников. Это не доказательство верности каждого утверждения.' };
}
export const cite = context => context.map((c, i) => ({ label: `S${i + 1}`, ...c }));
