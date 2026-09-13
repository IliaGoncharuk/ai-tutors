import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Agent, Gateway, ContextError, PolicyError, MODEL, totals } from './agent.mjs';
import { MemoryStore, emptyState } from './store.mjs';
import { createLiveClient } from './cli.mjs';
import { createOfflineClient } from './scripts/offline-client.mjs';
import { COMMON, ENDINGS, evaluate } from './scenario.mjs';
import { renderReport, comparisonTable, renderConclusion, branchesIntact } from './report.mjs';

export async function runComparison({ client, offline = false, write = () => {}, persist = () => {} } = {}) {
  const result = { version: 1, mode: offline ? 'offline' : 'live', startedAt: new Date().toISOString(), model: MODEL.id,
    keepLatest: 6, tokenBudget: 100_000, maxCalls: 63, calls: [], branchActions: [],
    runs: { window: { steps: [], complete: false }, facts: { steps: [], complete: false },
      branching: { steps: [], alternateSteps: [], complete: false, alternateComplete: false } } };
  const gateway = new Gateway({ client, onCall: (call) => { result.calls.push(call); persist(result); } });
  const step = async (agent, spec, list) => {
    const startIndex = result.calls.length; const start = performance.now();
    const response = await agent.ask(spec.prompt);
    const state = agent.getState();
    const session = state.strategy === 'branching' ? state.branching.branches[state.branching.active] : state[state.strategy];
    list.push({ ...response, prompt: spec.prompt, latencyMs: Math.round(performance.now() - start),
      callIndices: Array.from({ length: result.calls.length - startIndex }, (_, i) => startIndex + i),
      grade: spec.expected ? evaluate(response.text, spec.expected, spec.final) : null,
      memory: { messagesCount: session.messages.length, ...(state.strategy === 'facts' ? { facts: session.values } : {}) } });
    persist(result);
    write(`${response.scope}: ход ${response.turn}/15; общий расход ${totals(result.calls).total}/${result.tokenBudget}.`);
    if (totals(result.calls).unknown) throw new ContextError('Usage неизвестен; серия остановлена.');
  };
  for (const strategy of ['window', 'facts', 'branching']) {
    const agent = new Agent({ gateway, store: new MemoryStore(emptyState(result.keepLatest, strategy)) });
    const run = result.runs[strategy];
    try {
      for (const spec of COMMON) await step(agent, spec, run.steps);
      if (strategy === 'branching') {
        agent.checkpoint('platform'); agent.branch('web', 'platform'); agent.branch('bot', 'platform');
        const checkpoint = agent.getState().branching.checkpoints.platform;
        result.branchActions.push({ command: '/checkpoint platform', afterTurn: 12, checkpoint },
          { command: '/branch web platform' }, { command: '/branch bot platform' }, { command: '/switch web' });
        agent.switchBranch('web');
      }
      for (const spec of ENDINGS.web) await step(agent, spec, run.steps);
      run.complete = true;
      if (strategy === 'branching') {
        const webBefore = agent.getState().branching.branches.web;
        result.branchActions.push({ command: '/switch bot' }); agent.switchBranch('bot');
        for (const spec of ENDINGS.bot) await step(agent, spec, run.alternateSteps);
        run.alternateComplete = true;
        agent.switchBranch('web');
        const after = agent.getState().branching;
        result.branchActions.push({ command: '/switch web', active: after.active,
          webUnchanged: JSON.stringify(webBefore) === JSON.stringify(after.branches.web),
          checkpointUnchanged: JSON.stringify(result.branchActions[0].checkpoint) === JSON.stringify(after.checkpoints.platform),
          finalState: after });
      }
    } catch (error) {
      run.error = error instanceof ContextError || error instanceof PolicyError ? error.message : 'Не удалось завершить эксперимент.';
      write(run.error); persist(result); break; // Preserve partial data, do not spend on unmatched subsequent runs.
    }
  }
  result.finishedAt = new Date().toISOString();
  result.complete = Object.values(result.runs).every((r) => r.complete) && result.runs.branching.alternateComplete && totals(result.calls).unknown === 0 && branchesIntact(result);
  persist(result);
  return result;
}

export async function main(args = process.argv.slice(2), write = console.log) {
  if (args.length < 1 || args.length > 2 || !['--live', '--offline'].includes(args[0]) || (args[1] && !args[1].startsWith('--out='))) {
    write('npm run demo [-- --out=PATH] или npm run demo:live [-- --out=PATH]. До 63 генераций, общий лимит 100000 токенов.');
    return 1;
  }
  const offline = args[0] === '--offline';
  const client = offline ? createOfflineClient() : await createLiveClient();
  const directory = resolve(args[1]?.slice('--out='.length) || join('results', `${offline ? 'offline' : 'live'}-${new Date().toISOString().replace(/[:.]/g, '-')}`));
  // Refuse to overwrite any prior run before a paid request is made.
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'results.json'), '{}\n', { flag: 'wx' });
  const persist = (result) => {
    const temporary = join(directory, 'results.json.tmp');
    writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', { flush: true });
    renameSync(temporary, join(directory, 'results.json'));
  };
  write(offline ? 'СИМУЛЯЦИЯ: API не вызывается. Токены и ответы условные.' : `РЕАЛЬНЫЙ API: ${MODEL.id}, 63 генерации максимум, без повторов, лимит 100000 токенов на всю серию.`);
  const result = await runComparison({ client, offline, write, persist });
  writeFileSync(join(directory, 'report.md'), renderReport(result));
  write(comparisonTable(result)); write(renderConclusion(result));
  write(`Полный отчёт: ${join(directory, 'report.md')}`);
  write(`Данные запросов и ответов: ${join(directory, 'results.json')}`);
  return result.complete ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error instanceof ContextError ? error.message : 'Не удалось создать протокол или начать сравнение. Выберите новый --out и проверьте права.'); process.exitCode = 1; }
}
