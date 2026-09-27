import OpenAI from 'openai';import {PublicError} from './domain.mjs';
export function openaiResponder(apiKey=process.env.OPENAI_API_KEY){
 if(!apiKey)throw new PublicError('В окружении сервера нет OPENAI_API_KEY.');
 const client=new OpenAI({apiKey,maxRetries:0,timeout:45000});
 return async payload=>{try{return await client.responses.create(payload);}catch{throw new PublicError('OpenAI не ответил. Повторный запрос автоматически не выполнялся.');}};
}
export class Budget{
 constructor(store,limit=1){this.store=store;this.limit=limit;}
 view(){return this.store.read('budget.json',{reservedUsd:0,estimatedUsd:0,requests:0,inputTokens:0,outputTokens:0});}
 reserve(){const v=this.view();if(v.reservedUsd+.05>this.limit+1e-9)throw new PublicError('Лимит расходов достигнут. Новый запрос модели не отправлен.');v.reservedUsd=Math.round((v.reservedUsd+.05)*100)/100;v.requests++;this.store.write('budget.json',v);}
 finish(usage={}){const v=this.view();v.inputTokens+=usage.input_tokens??0;v.outputTokens+=usage.output_tokens??0;v.estimatedUsd+=((usage.input_tokens??0)*.25+(usage.output_tokens??0)*1.2)/1e6;this.store.write('budget.json',v);}
}
