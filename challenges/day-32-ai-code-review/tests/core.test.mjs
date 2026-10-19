import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Provider } from '../server/provider.mjs';
import { chunkDocuments, cosine, validateCitations } from '../server/rag.mjs';
import { allowedSource } from '../server/repository.mjs';
import { withMcp } from '../server/mcp-client.mjs';
import { createApp } from '../server/index.mjs';
test('budget reservations are shared, atomic and survive restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-tutors-budget-'));
  try { const a = new Provider({ directory }), b = new Provider({ directory }); a.reserve('test', .6); assert.throws(() => b.reserve('test', .5), /бюджет/); b.reserve('test', .4); a.close(); b.close(); const c = new Provider({ directory }); assert.equal(c.budget().reserved, 1); c.close(); } finally { await rm(directory, { recursive: true, force: true }); }
});
test('chunks preserve exact source line ranges; citations reject unknown ids', () => {
  const text = '# Heading\n' + 'Example line\n'.repeat(350); const chunks = chunkDocuments([{ source: 'README.md', text }]);
  assert(chunks.length > 1); for (const c of chunks) assert.equal(c.text.trimEnd(), text.split('\n').slice(c.start - 1, c.end).join('\n').trimEnd());
  assert.equal(cosine([1, 0], [1, 0]), 1); assert.throws(() => validateCitations('[S9]', chunks)); assert.equal(validateCitations('[S1]', chunks).supported, true);
});
test('project source allowlist excludes secrets, generated outputs and traversal', () => {
  for (const path of ['.env', '.git/config', 'docs/../.env', 'challenges/day-31-developer-assistant/results/private.json', 'node_modules/a.js', 'C:/secret.md']) assert.equal(allowedSource(path), false, path);
  assert.equal(allowedSource('docs/agent/CONSTRAINTS.md'), true);
});
test('real MCP process reads current git branch and rejects secret paths', async () => {
  await withMcp(async ({ call, tools }) => { assert(tools.some(t => t.name === 'git_branch')); const value = await call('git_branch'); assert(value.branch); assert(value.head); await assert.rejects(call('read_file', { path: '.env' })); });
});
test('HTTP serves page, refuses cross-origin writes and unknown paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-tutors-http-')); const server = createApp(new Provider({ directory }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const url = `http://127.0.0.1:${server.address().port}`;
  try { assert.equal((await fetch(url)).status, 200); assert.equal((await fetch(`${url}/api/state`)).status, 200); assert.equal((await fetch(`${url}/api/run`, { method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' }, body: '{}' })).status, 400); assert.equal((await fetch(`${url}/.env`)).status, 404); } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
