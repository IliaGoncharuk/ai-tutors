import {randomUUID}from'node:crypto';
import {readFileSync}from'node:fs';
import {PublicError,hash}from'./core.mjs';
import {generate}from'./rag.mjs';
import {groundedAnswer}from'./grounding.mjs';
import {mentionedDays}from'./retrieval.mjs';
export const emptyState=()=>({goal:null,constraints:{},terms:{},clarifications:{}});
export const memorySchema = {
  type: 'object', additionalProperties: false, required: ['search_query', 'updates'],
  properties: {
    search_query: { type: 'string' },
    updates: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['field', 'key', 'value', 'evidence', 'op'],
      properties: {
        field: { type: 'string', enum: ['goal', 'constraints', 'terms', 'clarifications'] },
        key: { type: 'string' }, value: { type: 'string' }, evidence: { type: 'string' },
        op: { type: 'string', enum: ['set', 'remove'] }
      }
    } }
  }
};
export function explicitUpdates(previous,message) {
  const fields={'цель':'goal','ограничение':'constraints','термин':'terms','уточнение':'clarifications'},updates=[];
  for(const m of message.matchAll(/(Цель|Ограничение|Термин|Уточнение):\s*([^.!?\n]+)/giu)){
    const field=fields[m[1].toLowerCase()],value=m[2].trim();
    const existing=field==='goal'?null:Object.entries(previous[field]).find(([,v])=>v.value===value)?.[0];
    updates.push({field,key:field==='goal'?'goal':existing??`entry_${hash(value).slice(0,12)}`,value,evidence:m[0],op:'set'});
  }
  for(const m of message.matchAll(/Замени\s+(ограничение|термин|уточнение)\s+«([^»]+)»\s+на\s+«([^»]+)»/giu)){
    const field=fields[m[1].toLowerCase()],old=m[2],value=m[3];
    const existing=Object.entries(previous[field]).find(([,v])=>v.value===old)?.[0];
    updates.push({field,key:existing??`entry_${hash(value).slice(0,12)}`,value,evidence:m[0],op:'set'});
  }
  return updates;
}
export function applyUpdates(previous,updates,message,messageIndex) {
  const state=structuredClone(previous),accepted=[],rejected=[];
  if(!Array.isArray(updates)||updates.length>12)throw new PublicError('Некорректные предложения памяти.');
  for(const update of updates){
    const valid=['goal','constraints','terms','clarifications'].includes(update.field)&&['set','remove'].includes(update.op)&&typeof update.key==='string'&&/^[a-z][a-z0-9_-]{0,39}$/.test(update.key)&&typeof update.evidence==='string'&&update.evidence.trim().length>=5&&message.includes(update.evidence)&&typeof update.value==='string'&&update.value.length<=500;
    if(!valid||(update.op==='set'&&(!update.value.trim()||!message.includes(update.value)||update.value.includes('?')))||(update.op==='remove'&&!/отмен|убер|удал|замен|вместо|сними|исправ/iu.test(update.evidence))){rejected.push(update);continue;}
    if(update.field!=='goal'&&update.op==='set'&&Object.values(state[update.field]).some(entry=>entry.value===update.value))continue;
    const record={value:update.value,evidence:update.evidence,messageIndex};
    if(update.field==='goal'){if(update.op==='set')state.goal=record;else state.goal=null;}
    else if(update.op==='remove')delete state[update.field][update.key];
    else state[update.field][update.key]=record;
    accepted.push(update);
  }
  if(JSON.stringify(state).length>10000)throw new PublicError('Память задачи заполнена. Начните новую задачу или явно отмените устаревшие условия.');
  return{state,accepted,rejected};
}
export function newTask(store,name='Новая задача') {
  if(typeof name!=='string'||name.length>120)throw new PublicError('Слишком длинное имя задачи.');
  const task={id:randomUUID(),name:name.trim()||'Новая задача',revision:0,state:emptyState(),messages:[]};
  const tasks=store.get('tasks',[]);tasks.push({id:task.id,name:task.name});
  store.db.exec('BEGIN IMMEDIATE');try{store.set(`task-${task.id}`,task);store.set('tasks',tasks);store.set('active-task',task.id);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}
  return task;
}
export function getTask(store,id) {if(typeof id!=='string'||!/^[-a-f0-9]{36}$/.test(id))throw new PublicError('Выберите задачу.');const task=store.get(`task-${id}`);if(!task)throw new PublicError('Задача не найдена.');return task;}
export async function chat(store,provider,{taskId,question},dependencies={}) {
  if(typeof question!=='string'||!question.trim()||question.length>2000)throw new PublicError('Введите сообщение длиной от 1 до 2000 символов.');
  const task=getTask(store,taskId),history=task.messages.slice(-4).map(m=>({role:m.role,text:m.text}));
  const declared=applyUpdates(task.state,explicitUpdates(task.state,question),question,task.messages.length);
  const prepared=await (dependencies.generate??generate)(provider,{message:question,taskState:declared.state,recentMessages:history},{schema:memorySchema,maxOutput:1800,instructions:'Подготовь память задачи и самостоятельный запрос для поиска по README. Из текущего сообщения извлекай только явно заявленные цель, ограничения, определения терминов и уточнения пользователя, которые ещё не записаны в taskState. Вопросы и просьбы рассказать о документах НЕ являются уточнениями: не сохраняй их в память. Не записывай ответы на вопросы как факты. Если обновлений нет, updates пустой. value и evidence должны быть ТОЧНЫМИ непрерывными подстроками текущего message, без перефразирования. key — короткое стабильное английское имя поля (например deployment, history); при замене условия используй прежний key. Не меняй цель из-за временного отвлечения на другой вопрос. Удаляй только по явной просьбе, evidence содержит эту просьбу. search_query — самостоятельная формулировка текущего вопроса с необходимым номером дня из истории и текущего сообщения. Сохрани все явно указанные номера дней. Не добавляй ответ или неизвестные факты в поисковый запрос.'});
  let value;try{value=JSON.parse(prepared.text);}catch{throw new PublicError('Не удалось разобрать обновление памяти; история не изменена.');}
  const memory=applyUpdates(declared.state,value.updates,question,task.messages.length);
  memory.accepted=[...declared.accepted,...memory.accepted];
  const validQuery=typeof value.search_query==='string'&&value.search_query.trim()&&value.search_query.length<=1500&&mentionedDays(question).every(day=>mentionedDays(value.search_query).includes(day));
  const retrievalQuestion=validQuery?value.search_query:question;
  const answer=await(dependencies.answer??groundedAnswer)(store,provider,{question,retrievalQuestion,taskState:memory.state,history,mode:'filter'});
  const current=getTask(store,taskId);if(current.revision!==task.revision)throw new PublicError('Задача изменена другим процессом. Ответ не записан; обновите страницу.');
  const next={...task,state:memory.state,revision:task.revision+1,messages:[...task.messages,{role:'user',text:question},{role:'assistant',text:answer.text,result:answer,memory:{accepted:memory.accepted,rejected:memory.rejected},preparation:prepared}]};
  // History, state and response are one atomic SQLite record.
  store.set(`task-${taskId}`,next);return next;
}
export const extension={state:store=>{const id=store.get('active-task');return{tasks:store.get('tasks',[]),task:id?getTask(store,id):null};},route:async({path,body,store,provider})=>{
  if(path==='/api/tasks/new')return newTask(store,body.name);
  if(path==='/api/tasks/example'){
    if(!Number.isInteger(body.index)||body.index<0||body.index>1)throw new PublicError('Выберите один из двух примеров.');
    let example;try{example=JSON.parse(readFileSync(new URL('../results/experiment.json',import.meta.url),'utf8')).rows[body.index];}catch{throw new PublicError('Сохранённый пример недоступен.');}
    if(!example?.finalState)throw new PublicError('Эксперимент ещё не завершён.');
    const task=newTask(store,`Пример: ${example.name}`);
    task.state=example.finalState;task.revision=example.turns.length;
    task.messages=example.turns.flatMap(t=>[{role:'user',text:t.question},{role:'assistant',text:t.answer.text,result:t.answer,memory:t.memory,preparation:t.preparation}]);
    store.set(`task-${task.id}`,task);return task;
  }
  if(path==='/api/tasks/select'){const task=getTask(store,body.id);store.set('active-task',task.id);return task;}
  if(path==='/api/chat')return await chat(store,provider,body);
}};
