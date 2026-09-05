import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebHandler } from '../web-handler.mjs';

function request(body = { scenarioId: 'dreams' }, origin = 'http://localhost:3004') {
  return new Request('http://localhost:3004/api/compare', { method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('web endpoint rejects cross-origin, invalid scenario and missing key without invoking API', async () => {
  const handler = createWebHandler({ getApiKey: () => '', execute: () => assert.fail('No paid calls') });
  assert.equal((await handler(request({}, 'https://example.com'))).status, 403);
  assert.equal((await handler(request({ scenarioId: 'wrong' }))).status, 400);
  assert.equal((await handler(request())).status, 503);
});

test('web endpoint streams all snapshots and protects one running series from duplicate submission', async () => {
  let finish;
  let calls = 0;
  const gate = new Promise(resolve => { finish = resolve; });
  const handler = createWebHandler({ getApiKey: () => 'test-only-secret',
    execute: async ({ apiKey, scenarioId, experiment, onProgress }) => {
      calls++;
      assert.equal(apiKey, 'test-only-secret');
      assert.equal(scenarioId, 'dreams');
      await gate;
      for (let i = 0; i < 9; i++) {
        experiment.runs.push({ status: 'completed', text: `response ${i}` });
        await onProgress(experiment);
      }
      experiment.status = 'completed';
      return experiment;
    },
  });
  const first = await handler(request());
  assert.equal(first.status, 200);
  assert.equal((await handler(request())).status, 409);
  assert.equal(calls, 1);
  finish();
  const text = await first.text();
  assert.equal(text.includes('test-only-secret'), false);
  const snapshots = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(snapshots[0].runs.length, 0);
  assert.equal(snapshots.at(-1).runs.length, 9);
  assert.equal(snapshots.at(-1).status, 'completed');
  assert.equal((await handler(request({ scenarioId: 'wrong' }))).status, 400);
});

test('web failure is redacted and preserves partial results', async () => {
  const handler = createWebHandler({ getApiKey: () => 'test-only-secret',
    execute: async ({ experiment }) => {
      experiment.runs.push({ status: 'completed', text: 'partial answer' });
      throw new Error('test-only-secret');
    },
  });
  const text = await (await handler(request())).text();
  assert.equal(text.includes('test-only-secret'), false);
  const last = JSON.parse(text.trim().split('\n').at(-1));
  assert.equal(last.status, 'failed');
  assert.equal(last.runs[0].text, 'partial answer');
});
