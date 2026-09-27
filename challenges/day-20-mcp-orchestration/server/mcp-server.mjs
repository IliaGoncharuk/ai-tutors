import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {Store} from './store.mjs';import {PublicError} from './domain.mjs';
import {collectSnapshot,summarizeSnapshot,saveReport,comparePrevious,latestReport} from './reporting.mjs';
const role=process.env.MCP_ROLE,source=process.env.TRACKER_SOURCE??'demo',store=new Store();
if(!['data','analytics'].includes(role))throw new Error('Unknown server role');
const server=new McpServer({name:role==='data'?'tracker-data':'tracker-analytics',version:'1.0.0'});
const handler=fn=>async args=>{try{return {content:[{type:'text',text:JSON.stringify(await fn(args))}]};}catch(error){return {isError:true,content:[{type:'text',text:error instanceof PublicError?error.message:'Ошибка MCP-инструмента.'}]};}};
const local={readOnlyHint:false,destructiveHint:false,openWorldHint:false};
if(role==='data'){
 server.registerTool('search_issues',{title:'Получить мои задачи',description:'Получает свежие незавершённые задачи, назначенные мне. period: all — все, overdue — просроченные, today — дедлайн сегодня. Создаёт локальный снимок для summarize_issues.',inputSchema:{period:z.enum(['all','overdue','today'])},annotations:{...local,openWorldHint:true}},handler(({period})=>collectSnapshot(store,source,period)));
}else{
 server.registerTool('summarize_issues',{title:'Рассчитать показатели',description:'Рассчитывает показатели сроков. Требуется снимок от search_issues.',inputSchema:{snapshotId:z.string().uuid()},annotations:local},handler(({snapshotId})=>summarizeSnapshot(store,snapshotId)));
 server.registerTool('compare_previous',{title:'Сравнить с прошлым отчётом',description:'Сравнивает текущую сводку с последним сохранённым отчётом того же источника. Вызывать после summarize_issues и до save_report; available=false означает, что прошлого отчёта нет.',inputSchema:{summaryId:z.string().uuid()},annotations:local},handler(({summaryId})=>comparePrevious(store,summaryId)));
 server.registerTool('save_report',{title:'Сохранить отчёт',description:'Сохраняет текущую сводку локально. Для запроса со сравнением сначала выполните compare_previous.',inputSchema:{summaryId:z.string().uuid()},annotations:local},handler(({summaryId})=>saveReport(store,summaryId)));
 server.registerTool('get_latest_report',{title:'Прочитать последний отчёт',description:'Читает последний сохранённый отчёт без обновления задач из Трекера. available=false означает отсутствие отчёта.',inputSchema:{},annotations:{...local,readOnlyHint:true}},handler(()=>latestReport(store,source)));
}
await server.connect(new StdioServerTransport());
