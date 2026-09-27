import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Scheduler } from './scheduler.mjs';
import { PublicError } from './domain.mjs';

const scheduler=new Scheduler({directory:process.env.TRACKER_LAB_DATA_DIR});
const server=new McpServer({name:'tracker-scheduler',version:'1.0.0'});
const handler=fn=>async args=>{try{return {content:[{type:'text',text:JSON.stringify(await fn(args))}]};}catch(error){return {isError:true,content:[{type:'text',text:error instanceof PublicError?error.message:'Ошибка планировщика.'}]};}};
server.registerTool('schedule_digest',{title:'Настроить утреннюю сводку',description:'Сохраняет расписание по будням в часовом поясе Екатеринбурга. Выполнение продолжается без открытой вкладки.',inputSchema:{source:z.enum(['demo','live']),enabled:z.boolean(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},handler(value=>scheduler.configure(value)));
server.registerTool('run_digest_now',{title:'Обновить сводку сейчас',description:'Читает назначенные мне задачи Трекера, считает сроки и сохраняет отдельный локальный результат. Расписание не изменяется.',inputSchema:{},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},handler(()=>scheduler.run()));
server.registerTool('get_digest',{title:'Получить сохранённую сводку',description:'Возвращает сохранённые показатели, таблицу задач, историю запусков и состояние расписания.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},handler(()=>scheduler.view()));
await server.connect(new StdioServerTransport());
scheduler.start();
let closing=false;
async function stop(){if(closing)return;closing=true;await scheduler.close();process.exit(0);}
process.stdin.on('end',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
