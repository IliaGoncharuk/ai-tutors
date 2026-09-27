import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
import {serve} from './http.mjs';import {DAY,PORT,TITLE} from './config.mjs';import {Store} from './store.mjs';
import {PublicError} from './domain.mjs';import {readArtifact,reportMarkdown} from './reporting.mjs';
import {Connections} from './connections.mjs';import {Budget} from './budget.mjs';import {orchestrate,requests} from './orchestrator.mjs';
export async function createApp({port=Number(process.env.PORT??PORT),production,directory,budgetDirectory,responder}={}){
 const store=new Store(directory),unlock=store.lock(),budget=new Budget(budgetDirectory?new Store(budgetDirectory):store);
 let source='demo',connections=new Connections(source,store.directory),busy=false,last=null;
 const view=()=>({day:DAY,title:TITLE,source,busy,last,servers:connections.view(),requests,budget:budget.view(),hasOpenAI:Boolean(process.env.OPENAI_API_KEY),dataDirectory:store.directory});
 try{
 const web=await serve({root:fileURLToPath(new URL('../',import.meta.url)),port,production,route:async(method,path,body)=>{
  if(method==='GET'&&path==='/api/state')return view();
  if(method==='GET'&&/^\/api\/report\/[0-9a-f-]{36}$/.test(path)){const report=readArtifact(store,'report',path.split('/').at(-1));return {report,markdown:reportMarkdown(report)};}
  if(method!=='POST'||!['/api/source','/api/run','/api/connect'].includes(path))return {status:404,body:{error:'Маршрут не найден.'}};
  if(busy)return {status:409,body:{error:'Дождитесь завершения запроса.'}};
  busy=true;try{
   if(path==='/api/source'){if(!['demo','live'].includes(body.source))throw new PublicError('Неизвестный источник.');await connections.close();source=body.source;connections=new Connections(source,store.directory);last=null;}
   else if(path==='/api/connect')await connections.connect();
   else{await connections.connect();last=await orchestrate({request:body.request,mode:body.mode,connections,budget,responder,onChange:value=>{last=value;}});store.write(`last-run-${source}.json`,last);}
   return view();
  }finally{busy=false;}
 }});
 return {...web,close:async()=>{await web.close();await connections.close();unlock();}};
 }catch(error){await connections.close();unlock();throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=await createApp();console.log(`День ${DAY}: http://127.0.0.1:${app.port}`);let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
