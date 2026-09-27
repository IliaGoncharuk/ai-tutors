import {randomUUID} from 'node:crypto';import {MODEL} from './config.mjs';
import {PublicError,numericMetrics} from './domain.mjs';import {openaiResponder} from './budget.mjs';
export const requests={
 report:'Получи все мои незавершённые задачи, рассчитай сводку, сравни с предыдущим отчётом и сохрани новый отчёт. Затем объясни показатели и изменения.',
 today:'Получи мои задачи с дедлайном сегодня и рассчитай их показатели. Объясни результат. Отчёт сохранять не нужно.',
 overdue:'Получи мои просроченные задачи и рассчитай их показатели. Объясни результат. Отчёт сохранять не нужно.',
 last:'Прочитай последний сохранённый отчёт и объясни его показатели. Свежие данные из Трекера запрашивать не нужно.',
};
const instructions='Ты помощник по срокам задач. Выбирай инструменты по запросу, соблюдай их зависимости. Доступны два MCP-сервера: data получает задачи, analytics рассчитывает и сохраняет отчёты. Хост сам подставляет локальные идентификаторы снимков и сводок, поэтому параметры аналитических функций пустые. Для свежей сводки нужны search_issues, затем summarize_issues. Для отчёта со сравнением далее нужны compare_previous и save_report. Для последнего сохранённого отчёта нужен только get_latest_report. Отвечай кратко по-русски. Используй только полученные числа; не придумывай названия задач, людей, причины задержек. total — всего, overdue — просрочено, today — срок сегодня, upcoming — будущие, noDeadline — без срока, invalidDeadline — неверная дата, maxOverdueDays — максимальная просрочка. available=0 означает отсутствие прошлого отчёта; отрицательная дельта — уменьшение. При техническом отказе исправь порядок вызовов, не сообщай об успехе невыполненного действия.';

