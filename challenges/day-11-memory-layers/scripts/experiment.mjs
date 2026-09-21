import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialState, applyAction, ask, compare } from '../server/core.mjs';
import { liveGenerator } from '../server/provider.mjs';
import { DAY, MODEL } from '../server/config.mjs';

if (!process.argv.includes('--live')) throw new Error('Для платного эксперимента укажите --live.');
const question = 'Верни только JSON с полями project, minutes, delivery, language, timezone, focus. Используй только явно указанные факты доступной памяти. minutes — строка. focus — временный акцент текущего диалога, а не длительность или тема проекта. Если факт не указан, значение null. Без пояснений и Markdown.';
const seeded = applyAction(createInitialState(), { type: 'seed' });
const generate = liveGenerator();
const runs = [];
const variants = await compare(seeded, { message: question, mode: 'live' }, generate);
runs.push(...variants.results);
for (const [label, action] of [['Новый диалог', { type: 'new-dialog' }], ['Новая задача', { type: 'new-task', title: 'Новый учебный проект' }]]) {
  const result = await ask(applyAction(seeded, action), { message: question, mode: 'live' }, generate);
  runs.push({ label, ...result.result });
}
const all = { project: 'Сервис записи к репетиторам', minutes: '45', delivery: 'веб-приложение', language: 'русский', timezone: 'Asia/Yekaterinburg', focus: 'отмена занятия' };
const expected = [all, { ...all, focus: null }, { ...all, project: null, minutes: null, delivery: null }, { ...all, language: null, timezone: null }, { ...all, focus: null }, { project: null, minutes: null, delivery: null, language: all.language, timezone: all.timezone, focus: null }];
for (let i = 0; i < runs.length; i++) {
  let parsed; try { parsed = JSON.parse(runs[i].text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { parsed = null; }
  runs[i].expected = expected[i]; runs[i].parsed = parsed;
  runs[i].checks = Object.entries(expected[i]).map(([field, value]) => ({ field, expected: value, actual: parsed?.[field], pass: parsed !== null && parsed[field] === value }));
}
const usage = runs.reduce((t, r) => ({ input: t.input + (r.usage?.input_tokens ?? 0), output: t.output + (r.usage?.output_tokens ?? 0) }), { input: 0, output: 0 });
const passed = runs.flatMap(r => r.checks).filter(c => c.pass).length, total = runs.length * 6;
const report = { day: DAY, model: MODEL, generatedAt: new Date().toISOString(), scenario: 'Вымышленное ТЗ сервиса записи к репетиторам', question, initialState: seeded, usage, passed, total, runs };
const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../results/live'); mkdirSync(folder, { recursive: true });
writeFileSync(resolve(folder, 'results.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(resolve(folder, 'report.md'), `# Реальный эксперимент Дня ${DAY}\n\nМодель: ${MODEL}. Дата: ${report.generatedAt}.\n\nИсходные данные, точные входы и ответы: [results.json](results.json). Данные синтетические.\n\nОдин и тот же вопрос задаётся на независимых снимках: все слои, поочерёдное отключение слоя, новый диалог, новая задача. Проверка — строгое совпадение шести значений JSON, включая null; перефразирование может дать отрицательную оценку при верном смысле.\n\nРезультат: **${passed}/${total}**. Токены: вход ${usage.input}, выход ${usage.output}, всего ${usage.input + usage.output}.\n\n| Вариант | Совпало |\n|---|---|\n${runs.map(r => `| ${r.label} | ${r.checks.filter(c => c.pass).length}/6 |`).join('\n')}\n\nЭто один короткий запуск. Он показывает влияние состава контекста, но не доказывает безошибочность модели. Ошибки сохранены без ручной подмены ответов.\n`);
console.log(JSON.stringify({ passed, total, usage, report: folder }));
