import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { Agent, AgentError, MODEL, PolicyError } from './agent.mjs';
import { contextPath, HistoryError, JsonContextStore } from './context-store.mjs';
import { renderStats } from './report.mjs';

export async function createLiveClient() {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new AgentError('missing_key', 'Добавьте OPENAI_API_KEY в окружение терминала.');
  const { default: OpenAI } = await import('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60_000 });
}

export function parseOptions(args) {
  const options = { compression: true, keepLatest: 6, compressEvery: 10 };
  const seen = new Set();
  for (const arg of args) {
    const key = arg.split('=')[0];
    if (seen.has(key)) throw new AgentError('options', 'Не повторяйте параметры запуска.');
    seen.add(key);
    if (arg === '--full') options.compression = false;
    else if (/^--(?:keep|every)=\d+$/.test(arg)) {
      const value = Number(arg.split('=')[1]);
      if (!Number.isSafeInteger(value) || value < 2 || value % 2) throw new AgentError('options', 'N и интервал — чётные числа от 2: считаются отдельные сообщения user и assistant.');
      options[key === '--keep' ? 'keepLatest' : 'compressEvery'] = value;
    } else throw new AgentError('options', 'Параметры: --full, --keep=6, --every=10.');
  }
  return options;
}

export async function runChat({ client, options = {}, file = contextPath(process.env, options.compression !== false),
  input = process.stdin, output = process.stdout, errorOutput = process.stderr } = {}) {
  const agent = new Agent({ client, store: new JsonContextStore(file), ...options });
  const write = (value) => output.write(`${value}\n`);
  const memory = agent.getContext();
  write(`День 9 · ${MODEL.id} · ${options.compression === false ? 'полная история' : `сжатие: N=${options.keepLatest ?? 6}, интервал=${options.compressEvery ?? 10}`}.`);
  write(`Память: ${file}. Свежих сообщений: ${memory.recentMessages.length}; в summary: ${memory.summarizedMessages}.`);
  write('Команды: /summary, /history, /stats, /reset, /exit. Лимит генераций за процесс: 250000 токенов.');
  write('Расход включает создание summary; /reset его не обнуляет. Подсчёт входа выполняет API.');
  const terminal = createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  const prompt = () => { if (input.isTTY) output.write('\nВы: '); };
  prompt();
  try {
    for await (const raw of terminal) {
      const command = raw.trim().toLowerCase();
      if (command === '/exit') break;
      if (!command) { prompt(); continue; }
      try {
        if (command === '/summary') write(agent.getContext().summary || 'Summary пока нет.');
        else if (command === '/history') {
          const context = agent.getContext();
          write(`В summary: ${context.summarizedMessages}; дословных сообщений: ${context.recentMessages.length}.`);
          for (const message of context.recentMessages) write(`${message.role}: ${message.content}`);
        } else if (command === '/stats') write(renderStats(agent));
        else if (command === '/reset') { agent.reset(); write('Память очищена. Расход текущего запуска сохранён.'); }
        else if (command.startsWith('/')) write('Неизвестная команда. Доступны /summary, /history, /stats, /reset, /exit.');
        else {
          const result = await agent.ask(raw);
          write(`Агент: ${result.text}`);
          write(`Вход до/после сжатия: ${result.turn.before}/${result.turn.after}; сжато сообщений: ${result.turn.compressedMessages}.`);
          write(renderStats(agent));
        }
      } catch (error) {
        const known = error instanceof AgentError || error instanceof HistoryError || error instanceof PolicyError;
        errorOutput.write(`Ошибка: ${known ? error.message : 'Не удалось выполнить команду.'}\n`);
        write(renderStats(agent));
      }
      prompt();
    }
  } finally { terminal.close(); }
  write('До встречи!');
  return agent;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    await runChat({ client: await createLiveClient(), options });
  } catch (error) {
    console.error(error instanceof AgentError || error instanceof HistoryError ? error.message : 'Не удалось запустить CLI.');
    process.exitCode = 1;
  }
}
