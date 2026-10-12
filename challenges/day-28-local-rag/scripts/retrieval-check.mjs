import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { index, questions, retrieve } from '../retrieval.mjs';

const start = performance.now();
const cases = questions.map(q => {
  const before = performance.now(); const found = retrieve(q.question, 5); const elapsedMs = Number((performance.now() - before).toFixed(3));
  const matched = q.sources.filter(source => found.some(c => c.source === source));
  const keywordMatches = q.keywords.filter(term => found.some(c => c.text.toLocaleLowerCase('ru').includes(term.toLocaleLowerCase('ru'))));
  return { id: q.id, question: q.question, expectedSources: q.sources, matchedSources: matched, sourceHit: matched.length > 0, top5: found.map(({ rank, score, source, chunk_id }) => ({ rank, score, source, chunk_id })), controlKeywords: { expected: q.keywords, found: keywordMatches }, elapsedMs };
});
const elapsedMs = Number((performance.now() - start).toFixed(3));
const report = { createdAt: new Date().toISOString(), runtime: process.version, machine: { platform: os.platform(), architecture: os.arch(), logicalCpuCount: os.cpus().length, ramGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)) }, corpusFingerprint: index.fingerprint, indexEmbeddingModel: index.model, dimensions: index.dimensions, retrieval: 'Local lexical BM25-like term ranking over fixed-strategy chunk text. The archived vectors are ignored.', chunkCount: index.chunks.filter(c => c.strategy === 'fixed').length, cases, summary: { questions: cases.length, sourceHits: cases.filter(c => c.sourceHit).length, sourceHitRate: cases.length ? cases.filter(c => c.sourceHit).length / cases.length : 0, meanQueryMs: Number((cases.reduce((n, c) => n + c.elapsedMs, 0) / Math.max(cases.length, 1)).toFixed(3)), keywordsFound: cases.reduce((n, c) => n + c.controlKeywords.found.length, 0), keywordsExpected: cases.reduce((n, c) => n + c.controlKeywords.expected.length, 0), processElapsedMs: elapsedMs }, limitation: 'Source hit and keyword overlap are retrieval diagnostics, not semantic answer-quality judgments. The sample has ten questions.' };
await mkdir(new URL('../results/', import.meta.url), { recursive: true });
await writeFile(new URL('../results/retrieval-check.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
