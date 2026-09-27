import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createApp } from '../server/index.mjs';
const directory = mkdtempSync(join(tmpdir(), 'tracker-day-17-live-'));
const app = await createApp({ port: 0, production: true, directory, budgetDirectory: join(homedir(), '.ai-tutors', 'tracker-series-validation') });
const base = `http://127.0.0.1:${app.port}`;
try {
  const post = async (path, body) => { const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type':'application/json' }, body:JSON.stringify(body) }); const result=await response.json(); if(!response.ok) throw new Error(result.error); return result; };
  await post('/api/source', {source:'live'});
  const result = await post('/api/run', {request:'all',mode:'live'});
  const summary = { passed:true, source:result.source, mcpCalls:result.connection.events.filter(e=>e.method==='tools/call →').length, agentCalls:result.last.calls, modelPayloadNumericOnly:Object.values(result.last.modelMetrics).every(v=>typeof v==='number'), budget:result.budget };
  writeFileSync(join(directory,'verification.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary));
} catch(error) { console.log(JSON.stringify({passed:false,error:error.message})); process.exitCode=1; }
finally { await app.close(); }
