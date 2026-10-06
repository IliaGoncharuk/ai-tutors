import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Store, Provider, corpus, fingerprint, words, buildIndex, search, questions } from '../server/core.mjs';
import { EMBEDDING_MODEL, DIMENSIONS } from '../server/config.mjs';
const store = new Store(), provider = new Provider(), before = provider.budget(), rows = [], chunks = [];
try {
  for (const strategy of ['fixed', 'structure']) {
    const started = Date.now(); await buildIndex(store, provider, strategy);
    const index = store.chunks(strategy); chunks.push(...index);
    let hits = 0; const retrieval = [];
    for (const q of questions) {
      const found = await search(store, provider, q.question, strategy, 5);
      const hit = q.sources.every(source => found.some(c => c.source === source)); if (hit) hits++;
      retrieval.push({ ...q, hit, found });
    }
    rows.push({ strategy, chunks: index.length, meanCharacters: Math.round(index.reduce((s,c)=>s+c.text.length,0)/index.length), sourceHitAt5: hits, seconds: (Date.now()-started)/1000, retrieval });
    console.log(`${strategy}: ${index.length} chunks; source hit ${hits}/10`);
  }
  const totalWords = corpus.reduce((s,d)=>s+words(d.text),0);
  const report = { date:'2026-10-05', kind:'live', model:EMBEDDING_MODEL, dimensions:DIMENSIONS, corpusFingerprint:fingerprint, method:'20 frozen README files, sections headed exactly ## Исходное задание removed; older differently headed README retained; page equivalent = 500 whitespace-delimited words. Two strategies, 1800 characters, overlap 200; source hit@5 checks expected document, not answer quality.', summary:{'Документов':corpus.length,'Слов':totalWords,'Условных страниц':(totalWords/500).toFixed(1),'Fixed · источники в top-5':`${rows[0].sourceHitAt5}/10`,'Structure · источники в top-5':`${rows[1].sourceHitAt5}/10`}, before, after:provider.budget(), rows };
  mkdirSync(new URL('../results/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../results/experiment.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  writeFileSync(new URL('../data/index.json.gz',import.meta.url),gzipSync(JSON.stringify({fingerprint,model:EMBEDDING_MODEL,dimensions:DIMENSIONS,chunks})));
  console.log(JSON.stringify(report.after));
} finally {store.close();provider.close();}
