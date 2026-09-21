import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialState, applyAction, compareProfiles } from '../server/core.mjs';
import { liveGenerator } from '../server/provider.mjs';
import { DAY, MODEL } from '../server/config.mjs';

if (!process.argv.includes('--live')) throw new Error('Для платного эксперимента укажите --live.');
const question = 'Предложи, как организовать отмену занятия и избежать двойного бронирования в нашем сервисе. Дай практический следующий шаг.';
const seeded = applyAction(createInitialState(), { type: 'seed' });
const { results: runs } = await compareProfiles(seeded, { message: question, mode: 'live' }, liveGenerator());
const usage = runs.reduce((t, r) => ({ input: t.input + (r.usage?.input_tokens ?? 0), output: t.output + (r.usage?.output_tokens ?? 0) }), { input: 0, output: 0 });
const checks = runs.map(r => ({ profile: r.profile.id, noCodeBlock: !/```/.test(r.text), formatSignal: r.profile.id === 'manager' ? /\|.*\|.*\|/.test(r.text) : r.profile.id === 'expert' ? (r.text.match(/^\s*[1-3][.)]\s/gm) ?? []).length === 3 : /например|представ|пример/iu.test(r.text) }));
const report = { day: DAY, model: MODEL, generatedAt: new Date().toISOString(), question, initialState: seeded, usage, checks, runs };
const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../results/live'); mkdirSync(folder, { recursive: true });
writeFileSync(resolve(folder, 'results.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(resolve(folder, 'report.md'), `# Реальная проверка персонализации\n\n${report.generatedAt}; модель ${MODEL}. Точные профили, исходные записи и все API-входы: [results.json](results.json).\n\nВопрос: ${question}\n\nТри независимых запроса используют одинаковые рабочие и долгосрочные факты активного учебного профиля, без переписки. Меняется только блок предпочтений. Ответы не записываются в память.\n\nТокены: вход ${usage.input}, выход ${usage.output}, всего ${usage.input + usage.output}.\n\nПростые признаки формата (пример / три пункта / таблица): ${checks.filter(c => c.formatSignal).length}/3. Это не полная оценка соблюдения стиля: содержание и ограничения нужно читать в ответах.\n\n${runs.map(r => `## ${r.label}\n\n${r.text}`).join('\n\n')}\n\nОдин ответ на профиль не доказывает устойчивую персонализацию; формальные признаки не оценивают корректность рекомендаций и понятность терминов.\n`);
console.log(JSON.stringify({ checks, usage, report: folder }));
