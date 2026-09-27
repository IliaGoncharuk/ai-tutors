import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Scheduler,nextRun} from '../server/scheduler.mjs';
import {searchIssues} from '../server/tracker.mjs';
import {createApp} from '../server/index.mjs';
const temp=()=>mkdtempSync(join(tmpdir(),'scheduler-test-'));
test('weekday boundary, catch-up and restart do not duplicate a daily run',async()=>{
 const directory=temp();let now=new Date('2026-09-28T03:59:00Z'),calls=0,s;
 try{s=new Scheduler({directory,now:()=>now,collect:async args=>{calls++;return searchIssues(args);}});s.configure({source:'demo',enabled:true,time:'09:00'});
 await s.tick();assert.equal(calls,0);now=new Date('2026-09-28T04:00:00Z');await s.tick();await s.tick();assert.equal(calls,1);assert.equal(s.view().latest.metrics.total,6);
 await s.close();s=new Scheduler({directory,now:()=>now,collect:async args=>{calls++;return searchIssues(args);}});await s.tick();assert.equal(calls,1);
 now=new Date('2026-09-29T08:00:00Z');await s.tick();assert.equal(calls,2);now=new Date('2026-10-03T08:00:00Z');await s.tick();assert.equal(calls,2);
 assert.match(nextRun(s.settings(),now),/2026-10-05 09:00/);
 }finally{await s?.close();rmSync(directory,{recursive:true,force:true});}
});
test('actual timer creates a persisted report without HTTP requests',async()=>{
 const directory=temp();let s;try{let done;const completed=new Promise(resolve=>done=resolve);
 s=new Scheduler({directory,now:()=>new Date('2026-09-28T05:00:00Z'),collect:async args=>{const result=await searchIssues(args);done();return result;}});s.configure({source:'demo',enabled:true,time:'09:00'});s.start(10);
 await Promise.race([completed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timer did not run')),2000).unref())]);
 await s.pending;assert.equal(s.view().history[0].trigger,'scheduled');assert.equal(s.view().history[0].status,'completed');
 }finally{await s?.close();rmSync(directory,{recursive:true,force:true});}
});
test('failure retry is bounded and previous successful result survives',async()=>{
 const directory=temp();let s,fail=false,now=new Date('2026-09-28T04:00:00Z');try{s=new Scheduler({directory,now:()=>now,collect:async args=>{if(fail)throw new Error('private upstream error');return searchIssues(args);}});s.configure({source:'demo',enabled:true,time:'09:00'});await s.run();fail=true;
 await assert.rejects(s.tick());assert.equal(s.view().latest.metrics.total,6);await s.tick();assert.equal(s.view().history[0].attempts,1);
 now=new Date('2026-09-28T04:02:00Z');await assert.rejects(s.tick());now=new Date('2026-09-28T04:08:00Z');await assert.rejects(s.tick());now=new Date('2026-09-28T04:20:00Z');await s.tick();assert.equal(s.view().history[0].attempts,3);assert.equal(s.view().history[0].error.includes('private'),false);
 }finally{await s?.close();rmSync(directory,{recursive:true,force:true});}
});
test('MCP schedule and report survive closing and reopening the complete HTTP app',async()=>{
 const directory=temp();let app;try{app=await createApp({port:0,production:true,directory});
 const post=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${app.port}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 await post('schedule',{source:'demo',enabled:false,time:'09:00'});const result=await post('run',{});assert.equal(result.digest.latest.metrics.overdue,2);assert.equal(result.connection.tools.length,3);
 await app.close();app=await createApp({port:0,production:true,directory});const restored=await(await fetch(`http://127.0.0.1:${app.port}/api/state`)).json();assert.equal(restored.digest.history.length,1);assert.equal(restored.digest.latest.metrics.total,6);
 }finally{await app?.close();rmSync(directory,{recursive:true,force:true});}
});
