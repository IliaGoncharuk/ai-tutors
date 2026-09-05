import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENARIOS, createPlan, createExperiment, executeExperiment, renderReport } from './core.mjs';
export { PROMPT, TEMPERATURES, createPlan, extractText, summarize, renderReport } from './core.mjs';

export async function runExperiment({ apiKey, outputDir, scenarioId = 'robots', fetchImpl = fetch, onProgress = () => {} }) {
  if (!apiKey?.trim()) throw new Error('OPENAI_API_KEY недоступен. Запросы не отправлены.');
  const experiment = createExperiment(scenarioId);
  const directory = resolve(outputDir);
  await mkdir(directory, { recursive: true });
  const jsonPath = join(directory, 'results.json');
  // Reserve the file before any paid call; never overwrite a previous experiment.
  try {
    await writeFile(jsonPath, JSON.stringify(experiment, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('results.json уже существует. Выберите новый каталог.');
    throw new Error('Не удалось создать results.json. Запросы не отправлены.');
  }

  const result = await executeExperiment({ apiKey, scenarioId, experiment, fetchImpl,
    onProgress: async (snapshot, run) => {
      await writeFile(jsonPath, JSON.stringify(snapshot, null, 2) + '\n');
      await writeFile(join(directory, 'report.md'), renderReport(snapshot));
      onProgress(run, snapshot.runs.length);
    },
  });
  if (result.status === 'failed') throw new Error(result.runs.at(-1).error);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const scenarioIndex = args.indexOf('--scenario');
  let scenarioId = 'robots';
  if (scenarioIndex !== -1) {
    scenarioId = args[scenarioIndex + 1];
    args.splice(scenarioIndex, 2);
    if (!Object.hasOwn(SCENARIOS, scenarioId)) throw new Error('Сценарии: robots, dreams.');
  }
  if (args.length === 1 && args[0] === '--dry-run') {
    console.log(JSON.stringify(createPlan(scenarioId), null, 2));
    return;
  }
  if (args.length !== 3 || args[0] !== '--run' || args[1] !== '--output' || !args[2]) {
    console.log('Без API: node experiment.mjs --dry-run [--scenario dreams]\n9 платных вызовов: node experiment.mjs --run --output results/<новое-имя> [--scenario dreams]');
    if (args.length) process.exitCode = 1;
    return;
  }
  const result = await runExperiment({
    apiKey: process.env.OPENAI_API_KEY,
    outputDir: args[2], scenarioId,
    onProgress: (run, count) => console.log(count + '/9: temperature=' + run.request.temperature + ', повтор=' + run.round + ', ' + run.status),
  });
  console.log('Сохранены ' + result.runs.length + ' ответов: ' + resolve(args[2]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
