import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import OpenAI from 'openai';
import { Agent, AgentError } from './agent.mjs';
import { HistoryError, historyPath, JsonHistoryStore } from './history-store.mjs';
import { PolicyError } from '../day-06-first-agent/policies.mjs';

export async function runChat({
  client,
  file = historyPath(),
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  const write = (text) => output.write(`${text}\n`);
  let agent;
  try {
    agent = new Agent({ client, store: new JsonHistoryStore(file) });
  } catch (error) {
    errorOutput.write(`${error instanceof HistoryError ? error.message : 'Не удалось запустить агента.'}\n`);
    return 1;
  }
  write(`История: ${file}`);
  write(`Восстановлено сообщений: ${agent.getHistory().length}.`);
  write('Команды: /history — показать диалог, /reset — очистить историю, /exit — выйти.');
  const terminal = createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  const prompt = () => { if (input.isTTY) output.write('\nВы: '); };
  prompt();
  try {
    // The iterator also keeps piped lines while an API request is in flight.
    for await (const raw of terminal) {
      const command = raw.trim().toLowerCase();
      if (command === '/exit') break;
      try {
        if (command === '/reset') {
          agent.reset();
          write('Агент: история очищена в памяти и на диске.');
        } else if (command === '/history') {
          const history = agent.getHistory();
          if (!history.length) write('История пуста.');
          for (const message of history) {
            write(`${message.role === 'user' ? 'Вы' : 'Агент'}: ${message.content}`);
          }
        } else if (command) {
          const result = await agent.ask(raw);
          write(`Агент: ${result.text}`);
        }
      } catch (error) {
        const known = error instanceof AgentError || error instanceof PolicyError || error instanceof HistoryError;
        errorOutput.write(`Ошибка: ${known ? error.message : 'Не удалось выполнить команду.'}\n`);
      }
      prompt();
    }
  } finally {
    terminal.close();
  }
  write('До встречи!');
  return 0;
}

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error('OPENAI_API_KEY недоступен. Добавьте ключ в окружение и перезапустите терминал.');
    return 1;
  }
  try {
    return await runChat({
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60_000 }),
    });
  } catch (error) {
    console.error(error instanceof HistoryError ? error.message : 'CLI завершён из-за ошибки ввода.');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
