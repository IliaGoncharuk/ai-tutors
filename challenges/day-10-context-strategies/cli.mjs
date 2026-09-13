import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { Agent, Gateway, ContextError, PolicyError, MODEL, totals } from './agent.mjs';
import { contextPath, emptyState, JsonStore, validateState } from './store.mjs';

export async function createLiveClient() {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new ContextError('Добавьте OPENAI_API_KEY в окружение терминала.');
  const { default: OpenAI } = await import('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60_000 });
}
export function parseOptions(args) {
  const options = {};
  for (const arg of args) {
    const match = /^--(strategy|keep)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(options, match[1])) throw new ContextError('Параметры: --strategy=window|facts|branching, --keep=6; без повторов.');
    if (match[1] === 'keep' && !/^\d+$/.test(match[2])) throw new ContextError('N — чётное целое от 2 до 1000.');
    options[match[1]] = match[1] === 'keep' ? Number(match[2]) : match[2];
  }
  validateState(emptyState(options.keep ?? 6, options.strategy ?? 'window'));
  return options;
}
export function describe(agent) {
  const state = agent.getState(); const b = state.branching;
  const session = state.strategy === 'branching' ? b.branches[b.active] : state[state.strategy];
  return `${state.strategy}${state.strategy === 'branching' ? `:${b.active}` : ` (N=${state.keepLatest})`} · ходов ${session.turns} · сообщений ${session.messages.length}`;
}
export function stats(gateway) {
  const all = totals(gateway.records()); const facts = totals(gateway.records().filter((r) => r.kind === 'facts'));
  return `API: ${all.calls}/${gateway.maxCalls}; вход ${all.input}, выход ${all.output}, всего ${all.total}/${gateway.tokenBudget}; из них facts ${facts.total}; неизвестный расход ${all.unknown}.`;
}
const HELP = '/strategy window|facts|branching, /facts, /history, /checkpoint NAME, /branch NAME CHECKPOINT, /switch NAME, /branches, /stats, /reset, /exit';
export async function runChat({ client, options = {}, file = contextPath(), input = process.stdin, output = process.stdout, errorOutput = process.stderr } = {}) {
  const store = new JsonStore(file, emptyState(options.keep ?? 6, options.strategy ?? 'window'));
  const saved = store.load();
  if (options.keep !== undefined && options.keep !== saved.keepLatest) throw new ContextError('N сохранён в памяти. Для другого N задайте новый STRATEGIES_AGENT_FILE.');
  const gateway = new Gateway({ client }); const agent = new Agent({ gateway, store });
  if (options.strategy !== undefined && options.strategy !== saved.strategy) agent.switchStrategy(options.strategy);
  const write = (line) => output.write(`${line}\n`);
  write(`День 10 · ${MODEL.id}. Память: ${file}\n${describe(agent)}\n${HELP}`);
  write('Режимы сохраняют отдельные диалоги. /branch создаёт ветку, /switch выбирает её. /reset очищает все режимы и ветки. Расход сохраняется до завершения процесса.');
  const terminal = createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  const prompt = () => { if (input.isTTY) output.write('\nВы: '); };
  prompt();
  try {
    for await (const raw of terminal) {
      const parts = raw.trim().split(/\s+/); const command = parts[0];
      if (command === '/exit' && parts.length === 1) break;
      if (!command) continue;
      try {
        if (!command.startsWith('/')) { const result = await agent.ask(raw); write(`Агент: ${result.text}\n${stats(gateway)}`); }
        else if (command === '/strategy' && parts.length === 2) agent.switchStrategy(parts[1]);
        else if (command === '/checkpoint' && parts.length === 2) agent.checkpoint(parts[1]);
        else if (command === '/branch' && parts.length === 3) agent.branch(parts[1], parts[2]);
        else if (command === '/switch' && parts.length === 2) agent.switchBranch(parts[1]);
        else if (command === '/reset' && parts.length === 1) { agent.reset(); write('Вся память очищена.'); }
        else if (command === '/stats' && parts.length === 1) write(stats(gateway));
        else if (command === '/facts' && parts.length === 1) write(JSON.stringify(agent.getState().facts.values, null, 2));
        else if (command === '/branches' && parts.length === 1) {
          const b = agent.getState().branching;
          write(`Ветки: ${Object.keys(b.branches).join(', ')}; активна ${b.active}. Checkpoints: ${Object.keys(b.checkpoints).join(', ') || 'нет'}.`);
        } else if (command === '/history' && parts.length === 1) {
          const s = agent.getState();
          const session = s.strategy === 'branching' ? s.branching.branches[s.branching.active] : s[s.strategy];
          for (const message of session.messages) write(`${message.role}: ${message.content}`);
        } else write(HELP);
        write(describe(agent));
      } catch (error) {
        errorOutput.write(`Ошибка: ${error instanceof ContextError || error instanceof PolicyError ? error.message : 'Не удалось выполнить команду.'}\n`);
        write(stats(gateway));
      }
      prompt();
    }
  } finally { terminal.close(); }
  return { agent, gateway };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const options = parseOptions(process.argv.slice(2)); await runChat({ client: await createLiveClient(), options }); }
  catch (error) { console.error(error instanceof ContextError ? error.message : 'Не удалось запустить CLI.'); process.exitCode = 1; }
}
