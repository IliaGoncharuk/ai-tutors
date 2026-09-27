import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serve } from './http.mjs';
import { McpConnection } from './mcp-client.mjs';
import { DAY,PORT,TITLE } from './config.mjs';
import { Store } from './store.mjs';
import { trackerConfig } from './tracker.mjs';

export async function createApp({port=Number(process.env.PORT??PORT),production,directory}={}){
  const store=new Store(directory),unlock=store.lock(),config=trackerConfig();
  const connection=new McpConnection({env:{TRACKER_LAB_DATA_DIR:store.directory,...(config.token?{YANDEX_TRACKER_TOKEN:config.token}:{}),...(config.org?{YANDEX_TRACKER_ORG_ID:config.org}:{}),...(config.cloudOrg?{YANDEX_TRACKER_CLOUD_ORG_ID:config.cloudOrg}:{})}});
  let busy=false,cached;
  const view=()=>({day:DAY,title:TITLE,busy,connection:connection.view(),digest:cached});
  try{
    await connection.connect();cached=await connection.call('get_digest');
    const web=await serve({root:fileURLToPath(new URL('../',import.meta.url)),port,production,route:async(method,path,body)=>{
      if(method==='GET'&&path==='/api/state'){cached=await connection.call('get_digest');return view();}
      if(method!=='POST'||!['/api/schedule','/api/run'].includes(path))return {status:404,body:{error:'Маршрут не найден.'}};
      if(busy)return {status:409,body:{error:'Дождитесь текущего действия.'}};
      busy=true;try{
        if(path==='/api/schedule')await connection.call('schedule_digest',body);
        else await connection.call('run_digest_now');
        cached=await connection.call('get_digest');return view();
      }finally{busy=false;}
    }});
    return {...web,close:async()=>{await web.close();await connection.close();unlock();}};
  }catch(error){await connection.close();unlock();throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createApp();console.log(`День ${DAY}: http://127.0.0.1:${app.port}`);
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
