import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Connections} from '../server/connections.mjs';import {orchestrate} from '../server/orchestrator.mjs';import {Budget} from '../server/budget.mjs';import {Store} from '../server/store.mjs';
const temp=()=>mkdtempSync(join(tmpdir(),'orchestration-test-'));
const response=(name,args={},id='call')=>({status:'completed',output:[{type:'function_call',name,arguments:JSON.stringify(args),call_id:id}],usage:{input_tokens:1,output_tokens:1}});

test('two real processes: long flow, previous-report comparison and single-server request',async()=>{
 const directory=temp(),connections=new Connections('demo',directory);try{
 await connections.connect();assert.notEqual(connections.data.transport.pid,connections.analytics.transport.pid);assert.equal(connections.data.tools.length,1);assert.equal(connections.analytics.tools.length,4);
 const first=await orchestrate({request:'report',mode:'demo',connections});assert.equal(first.status,'completed');assert.equal(first.comparison.available,false);assert.deepEqual(first.steps.map(s=>s.server),['data','analytics','analytics','analytics']);
 const second=await orchestrate({request:'report',mode:'demo',connections});assert.equal(second.comparison.available,true);assert.equal(second.comparison.deltas.total,0);
 const last=await orchestrate({request:'last',mode:'demo',connections});assert.equal(last.steps.length,1);assert.equal(last.steps[0].server,'analytics');assert.equal(last.result.metrics.total,6);assert.equal(last.result.comparison.available,true);assert.equal(last.result.comparison.deltas.total,0);
 }finally{await connections.close();rmSync(directory,{recursive:true,force:true});}
});
test('model selects aliases; host supplies private references; upstream payloads contain numbers only',async()=>{
 const directory=temp(),connections=new Connections('demo',directory),payloads=[];try{
 await connections.connect();const replies=[response('data__search_issues',{period:'all'},'c1'),response('analytics__summarize_issues',{},'c2'),response('analytics__compare_previous',{},'c3'),response('analytics__save_report',{},'c4'),{status:'completed',output:[],output_text:'Сводка сохранена. Просрочено 2 задачи.'}];
 const run=await orchestrate({request:'report',mode:'live',connections,budget:new Budget(new Store(directory)),responder:async()=>replies.shift(),onPayload:p=>payloads.push(p)});
 assert.equal(run.status,'completed');assert.equal(payloads.length,5);const serialized=JSON.stringify(payloads);
 for(const issue of run.result.issues){assert.equal(serialized.includes(issue.key),false);assert.equal(serialized.includes(issue.summary),false);}
 assert.equal(serialized.includes(run.result.snapshotId),false);assert.equal(serialized.includes(run.result.summaryId),false);
 for(const payload of payloads)for(const item of payload.input.filter(i=>i.type==='function_call_output'))assert.ok(Object.values(JSON.parse(item.output)).every(v=>typeof v==='number'));
 assert.match(run.steps[1].input.snapshotId,/^[0-9a-f-]{36}$/);
 }finally{await connections.close();rmSync(directory,{recursive:true,force:true});}
});
test('out-of-order save is rejected before MCP write; model can correct the order',async()=>{
 const directory=temp(),connections=new Connections('demo',directory);try{
 await connections.connect();const replies=[response('analytics__save_report'),response('data__search_issues',{period:'all'}),response('analytics__summarize_issues'),response('analytics__compare_previous'),response('analytics__save_report'),{status:'completed',output:[],output_text:'Готово.'}];
 const run=await orchestrate({request:'report',mode:'live',connections,budget:new Budget(new Store(directory)),responder:async()=>replies.shift()});
 assert.equal(run.status,'completed');assert.equal(run.steps[0].status,'rejected');assert.equal(connections.analytics.events.filter(e=>e.method==='tools/call →'&&e.detail==='save_report').length,1);
 }finally{await connections.close();rmSync(directory,{recursive:true,force:true});}
});
test('missing previous report is not invented and foreign source history is isolated',async()=>{
 const directory=temp(),demo=new Connections('demo',directory),live=new Connections('live',directory);try{
 await demo.connect();await orchestrate({request:'report',mode:'demo',connections:demo});await demo.close();await live.connect();
 const run=await orchestrate({request:'last',mode:'demo',connections:live});assert.equal(run.result,null);assert.deepEqual(run.modelData[0].values,{available:0});
 }finally{await demo.close();await live.close();rmSync(directory,{recursive:true,force:true});}
});
test('unknown tool and unavailable server fail without fabricating results',async()=>{
 const directory=temp(),connections=new Connections('demo',directory);try{await connections.connect();
 const unknown=await orchestrate({request:'today',mode:'live',connections,budget:new Budget(new Store(directory)),responder:async()=>response('shell__execute')});assert.equal(unknown.status,'failed');assert.equal(unknown.result,null);
 await connections.analytics.close();const unavailable=await orchestrate({request:'today',mode:'demo',connections});assert.equal(unavailable.status,'failed');assert.equal(unavailable.report,null);
 }finally{await connections.close();rmSync(directory,{recursive:true,force:true});}
});
