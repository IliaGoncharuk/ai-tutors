import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInitialState, applyAction, ask } from '../server/core.mjs';
import { Repository } from '../server/store.mjs';
import { liveGenerator } from '../server/provider.mjs';
import { DAY, MODEL } from '../server/config.mjs';

if (!process.argv.includes('--live')) throw new Error('Для платного эксперимента укажите --live.');
const question = 'Продолжи с места остановки. Верни только JSON: stage, step, expectedAction — точные значения из актуального состояния задачи. Не проси заново объяснять задачу.';
const directory = mkdtempSync(join(tmpdir(), 'day13-live-'));
let state = applyAction(createInitialState(), { type: 'seed' });
state = applyAction(state, { type: 'set-plan', value: '1. Согласовать отмену.\n2. Описать бронирование.\n3. Проверить требования.' });
const generate = liveGenerator(), runs = [];
try {
  for (const [stage, step, expectedAction] of [
    ['planning', 'Согласовать правило отмены', 'Уточнить отмену за 12 часов'],
    ['execution', 'Описать проверку пересечения интервалов', 'Добавить запрет двойного бронирования в спецификацию'],
    ['validation', 'Проверить отмену за 12 часов', 'Сопоставить правило отмены с критериями приёмки'],
  ]) {
    if (state.workflows[state.activeTask].stage !== stage) state = applyAction(state, { type: 'transition', target: stage });
    state = applyAction(state, { type: 'set-step', step, expectedAction });
    state = applyAction(state, { type: 'pause-task' }); new Repository(directory).write(state);
    const restored = new Repository(directory).read();
    const expected = { stage, step, expectedAction };
    const pauseRestored = restored.workflows[restored.activeTask].paused;
    state = applyAction(restored, { type: 'resume-task' });
    const { state: next, result } = await ask(state, { message: question, mode: 'live', layers: [] }, generate);
    state = next;
    let parsed; try { parsed = JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { parsed = null; }
    runs.push({ expected, pauseRestored, ...result, parsed, checks: Object.entries(expected).map(([field, value]) => ({ field, expected: value, actual: parsed?.[field], pass: parsed?.[field] === value })) });
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
const usage = runs.reduce((t, r) => ({ input: t.input + (r.usage?.input_tokens ?? 0), output: t.output + (r.usage?.output_tokens ?? 0) }), { input: 0, output: 0 });
const passed = runs.flatMap(r => r.checks).filter(c => c.pass).length;
const report = { day: DAY, model: MODEL, generatedAt: new Date().toISOString(), question, usage, passed, total: 9, runs };
const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../results/live'); mkdirSync(folder, { recursive: true });
writeFileSync(resolve(folder, 'results.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(resolve(folder, 'report.md'), `# Продолжение после паузы\n\n${report.generatedAt}; ${MODEL}. Точные входы, вопросы, состояния и ответы: [results.json](results.json).\n\nСценарий — проект записи к репетиторам. На каждом из трёх этапов сохранены конкретный шаг и ожидаемое действие, включена пауза; новый экземпляр Repository восстанавливает файлы и продолжает задачу. В запросах отключены все три слоя памяти: состояние задачи и профиль подключаются отдельно.\n\nРезультат: ${passed}/9 точных значений; восстановлена пауза в ${runs.filter(r => r.pauseRestored).length}/3 случаях. Вход ${usage.input}, выход ${usage.output}, всего ${usage.input + usage.output} токенов.\n\nПроверка измеряет восстановление и использование состояния, а не качество разработки спецификации. Фактический HTTP-перезапуск и запрет действий на паузе проверяются локальными тестами.\n`);
console.log(JSON.stringify({ passed, total: 9, usage, report: folder }));
