import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('workerd constructs nine actual Requests and completes the real NDJSON handler without a paid API', async () => {
  const core = await readFile(new URL('../../core.mjs', import.meta.url), 'utf8');
  const handler = (await readFile(new URL('../../web-handler.mjs', import.meta.url), 'utf8')).replace(/^import .*?;\s*/u, '');
  const script = `${core.replace(/^export /gmu, '')}\n${handler.replace(/^export /gmu, '')}\n
    const handle = createWebHandler({ getApiKey: () => 'test-only-secret',
      execute: options => executeExperiment({ ...options, fetchImpl: async (url, init) => {
        const outgoing = new Request(url, init);
        if (outgoing.redirect !== 'manual') throw new Error('Redirect policy changed');
        const body = await outgoing.json();
        return Response.json({ model: body.model, temperature: body.temperature,
          reasoning: body.reasoning, service_tier: body.service_tier, status: 'completed',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Runtime fixture' }] }],
          usage: { input_tokens: 340, output_tokens: 300, total_tokens: 640 }
        });
      } }) });
    export default { fetch: handle };
  `;
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-09-05',
    compatibilityFlags: ['nodejs_compat'], script }));
  try {
    const response = await mf.dispatchFetch('http://localhost:3005/api/compare', { method: 'POST',
      headers: { origin: 'http://localhost:3005', 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmPaidRun: true }) });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body.includes('test-only-secret'), false);
    const snapshots = body.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(snapshots[0].runs.length, 0);
    assert.equal(snapshots.at(-1).status, 'completed');
    assert.equal(snapshots.at(-1).runs.length, 9);
    assert.deepEqual(snapshots.at(-1).runs.map(run => run.request.model),
      [0, 1, 2, 1, 2, 0, 2, 0, 1].map(i => ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'][i]));
    assert.equal((await mf.dispatchFetch('http://localhost:3005/api/compare', { method: 'POST',
      headers: { origin: 'https://example.com' }, body: '{}' })).status, 403);
  } finally { await mf.dispose(); }
});
