import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { diffCoordinates, review } from '../server/review.mjs';
const fixtures = JSON.parse(await readFile(new URL('../data/reviews.json', import.meta.url)));
test('diff coordinates map the new side and exclude removed lines', () => {
  const map = diffCoordinates(fixtures[0].diff), file = fixtures[0].files[0].path;
  assert.deepEqual([...map.get(file)], [1, 2, 3, 4, 5]);
});
test('hallucinated file or line cannot become a published review', async () => {
  const fake = { get: () => ({ chunks: [{ source: 'rules.md', text: 'rule', start: 1, end: 1, vector: [1, 0] }] }), embed: async () => [[1, 0]], generate: async () => ({ value: { summary: 'Test', findings: [{ file: 'wrong.mjs', line: 999 }] } }) };
  await assert.rejects(review(fake, fixtures[0]), /пределы diff/);
});
