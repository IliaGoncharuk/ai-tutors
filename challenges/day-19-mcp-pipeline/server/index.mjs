import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
import {serve} from './http.mjs';import {McpConnection} from './mcp-client.mjs';import {DAY,PORT,TITLE} from './config.mjs';
import {Store} from './store.mjs';import {trackerConfig} from './tracker.mjs';import {PublicError} from './domain.mjs';
import {runPipeline} from './pipeline.mjs';import {readArtifact,reportMarkdown} from './reporting.mjs';
export function childEnvironment(source,directory){const c=trackerConfig();return {TRACKER_SOURCE:source,TRACKER_LAB_DATA_DIR:directory,...(source==='live'?{...(c.token?{YANDEX_TRACKER_TOKEN:c.token}:{}),...(c.org?{YANDEX_TRACKER_ORG_ID:c.org}:{}),...(c.cloudOrg?{YANDEX_TRACKER_CLOUD_ORG_ID:c.cloudOrg}:{})}:{})};}
export async function createApp({port=Number(process.env.PORT??PORT),production,directory}={}){
 const store=new Store(directory),unlock=store.lock();let source='demo',busy=false,last=null;
 let connection=new McpConnection({env:childEnvironment(source,store.directory)});
 const view=()=>({day:DAY,title:TITLE,source,busy,last,connection:connection.view(),dataDirectory:store.directory});
 try{
 const web=await serve({root:fileURLToPath(new URL('../',import.meta.url)),port,production,route:async(method,path,body)=>{
  if(method==='GET'&&path==='/api/state')return view();
  if(method==='GET'&&/^\/api\/report\/[0-9a-f-]{36}$/.test(path)){
   const report=readArtifact(store,'report',path.split('/').at(-1));return {report,markdown:reportMarkdown(report)};
  }
  if(method!=='POST'||!['/api/source','/api/run','/api/connect'].includes(path))return {status:404,body:{error:'Маршрут не найден.'}};
  if(busy)return {status:409,body:{error:'Дождитесь завершения цепочки.'}};
  busy=true;try{
   if(path==='/api/source'){if(!['demo','live'].includes(body.source))throw new PublicError('Неизвестный источник.');await connection.close();source=body.source;connection=new McpConnection({env:childEnvironment(source,store.directory)});last=null;}
   else if(path==='/api/connect')await connection.connect();
   else{await connection.connect();last=await runPipeline(connection,{source,onChange:value=>{last=value;}});store.write(`last-run-${source}.json`,last);}
   return view();
  }finally{busy=false;}
 }});
 return {...web,close:async()=>{await web.close();await connection.close();unlock();}};
 }catch(error){await connection.close();unlock();throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=await createApp();console.log(`День ${DAY}: http://127.0.0.1:${app.port}`);let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
