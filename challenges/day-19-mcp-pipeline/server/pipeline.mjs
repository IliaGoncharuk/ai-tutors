import {randomUUID} from 'node:crypto';
import {PublicError} from './domain.mjs';
export async function runPipeline(connection,{source,onChange=()=>{}}={}){
 const run={id:randomUUID(),source,status:'running',started:new Date().toISOString(),steps:['search_issues','summarize_issues','save_report'].map(name=>({name,status:'waiting'})),result:null,report:null,error:null};
 const update=()=>onChange(structuredClone(run));update();
 async function step(index,args){
  const current=run.steps[index];current.status='running';current.input=args;current.started=new Date().toISOString();update();const before=Date.now();
  try{const output=await connection.call(current.name,args);current.status='completed';current.durationMs=Date.now()-before;current.output=output;update();return output;}
  catch(error){current.status='failed';current.durationMs=Date.now()-before;throw error;}
 }
 try{
  const snapshot=await step(0,{period:'all'});
  run.result=await step(1,{snapshotId:snapshot.snapshotId});
  run.report=await step(2,{summaryId:run.result.summaryId});run.status='completed';
 }catch(error){run.status='failed';run.error=error.publicMessage??'Цепочка остановлена из-за ошибки инструмента.';for(const step of run.steps)if(step.status==='waiting')step.status='skipped';}
 run.finished=new Date().toISOString();update();return run;
}
