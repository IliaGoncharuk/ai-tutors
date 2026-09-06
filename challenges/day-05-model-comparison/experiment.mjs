import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlan, createExperiment, executeExperiment, renderReport } from './core.mjs';

export async function runExperiment({ apiKey, fetchImpl = fetch, onProgress = () => {} }) {
  return executeExperiment({ apiKey, fetchImpl, onProgress: async (snapshot, run) => {
    if (run) await onProgress(run, snapshot.runs.length);
  } });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--dry-run') {
    console.log(JSON.stringify({ ...createExperiment(), plan: createPlan() }, null, 2)); return;
  }
  if (args.length !== 1 || args[0] !== '--run') {
    console.log('Без API: node experiment.mjs --dry-run\n9 платных вызовов: node experiment.mjs --run\nРезультаты выводятся только в терминал; файлы не создаются.');
    if (args.length) process.exitCode = 1;
    return;
  }
  const result = await runExperiment({ apiKey: process.env.OPENAI_API_KEY,
    onProgress: (run, count) => console.log(`${count}/9: ${run.request.model}, повтор ${run.round}, ${run.status}, ${run.durationMs} мс, $${run.costUsd?.toFixed(6) ?? '?'}`),
  });
  console.log(renderReport(result));
  if (result.status !== 'completed') { console.error(result.error ?? result.runs.at(-1)?.error); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Не удалось выполнить эксперимент. Проверьте окружение.'); process.exitCode = 1; });
}
