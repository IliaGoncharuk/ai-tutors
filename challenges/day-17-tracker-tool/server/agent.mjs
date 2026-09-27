import OpenAI from 'openai';
import { MODEL } from './config.mjs';
import { PublicError, numericMetrics } from './domain.mjs';
export { Budget } from './budget.mjs';

export const requests = {
  all: 'Покажи общую сводку моих незавершённых задач.',
  overdue: 'Найди мои просроченные задачи и объясни показатели.',
  today: 'Найди мои задачи с дедлайном сегодня и объясни показатели.',
};
export function openaiResponder(apiKey = process.env.OPENAI_API_KEY) {
  if (!apiKey) throw new PublicError('В окружении сервера нет OPENAI_API_KEY.');
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 45000 });
  return async payload => {
    try { return await client.responses.create(payload); }
    catch { throw new PublicError('OpenAI не ответил. Проверьте доступ к API; повторный запрос автоматически не выполнялся.'); }
  };
}
const instructions = 'Ты помощник по срокам задач. Используй инструменты для получения фактов. Отвечай кратко по-русски, опираясь только на полученные числовые показатели. Не придумывай названия, причины просрочки, людей и приоритеты. total — количество выбранных задач; overdue — просроченные; today — срок сегодня; upcoming — будущие сроки; noDeadline — без срока; invalidDeadline — некорректная дата; maxOverdueDays — максимальная просрочка в днях. Если данных нет, прямо скажи это.';

export async function runAgent({ request, mode, connection, budget, responder, onPayload = () => {} }) {
  if (!Object.hasOwn(requests, request)) throw new PublicError('Выберите один из предложенных запросов.');
  if (!['demo', 'live'].includes(mode)) throw new PublicError('Неизвестный режим агента.');
  const discovered = connection.tools.find(tool => tool.name === 'search_issues');
  if (!discovered) throw new PublicError('Сервер не предоставил инструмент поиска.');
  let result;
  if (mode === 'demo') {
    result = await connection.call('search_issues', { period: request });
    const metrics = numericMetrics(result.metrics);
    return { result, modelMetrics: metrics, answer: `Демонстрационный ответ: выбрано ${metrics.total} задач, просрочено ${metrics.overdue}, срок сегодня у ${metrics.today}.`, agentMode: mode, calls: 0 };
  }
  const respond = responder ?? openaiResponder();
  const tools = [{ type: 'function', name: discovered.name, description: discovered.description, parameters: { type: 'object', properties: { period: { type: 'string', enum: ['all', 'overdue', 'today'] } }, required: ['period'], additionalProperties: false }, strict: true }];
  const input = [{ role: 'user', content: requests[request] }];
  for (let step = 0; step < 4; step++) {
    const payload = { model: MODEL, instructions, input, tools, parallel_tool_calls: false, store: false, reasoning: { effort: 'none' }, max_output_tokens: 700, tool_choice: result ? 'none' : 'required' };
    if (JSON.stringify(payload).length > 18000) throw new PublicError('Превышен размер контекста агента.');
    onPayload(structuredClone(payload)); const reservation = budget.reserve();
    const response = await respond(payload); budget.finish(reservation, response.usage);
    if (response.status !== 'completed') throw new PublicError('Модель вернула неполный ответ.');
    const calls = response.output?.filter(item => item.type === 'function_call') ?? [];
    if (!calls.length) {
      if (!result || !response.output_text?.trim()) throw new PublicError('Агент не выполнил поиск или не сформировал ответ.');
      return { result, modelMetrics: numericMetrics(result.metrics), answer: response.output_text, agentMode: mode, calls: step + 1 };
    }
    if (calls.length !== 1 || calls[0].name !== 'search_issues' || result) throw new PublicError('Агент предложил недопустимую последовательность инструментов.');
    const call = calls[0]; let args; try { args = JSON.parse(call.arguments); } catch { throw new PublicError('Модель вернула некорректные параметры.'); }
    if (Object.keys(args).length !== 1 || args.period !== request) throw new PublicError('Параметры поиска не соответствуют выбранному запросу.');
    result = await connection.call(call.name, args);
    input.push({ type: 'function_call', call_id: call.call_id, name: call.name, arguments: JSON.stringify(args) });
    input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(numericMetrics(result.metrics)) });
  }
  throw new PublicError('Агент достиг ограничения числа шагов.');
}
