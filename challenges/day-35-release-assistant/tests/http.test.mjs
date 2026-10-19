import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { Provider } from '../server/provider.mjs';
test('website serves a release form and refuses cross-origin execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-release-http-')), server = createApp(new Provider({ directory }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  try { assert.equal((await fetch(base)).status, 200); const state = await (await fetch(`${base}/api/state`)).json(); assert.equal(state.releaseForm, true); assert.equal((await fetch(`${base}/api/run`, { method: 'POST', headers: { origin: 'https://external.example', 'content-type': 'application/json' }, body: '{}' })).status, 400); } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
