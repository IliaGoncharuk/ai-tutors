import { readFile } from 'node:fs/promises';
import { documentation, readSource } from './repository.mjs';
import { indexDocuments } from './rag.mjs';
import { assert } from './provider.mjs';
import { review, workingInput } from './review.mjs';
const fixtures = JSON.parse(await readFile(new URL('../data/reviews.json', import.meta.url), 'utf8'));
export async function build(provider) {
  const documents = await documentation();
  for (const path of ['challenges/day-31-developer-assistant/server/provider.mjs', 'challenges/day-30-private-local-service/server.mjs']) documents.push({ source: path, text: await readSource(path) });
  documents.push({ source: 'fixtures/review-rules.md', text: 'Резервирование бюджета должно учитывать spent + reserved + amount. Лимит общий для параллельных запросов. Если токен сервиса не задан, авторизация должна быть запрещена. Округление суммы для отображения не меняет расчёт расходов.' });
  const index = await indexDocuments(provider, documents); return { documents: index.documents.length, chunks: index.chunks.length, reused: Boolean(index.reused) };
}
export async function run(provider, body) {
  assert(typeof body.question === 'string' && body.question.length <= 3000, 'Некорректная цель ревью.');
  const input = body.fixture === 'working' ? await workingInput() : fixtures.find(f => f.id === body.fixture);
  assert(input, 'Выберите источник diff.'); return review(provider, input, body.question);
}
export function featureState() { return { reviewFixtures: [...fixtures.map(f => ({ value: f.id, label: f.title })), { value: 'working', label: 'Текущие изменения Git (отслеживаемые файлы)' }] }; }
