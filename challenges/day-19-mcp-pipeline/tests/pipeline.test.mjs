import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {McpConnection} from '../server/mcp-client.mjs';import {runPipeline} from '../server/pipeline.mjs';
import {Store} from '../server/store.mjs';import {readArtifact} from '../server/reporting.mjs';
const temp=()=>mkdtempSync(join(tmpdir(),'pipeline-test-'));
test('three real MCP calls pass references and preserve exact counts in both files',async()=>{
 const directory=temp(),c=new McpConnection({env:{TRACKER_SOURCE:'demo',TRACKER_LAB_DATA_DIR:directory}}),changes=[];
 try{await c.connect();assert.equal(c.tools.length,3);const run=await runPipeline(c,{source:'demo',onChange:s=>changes.push(s)});assert.equal(run.status,'completed');
 assert.deepEqual(run.steps.map(s=>s.name),['search_issues','summarize_issues','save_report']);
 assert.equal(run.steps[1].input.snapshotId,run.steps[0].output.snapshotId);assert.equal(run.steps[2].input.summaryId,run.steps[1].output.summaryId);
 const saved=JSON.parse(readFileSync(join(directory,run.report.jsonFile),'utf8'));assert.deepEqual(saved.metrics,run.result.metrics);assert.match(readFileSync(join(directory,run.report.markdownFile),'utf8'),/Просрочено: 2/);
 assert.ok(changes.some(s=>s.steps[1].status==='running'));const again=await c.call('save_report',{summaryId:run.result.summaryId});assert.equal(again.reportId,run.report.reportId);
 await assert.rejects(c.call('summarize_issues',{snapshotId:'../../secret'}));
 }finally{await c.close();rmSync(directory,{recursive:true,force:true});}
});
test('processing failure stops before save and marks later step skipped',async()=>{
 const called=[];const c={call:async name=>{called.push(name);if(name==='summarize_issues')throw new Error('test');return {snapshotId:'example'};}};
 const run=await runPipeline(c,{source:'demo'});assert.equal(run.status,'failed');assert.equal(run.steps[2].status,'skipped');assert.deepEqual(called,['search_issues','summarize_issues']);assert.equal(run.report,null);
});
test('local artifact reads reject traversal and absent snapshots',()=>{
 const directory=temp();try{const store=new Store(directory);assert.throws(()=>readArtifact(store,'snapshot','../private'));assert.throws(()=>readArtifact(store,'snapshot','00000000-0000-4000-8000-000000000000'),/не найден/);}finally{rmSync(directory,{recursive:true,force:true});}
});
