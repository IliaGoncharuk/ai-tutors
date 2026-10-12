import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.DAY26_URL || 'http://127.0.0.1:3026';
const cases = [
  { level: 'Простой', prompt: 'Объясни одним предложением, что такое локальная языковая модель.' },
  { level: 'Средний', prompt: 'Назови два преимущества и два ограничения запуска языковой модели локально; ответь по-русски.' },
  { level: 'Сложный', prompt: 'Составь план проверки: сравни два варианта локальной модели на учебных вопросах. Укажи контролируемые условия, три метрики, порядок проведения и два ограничения вывода.' },
];
const statusResponse = await fetch(`${base}/api/status`); const status = await statusResponse.json();
if (!statusResponse.ok || !status.ok || !status.models.length) throw new Error(status.error || 'Загрузите чат-модель и запустите сайт Дня 26.');
const model = status.models[0].id, results = [];
for (const item of cases) {
  const started = performance.now(); const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...item, model }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Запрос к локальной модели завершился ошибкой.');
  results.push({ ...item, model: body.model, answer: body.answer, elapsedMs: body.elapsedMs, roundTripMs: Math.round(performance.now() - started), usage: body.usage });
}
const report = { createdAt: new Date().toISOString(), base, model, requests: results, limitation: 'Три отдельных ответа проверяют доступность и типы запросов. Это не сравнительная оценка моделей.' };
await mkdir(new URL('../results/', import.meta.url), { recursive: true });
await writeFile(new URL('../results/experiment.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(JSON.stringify({ model, requests: results.map(({ level, elapsedMs }) => ({ level, elapsedMs })) }, null, 2) + '\n');
