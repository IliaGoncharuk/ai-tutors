import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { Agent, AgentError } from './agent.mjs';
import { MODEL } from './accounting.mjs';
import { historyPath, HistoryError, JsonHistoryStore } from './history.mjs';
import { PolicyError } from '../day-06-first-agent/policies.mjs';
import { renderPreflight, renderTurn, renderTotals, renderReport } from './report.mjs';

export async function createLiveClient() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new AgentError('missing_key', 'OPENAI_API_KEY недоступен. Добавьте ключ в окружение терминала.');
  }
  const { default: OpenAI } = await import('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60_000 });
}

export async function runChat({ client, file = historyPath(), input = process.stdin,
  output = process.stdout, errorOutput = process.stderr } = {}) {
  const write = (value) => output.write(`${value}\n`);
  const agent = new Agent({ client, store: new JsonHistoryStore(file) });
  write(`День 8 · ${MODEL.id} · контекст ${MODEL.contextWindow} токенов.`);
  write(`История: ${file}. Восстановлено сообщений: ${agent.getHistory().length}.`);
  write('Стоимость и расход считаются за текущий запуск; /reset их не обнуляет.');
  write('Подсчёт входа выполняет API (2–3 обращения перед каждой генерацией).');
  write('Команды: /history, /stats, /reset, /exit.');
  const terminal = createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  const prompt = () => { if (input.isTTY) output.write('\nВы: '); };
  prompt();
  try {
    for await (const raw of terminal) {
      const command = raw.trim().toLowerCase();
      if (command === '/exit') break;
      if (!command) { prompt(); continue; }
      const before = agent.getRecords().length;
      try {
        if (command === '/reset') {
          agent.reset();
          write('История очищена в памяти и на диске. Расход текущего запуска сохранён.');
        } else if (command === '/history') {
          const messages = agent.getHistory();
          if (!messages.length) write('История пуста.');
          for (const message of messages) write(`${message.role}: ${message.content}`);
        } else if (command === '/stats') {
          write(renderReport(agent.getRecords(), 'Статистика текущего запуска'));
        } else if (command.startsWith('/')) {
          write('Неизвестная команда. Доступны /history, /stats, /reset, /exit.');
        } else {
          const result = await agent.ask(raw, { onPreflight: (record) => write(renderPreflight(record)) });
          write(`Агент: ${result.text}`);
        }
      } catch (error) {
        const known = error instanceof AgentError || error instanceof HistoryError || error instanceof PolicyError;
        errorOutput.write(`Ошибка: ${known ? error.message : 'Не удалось выполнить команду.'}\n`);
      }
      const records = agent.getRecords();
      if (records.length > before) {
        write(renderTurn(records.at(-1)));
        write(renderTotals(records));
      }
      prompt();
    }
  } finally { terminal.close(); }
  write('До встречи!');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runChat({ client: await createLiveClient() }); }
  catch (error) {
    console.error(error instanceof AgentError || error instanceof HistoryError ? error.message : 'Не удалось запустить CLI.');
    process.exitCode = 1;
  }
}
