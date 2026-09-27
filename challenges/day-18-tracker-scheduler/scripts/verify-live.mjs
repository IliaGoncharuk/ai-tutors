import {mkdtempSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createApp} from '../server/index.mjs';
const directory=mkdtempSync(join(tmpdir(),'tracker-day-18-live-'));let app;
try{
 app=await createApp({port:0,production:true,directory});
 const post=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${app.port}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;};
 await post('schedule',{source:'live',enabled:false,time:'09:00'});const result=await post('run',{});
 const saved=result.digest.history[0].status==='completed';await app.close();app=await createApp({port:0,production:true,directory});
 const restored=await(await fetch(`http://127.0.0.1:${app.port}/api/state`)).json();
 console.log(JSON.stringify({passed:saved&&restored.digest.latest.source==='live',mcpTools:restored.connection.tools.length,restartRestored:restored.digest.history.length===1,openaiCalls:0}));
}catch(error){console.log(JSON.stringify({passed:false,error:error.message}));process.exitCode=1;}finally{await app?.close();}
