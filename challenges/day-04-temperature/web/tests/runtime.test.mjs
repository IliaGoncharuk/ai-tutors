import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('workerd executes the real web stream and all nine Request constructions without external API calls', async () => {
  const core = await readFile(new URL('../../core.mjs', import.meta.url), 'utf8');
  const handler = (await readFile(new URL('../../web-handler.mjs', import.meta.url), 'utf8'))
    .replace(/^import .*?;\s*/u, '');
  // Flatten helpers into the fixture; only the fetch handler is a Worker entrypoint.
  const script = `${core.replace(/^export /gmu, '')}\n${handler.replace(/^export /gmu, '')}\n
    const handle = createWebHandler({ getApiKey: () => 'test-only-secret',
      execute: options => executeExperiment({ ...options, fetchImpl: async (url, init) => {
        // Use the actual workerd Request parser, unlike the Node-only test doubles.
        const outgoing = new Request(url, init);
        if (outgoing.redirect !== 'manual') throw new Error('Redirect policy changed');
        const body = await outgoing.json();
        return Response.json({ model: body.model, temperature: body.temperature,
          status: 'completed', output: [{ type: 'message', role: 'assistant',
            content: [{ type: 'output_text', text: 'Runtime test response' }] }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        });
      } }),
    });
    export default { fetch: handle };
  `;
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-09-05',
    compatibilityFlags: ['nodejs_compat'], script,
  }));
  try {
    const response = await mf.dispatchFetch('http://localhost:3004/api/compare', {
      method: 'POST', headers: { origin: 'http://localhost:3004', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'dreams' }),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text.includes('test-only-secret'), false);
    const snapshots = text.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(snapshots[0].runs.length, 0);
    assert.equal(snapshots.at(-1).status, 'completed');
    assert.equal(snapshots.at(-1).runs.length, 9);
    assert.deepEqual(snapshots.at(-1).runs.map(run => run.request.temperature), [0, 0.7, 1.2, 0, 0.7, 1.2, 0, 0.7, 1.2]);
  } finally { await mf.dispose(); }
});
