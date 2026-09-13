import { pathToFileURL } from 'node:url';
import { Agent, AgentError, INSTRUCTIONS } from './agent.mjs';
import { MODEL, countInput } from './accounting.mjs';
import { MemoryHistoryStore } from './history.mjs';
import { createLiveClient } from './cli.mjs';
import { renderReport, renderPreflight } from './report.mjs';
import { createOfflineClient } from './scripts/offline-client.mjs';

const FILLER = 'Учебная запись: датчик измеряет температуру, наблюдатель записывает результат. ';
export const OVERFLOW_QUESTION = 'Какое контрольное слово было в начале? Ответь только словом.';

export function dialoguePrompts(turns) {
  return Array.from({ length: turns }, (_, index) => index === 0 ?
    'Контрольное слово: Кедр. Запомни его до конца диалога. Подтверди кратко.' :
    index === turns - 1 ? OVERFLOW_QUESTION :
    `Запись ${index}. ${FILLER.repeat(24)} Подтверди получение одним предложением.`);
}

export function syntheticHistory(pairs) {
  return [
    { role: 'user', content: 'Контрольное слово: Кедр. Запомни.' },
    { role: 'assistant', content: 'Принято.' },
    ...Array.from({ length: pairs }, () => [
      { role: 'user', content: FILLER.repeat(60) },
      { role: 'assistant', content: 'Запись принята.' },
    ]).flat(),
  ];
}

export async function runDialogue({ client, turns, contextLimit, write = () => {} }) {
  const agent = new Agent({ client, contextLimit, maxOutputTokens: 96, budgetUsd: 1 });
  for (const prompt of dialoguePrompts(turns)) {
    try {
      const result = await agent.ask(prompt);
      write(`Ход ${result.record.turn}/${turns}: ${result.text}`);
    } catch {
      write('Серия остановлена; причина указана в таблице.');
      break;
    }
  }
  return agent;
}

export async function runOverflow({ client, history, contextLimit, write = () => {} }) {
  const agent = new Agent({ client, store: new MemoryHistoryStore(history),
    contextLimit, maxOutputTokens: 96, budgetUsd: 1 });
  // First demonstrate ordinary agent protection, then explicitly probe the provider.
  for (const allowOverflow of [false, true]) {
    write(allowOverflow ? 'Диагностическая отправка с обходом локальной проверки:' : 'Обычная локальная проверка:');
    try {
      await agent.ask(OVERFLOW_QUESTION, { allowOverflow,
        onPreflight: (record) => write(renderPreflight(record)) });
    } catch { /* Structured, sanitized status is retained in the report. */ }
    if (agent.getRecords().at(-1).status !== 'local_context_limit') break;
  }
  const preserved = JSON.stringify(agent.getHistory()) === JSON.stringify(history);
  write(`История после эксперимента ${preserved ? 'сохранена без изменений' : 'изменилась'}.`);
  return { agent, preserved };
}

// Count a full synthetic payload before sending it; do not infer model token count
// from character length or from multiplying one independently tokenized string.
export async function prepareLiveOverflow(client, write = () => {}) {
  let pairs = 800;
  for (let attempt = 0; attempt < 4; attempt++) {
    const history = syntheticHistory(pairs);
    let count;
    try {
      count = await countInput(client, { model: MODEL.id, instructions: INSTRUCTIONS,
        input: [...history, { role: 'user', content: OVERFLOW_QUESTION }], reasoning: { effort: 'none' } });
    } catch (error) {
      if ((error?.code ?? error?.error?.code) === 'context_length_exceeded') {
        throw new AgentError('count_context_limit', 'Переполнение отклонено самим endpoint подсчёта; генерация не проверена.');
      }
      throw new AgentError('count_failed', 'Не удалось измерить большой вход. Возможны лимиты размера, TPM, квоты или ошибка подключения; переполнение генерации не подтверждено.');
    }
    write(`Подготовка: ${history.length} сообщений, полный вход ${count}/${MODEL.contextWindow} токенов.`);
    if (count > MODEL.contextWindow) return history;
    const next = Math.ceil(pairs * MODEL.contextWindow / Math.max(count, 1) * 1.02);
    pairs = Math.min(4000, Math.max(pairs + 1, next));
  }
  throw new AgentError('fixture_too_small', 'Не удалось получить подтверждённое превышение окна за 4 подсчёта. Генерация не отправлена.');
}

export async function main(args = process.argv.slice(2), write = console.log) {
  if (args.length !== 1 || !['--offline', '--live', '--live-overflow'].includes(args[0])) {
    write('Локально: npm run demo\n23 реальные генерации: npm run demo:live\nБольшой запрос сверх окна: npm run demo:overflow');
    return args.length ? 1 : 0;
  }
  const offline = args[0] === '--offline';
  const contextLimit = offline ? 8192 : MODEL.contextWindow;
  const client = offline ? createOfflineClient({ contextWindow: contextLimit }) : await createLiveClient();
  write(offline ?
    'СИМУЛЯЦИЯ: условные токены и ответы, учебное окно 8192, API не вызывается, списаний нет. USD — иллюстрация формулы по тарифам Luna.' :
    `РЕАЛЬНЫЙ API: ${MODEL.id}, окно ${MODEL.contextWindow}. Расчётный бюджет генерации $1 на серию; повторов запросов нет.`);
  let ok = true;
  if (args[0] !== '--live-overflow') {
    for (const turns of [3, 20]) {
      const agent = await runDialogue({ client, turns, contextLimit, write });
      write(renderReport(agent.getRecords(), `${offline ? 'СИМУЛЯЦИЯ · ' : ''}${turns === 3 ? 'Короткий диалог (3 хода)' : 'Длинный диалог (20 ходов)'}`));
      if (agent.getRecords().filter((record) => record.status === 'completed').length !== turns) {
        ok = false;
        break;
      }
    }
  }
  if (offline || args[0] === '--live-overflow') {
    const history = offline ? syntheticHistory(20) : await prepareLiveOverflow(client, write);
    const { agent, preserved } = await runOverflow({ client, history, contextLimit, write });
    write(renderReport(agent.getRecords(), `${offline ? 'СИМУЛЯЦИЯ · ' : ''}Переполнение`));
    const last = agent.getRecords().at(-1);
    const confirmed = last.status === 'context_length_exceeded' && last.stage === 'генерация';
    write(confirmed ? `Отказ генерации из-за переполнения ${offline ? 'воспроизведён симулятором' : 'подтверждён API'}.` :
      'Ожидаемый отказ генерации не подтверждён. Смотрите фактический этап и статус.');
    ok &&= preserved && confirmed;
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) {
    console.error(error instanceof AgentError ? error.message : 'Не удалось выполнить эксперимент.');
    process.exitCode = 1;
  }
}
