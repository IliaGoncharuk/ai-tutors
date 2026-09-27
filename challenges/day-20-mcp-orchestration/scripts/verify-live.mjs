import {mkdtempSync} from 'node:fs';import {join} from 'node:path';import {tmpdir,homedir} from 'node:os';import {createApp} from '../server/index.mjs';
const directory=mkdtempSync(join(tmpdir(),'tracker-day-20-live-'));let app;
try{
 app=await createApp({port:0,production:true,directory,budgetDirectory:join(homedir(),'.ai-tutors','tracker-series-validation')});
 const post=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${app.port}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;};
 await post('source',{source:'live'});const runs=[];let state;
 for(const request of ['report','report','last']){
  state=await post('run',{request,mode:'live'});const run=state.last;if(run.status!=='completed')throw new Error(run.error);
  runs.push({request,steps:run.steps.map(s=>({server:s.server,name:s.name,status:s.status})),comparisonAvailable:run.comparison?.available??null,numericOnly:run.modelData.every(item=>Object.values(item.values).every(v=>typeof v==='number'))});
 }
 console.log(JSON.stringify({passed:true,runs,budget:state.budget}));
}catch(error){console.log(JSON.stringify({passed:false,error:error.message}));process.exitCode=1;}finally{await app?.close();}
