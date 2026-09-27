import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent, Budget } from '../server/agent.mjs';
import { Store } from '../server/store.mjs';
import { McpConnection } from '../server/mcp-client.mjs';
import { createApp } from '../server/index.mjs';
const temp = () => mkdtempSync(join(tmpdir(),'tracker-lab-test-'));

test('real MCP tool result is consumed; OpenAI sees only allowlisted numbers', async () => {
  const dir = temp(), connection = new McpConnection({env:{TRACKER_SOURCE:'demo'}}), payloads = [];
  try {
    await connection.connect();
    let n = 0;
    const output = await runAgent({request:'overdue',mode:'live',connection,budget:new Budget(new Store(dir)),onPayload:p=>payloads.push(p),responder:async()=> ++n === 1 ? {status:'completed',usage:{input_tokens:10,output_tokens:5},output:[{type:'function_call',call_id:'test-call',name:'search_issues',arguments:'{"period":"overdue"}'}]} : {status:'completed',output:[],output_text:'Просрочено 2 задачи.'}});
    assert.equal(output.result.metrics.total,2); assert.equal(payloads.length,2);
    const serialized = JSON.stringify(payloads);
    for (const row of output.result.issues) { assert.equal(serialized.includes(row.key),false); assert.equal(serialized.includes(row.summary),false); }
    const modelData = JSON.parse(payloads[1].input.at(-1).output);
    assert.ok(Object.values(modelData).every(value=>typeof value==='number'));
    assert.equal(payloads[0].store,false);
  } finally {await connection.close();rmSync(dir,{recursive:true,force:true});}
});
test('wrong tool arguments rejected and failed requests retain budget reservation', async () => {
  const dir = temp();
  try {
    const budget = new Budget(new Store(dir),.05);
    const connection = {tools:[{name:'search_issues'}],call:()=>assert.fail('Must not call')};
    await assert.rejects(runAgent({request:'today',mode:'live',connection,budget,responder:async()=>{throw new Error('offline');}}));
    assert.equal(budget.view().requests,1); assert.throws(()=>budget.reserve(),/Лимит/);
    await assert.rejects(runAgent({request:'private free text',mode:'live',connection,budget}),/Выберите/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('HTTP run, isolation of source modes and duplicate instance protection', async () => {
  const dir=temp(); let app;
  try {
    app=await createApp({port:0,production:true,directory:dir});
    await assert.rejects(createApp({port:0,production:true,directory:dir}),/другим процессом/);
    const post=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${app.port}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return response.json();};
    const state=await post('run',{request:'today',mode:'demo'});assert.equal(state.last.result.metrics.today,2);
    const switched=await post('source',{source:'live'});assert.equal(switched.last,null);assert.equal(switched.connection.connected,false);
  } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});