export function modelTools(connections){return connections.catalog().map(({alias,tool})=>({type:'function',name:alias,description:tool.description,parameters:tool.name==='search_issues'?{type:'object',properties:{period:{type:'string',enum:['all','overdue','today']}},required:['period'],additionalProperties:false}:{type:'object',properties:{},required:[],additionalProperties:false},strict:true}));}
export async function orchestrate({request,mode,connections,budget,responder,onChange=()=>{},onPayload=()=>{}}){
 if(!Object.hasOwn(requests,request)||!['demo','live'].includes(mode))throw new PublicError('Выберите допустимый запрос и режим.');
 const run={id:randomUUID(),request,mode,status:'running',steps:[],result:null,report:null,comparison:null,answer:'',modelData:[],error:null};
 const update=()=>onChange(structuredClone(run));let snapshot,summary,lastRead=false,compared=false,saved=false;
 const complete=()=>request==='last'?lastRead:request==='report'?Boolean(summary&&compared&&saved):Boolean(summary);
 const catalog=connections.catalog(),tools=modelTools(connections);update();
 async function dispatch(alias,args){
  const entry=catalog.find(item=>item.alias===alias);if(!entry)throw new PublicError('Неизвестный инструмент агента.');
  if(!args||typeof args!=='object'||Array.isArray(args))throw new PublicError('Некорректные аргументы инструмента.');
  const {server,tool}=entry;
  if(tool.name==='search_issues'){
   const period=request==='report'?'all':request;
   if(Object.keys(args).length!==1||args.period!==period||request==='last')throw new PublicError('Поиск не соответствует запросу пользователя.');
  }else if(Object.keys(args).length)throw new PublicError('Идентификаторы должен подставлять хост, а не модель.');
  const step={server,name:tool.name,alias,status:'running',input:args};run.steps.push(step);update();const begin=Date.now();
  const refuse=code=>{step.status='rejected';step.output={ok:0,code};step.durationMs=Date.now()-begin;update();return step.output;};
  if(request==='last'&&tool.name!=='get_latest_report')return refuse('USE_LATEST_ONLY');
  if(request!=='last'&&tool.name==='get_latest_report')return refuse('NEED_FRESH_SNAPSHOT');
  if(tool.name==='search_issues'&&snapshot)return refuse('ALREADY_COLLECTED');
  if(tool.name==='summarize_issues'&&(!snapshot||summary))return refuse(summary?'ALREADY_SUMMARIZED':'NEED_SNAPSHOT');
  if(['compare_previous','save_report'].includes(tool.name)&&(!summary||request!=='report'))return refuse('NEED_REPORT_SUMMARY');
  if(tool.name==='compare_previous'&&(compared||saved))return refuse('ALREADY_COMPARED');
  if(tool.name==='save_report'&&(!compared||saved))return refuse(saved?'ALREADY_SAVED':'NEED_COMPARISON');
  let actual=args;
  if(tool.name==='summarize_issues')actual={snapshotId:snapshot.snapshotId};
  if(['compare_previous','save_report'].includes(tool.name))actual={summaryId:summary.summaryId};
  step.input=actual;
  try{
   const value=await connections[server].call(tool.name,actual);step.output=value;let safe;
   if(tool.name==='search_issues'){snapshot=value;safe={total:value.count};}
   if(tool.name==='summarize_issues'){summary=value;run.result=value;safe=numericMetrics(value.metrics);}
   if(tool.name==='compare_previous'){compared=true;run.comparison=value;safe=value.available?{available:1,...Object.fromEntries(Object.entries(value.deltas).map(([key,value])=>[`delta_${key}`,value]))}:{available:0};}
   if(tool.name==='save_report'){saved=true;run.report=value;safe={saved:1};}
   if(tool.name==='get_latest_report'){lastRead=true;run.result=value.result;run.report=value.report;safe=value.available?{available:1,...numericMetrics(value.result.metrics)}:{available:0};}
   if(!safe||!Object.values(safe).every(value=>typeof value==='number'&&Number.isSafeInteger(value)))throw new PublicError('Нечисловые данные заблокированы перед отправкой модели.');
   step.status='completed';step.durationMs=Date.now()-begin;run.modelData.push({tool:alias,values:safe});update();return safe;
  }catch(error){step.status='failed';step.durationMs=Date.now()-begin;throw error;}
 }
 try{
  if(mode==='demo'){
   if(request==='last')await dispatch('analytics__get_latest_report',{});
   else{await dispatch('data__search_issues',{period:request==='report'?'all':request});await dispatch('analytics__summarize_issues',{});if(request==='report'){await dispatch('analytics__compare_previous',{});await dispatch('analytics__save_report',{});}}
   run.answer=run.result?`Демонстрация: всего ${run.result.metrics.total}, просрочено ${run.result.metrics.overdue}, срок сегодня у ${run.result.metrics.today}.${run.comparison&&!run.comparison.available?' Предыдущего отчёта пока нет.':''}`:'Сохранённого отчёта пока нет.';
  }else{
   const respond=responder??openaiResponder(),input=[{role:'user',content:requests[request]}];
   for(let step=0;step<8;step++){
    const payload={model:MODEL,instructions,input,tools,parallel_tool_calls:false,store:false,reasoning:{effort:'none'},max_output_tokens:700,tool_choice:complete()?'none':'required'};
    if(JSON.stringify(payload).length>24000)throw new PublicError('Контекст агента превысил допустимый размер.');
    onPayload(structuredClone(payload));budget.reserve();const response=await respond(payload);budget.finish(response.usage);
    if(response.status!=='completed')throw new PublicError('Модель вернула неполный ответ.');
    const calls=response.output?.filter(item=>item.type==='function_call')??[];
    if(!calls.length){if(!complete()||!response.output_text?.trim())throw new PublicError('Агент не завершил требуемые действия.');run.answer=response.output_text;break;}
    if(calls.length!==1)throw new PublicError('Разрешён один последовательный вызов за шаг.');
    const call=calls[0];let args;try{args=JSON.parse(call.arguments);}catch{throw new PublicError('Некорректные параметры модели.');}
    const safe=await dispatch(call.name,args);
    input.push({type:'function_call',call_id:call.call_id,name:call.name,arguments:JSON.stringify(args)});
    input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(safe)});
   }
   if(!run.answer)throw new PublicError('Достигнут предел шагов агента.');
  }
  run.status='completed';
 }catch(error){run.status='failed';run.error=error.publicMessage??'Оркестрация остановлена из-за ошибки.';}
 update();return run;
}
