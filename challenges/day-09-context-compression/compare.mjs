import { pathToFileURL } from 'node:url';
import { Agent, AgentError, MODEL } from './agent.mjs';
import { createLiveClient } from './cli.mjs';
import { scenario, evaluate } from './scenario.mjs';
import { renderComparison } from './report.mjs';
import { createOfflineClient } from './scripts/offline-client.mjs';

export async function runScenario({ client, compression, write = () => {} }) {
  const agent = new Agent({ client, compression });
  const probes = [];
  for (const step of scenario()) {
    try {
      const { text } = await agent.ask(step.prompt);
      if (step.expected) probes.push({ turn: step.turn, text, grade: evaluate(text, step.expected) });
      write(`${compression ? 'Сжатие' : 'Полная история'}: ход ${step.turn}/20 завершён.`);
    } catch (error) {
      write(`Серия остановлена: ${error instanceof AgentError ? error.message : 'не удалось завершить ход'}.`);
      return { agent, probes, completed: false };
    }
  }
  return { agent, probes, completed: true };
}

export async function main(args = process.argv.slice(2), write = console.log) {
  if (args.length !== 1 || !['--offline', '--live'].includes(args[0])) {
    write('Симуляция: npm run demo. Реальный API: npm run demo:live (до 43 генераций; лимит 250000 токенов на режим).');
    return args.length ? 1 : 0;
  }
  const offline = args[0] === '--offline';
  const client = offline ? createOfflineClient() : await createLiveClient();
  write(offline ? 'СИМУЛЯЦИЯ: API не вызывается, списаний нет.' : `РЕАЛЬНЫЙ API: ${MODEL.id}, два режима, без повторов запросов. Данные живут только в памяти процесса.`);
  const full = await runScenario({ client, compression: false, write });
  // A failed baseline cannot produce a matched comparison; avoid additional live spending.
  const compressed = full.completed ? await runScenario({ client, compression: true, write }) :
    { agent: new Agent({ client }), probes: [], completed: false };
  write(renderComparison(full, compressed, offline));
  return full.completed && compressed.completed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) {
    console.error(error instanceof AgentError ? error.message : 'Не удалось выполнить сравнение.');
    process.exitCode = 1;
  }
}
