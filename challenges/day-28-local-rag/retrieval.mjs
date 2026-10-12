import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

export const index = JSON.parse(gunzipSync(await readFile(new URL('./data/index.json.gz', import.meta.url))));
export const questions = JSON.parse(await readFile(new URL('./data/questions.json', import.meta.url), 'utf8'));
const stop = new Set('это этот эта эти того тому которой которые также чтобы если при для или как что где когда уже есть был была быть его её они она оно вам вам мы вы они их из на по от до о об в к с со у не ни но да же ли бы как'.split(' '));
function tokens(value) { return value.toLocaleLowerCase('ru').match(/[а-яёa-z0-9]{3,}/giu)?.filter(w => !stop.has(w)) || []; }
export const chunks = index.chunks.filter(c => c.strategy === 'fixed').map(c => ({ ...c, terms: tokens(`${c.title} ${c.section} ${c.text}`) }));
export function retrieve(query, limit = 5) {
  const terms = [...new Set(tokens(query))]; const scored = chunks.map(c => {
    let score = 0; for (const term of terms) { const prefix = term.slice(0, Math.min(5, term.length)); const frequency = c.terms.filter(t => t === term || t.startsWith(prefix)).length; if (frequency) score += (1 + Math.log(frequency)) * Math.log(1 + chunks.length / (1 + chunks.filter(other => other.terms.includes(term)).length)); }
    return { ...c, score };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return scored.map(({ terms: _terms, vector: _vector, ...c }, i) => ({ rank: i + 1, score: Number(c.score.toFixed(3)), source: c.source, title: c.title, section: c.section, chunk_id: c.chunk_id, text: c.text }));
}
