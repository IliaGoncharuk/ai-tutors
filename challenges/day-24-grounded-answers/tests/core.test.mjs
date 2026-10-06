import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunkDocument, cosine, Store, Provider, makeChunks, buildIndex, search, corpus, words } from '../server/core.mjs';
import { DIMENSIONS } from '../server/config.mjs';
const fixture = {source:'doc.md',title:'Document',text:'# One\n'+('hello world '.repeat(40))+'\n## Two\n'+('second section '.repeat(35))};
const vector = Array.from({length:DIMENSIONS},(_,i)=>i===0?1:0);
const temporary = () => mkdtempSync(join(tmpdir(),'rag-test-'));
test('chunk strategies preserve source offsets and cover all non-whitespace characters',()=>{
  for(const strategy of ['fixed','structure']) {
    const chunks=chunkDocument(fixture,strategy,140,20),covered=new Set();
    for(const c of chunks){assert.equal(c.text,fixture.text.slice(c.start,c.end));assert.ok(c.text.length<=140);for(let i=c.start;i<c.end;i++)covered.add(i);}
    for(let i=0;i<fixture.text.length;i++)if(fixture.text[i].trim())assert.ok(covered.has(i));
    assert.deepEqual(chunks,chunkDocument(fixture,strategy,140,20));
    assert.equal(new Set(chunks.map(c=>c.chunk_id)).size,chunks.length);
    if(strategy==='structure')assert.ok(chunks.some(c=>c.section==='Two'));
  }
  const fenced={...fixture,text:'# Real\n```powershell\n# comment, not heading\n```\n## Next\ntext'};
  assert.deepEqual(chunkDocument(fenced,'structure').map(c=>c.section),['Real','Next']);
  assert.throws(()=>chunkDocument(fixture,'bad'));assert.throws(()=>chunkDocument(fixture,'fixed',100,100));
});
test('corpus meets volume requirement and excludes assessment data',()=>{assert.equal(corpus.length,20);assert.ok(corpus.reduce((n,d)=>n+words(d.text),0)>=15000);assert.ok(corpus.every(d=>!d.text.includes('## Исходное задание')));});
test('cosine handles normalization and incompatible dimensions',()=>{assert.equal(cosine([2,0],[1,0]),1);assert.equal(cosine([1,0],[0,1]),0);assert.throws(()=>cosine([1],[1,2]));});
test('index survives reopen; failed rebuild preserves previous index',async()=>{const dir=temporary();let store=new Store(dir);try{
  await buildIndex(store,{embed:async texts=>texts.map(()=>vector)},'fixed');const first=store.chunks('fixed');store.close();store=new Store(dir);assert.deepEqual(store.chunks('fixed'),first);
  await assert.rejects(buildIndex(store,{embed:async()=>{throw Error('offline');}},'fixed'));assert.deepEqual(store.chunks('fixed'),first);
  const found=await search(store,{embed:async()=>[vector]},'test','fixed',3);assert.equal(found.length,3);assert.ok(found.every(c=>!('vector' in c)));
  assert.throws(()=>store.replace('fixed',[{...makeChunks('fixed')[0],vector:[1]}]));assert.deepEqual(store.chunks('fixed'),first);
}finally{store.close();rmSync(dir,{recursive:true,force:true});}});
test('one budget ledger across two app processes/connections; reservations persist',()=>{const dir=temporary();const a=new Provider(dir),b=new Provider(dir);try{a.reserve('responses',.6);assert.throws(()=>b.reserve('responses',.5));assert.equal(b.budget().reserved,.6);}finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}});
test('embeddings cache avoids a second paid request and maps API indexes',async()=>{const dir=temporary(),old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-placeholder';let calls=0;const p=new Provider(dir,async()=>{calls++;return new Response(JSON.stringify({usage:{prompt_tokens:10},data:[{index:1,embedding:vector},{index:0,embedding:vector}]}));});try{await p.embed(['one','two']);await p.embed(['two','one']);assert.equal(calls,1);assert.equal(p.budget().reserved,0);assert.equal(p.budget().inputTokens,10);}finally{p.close();if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;rmSync(dir,{recursive:true,force:true});}});
