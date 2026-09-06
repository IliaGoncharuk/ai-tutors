import assert from 'node:assert/strict';
import test from 'node:test';
import { BUDGET_USD, MODELS, createExperiment, createPlan, executeExperiment, normalizeUsage, calculateCost, summarize } from '../core.mjs';
import { evaluatePlan, REFERENCE, assessText } from '../assessment.mjs';
import { runExperiment } from '../experiment.mjs';
import { createWebHandler } from '../web-handler.mjs';

const secret = 'test-only-secret';
export function responseFor(request, overrides = {}) {
  return { model: request.model, temperature: request.temperature, reasoning: request.reasoning,
    service_tier: 'default', status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Выбранные задачи: C, E, F, G\nПорядок: E, F, C, G\nВремя: 8 часов\nБаллы: 29' }] }],
    usage: { input_tokens: 500, output_tokens: 400, total_tokens: 900,
      input_tokens_details: { cached_tokens: 100, cache_write_tokens: 50 }, output_tokens_details: { reasoning_tokens: 0 } },
    ...overrides };
}
const fakeFetch = async (_, init) => Response.json(responseFor(JSON.parse(init.body)));

test('nine isolated calls rotate order and keep results in memory without the key', async () => {
  const requests = [];
  const progress = [];
  const result = await runExperiment({ apiKey: secret, onProgress: async (run, count) => {
    await Promise.resolve();
    progress.push({ id: run.id, count });
  }, fetchImpl: async (url, init) => {
    assert.equal(progress.length, requests.length);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init.redirect, 'manual');
    const request = JSON.parse(init.body); requests.push(request);
    return Response.json(responseFor(request));
  } });
  assert.equal(result.status, 'completed');
  assert.equal(requests.length, 9);
  assert.deepEqual(requests.map(r => r.model), [0, 1, 2, 1, 2, 0, 2, 0, 1].map(i => MODELS[i].id));
  const { model: _, ...expected } = requests[0];
  for (const { model, ...rest } of requests) assert.deepEqual(rest, expected);
  assert.deepEqual(progress, result.runs.map((run, index) => ({ id: run.id, count: index + 1 })));
  assert.equal(JSON.stringify(result).includes(secret), false);
  const next = await runExperiment({ apiKey: secret, fetchImpl: fakeFetch });
  assert.notEqual(next, result);
  assert.notEqual(next.runs, result.runs);
  assert.equal(next.runs.length, 9);
});

test('cost counts ordinary, cached, cache-write and output tokens exactly once', () => {
  const usage = normalizeUsage(responseFor(createPlan()[0].request).usage);
  assert.equal(calculateCost('gpt-5.6-terra', usage), (350 * 2 + 100 * 0.2 + 50 * 2.5 + 400 * 12) / 1e6);
  assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage({ input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 2 } }), null);
  assert.equal(calculateCost('unknown', usage), null);
  assert.ok(createExperiment().reservedCostUsd < BUDGET_USD);
});

for (const [name, overrides] of [
  ['wrong model', { model: 'other' }], ['different temperature', { temperature: 0.7 }],
  ['different reasoning', { reasoning: { effort: 'medium' } }], ['priority tier', { service_tier: 'priority' }],
  ['truncated', { status: 'incomplete' }], ['missing usage', { usage: null }], ['empty', { output: [] }],
]) test(`stops without retry on ${name} and retains the partial response`, async () => {
  let calls = 0;
  const result = await executeExperiment({ apiKey: secret, fetchImpl: async (_, init) => {
    calls++; return Response.json(responseFor(JSON.parse(init.body), overrides));
  } });
  assert.equal(calls, 1); assert.equal(result.status, 'failed'); assert.equal(result.runs.length, 1);
});

test('transport failures and provider errors never expose their raw contents or retry', async () => {
  for (const fetchImpl of [async () => { throw new Error(secret); }, async () => new Response(secret, { status: 429 })]) {
    const result = await executeExperiment({ apiKey: secret, fetchImpl });
    assert.equal(result.status, 'failed'); assert.equal(result.runs.length, 1);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(summarize(result.runs)[0].unknownCosts, 1);
  }
});

test('cancellation and a failed progress callback prevent the next paid call', async () => {
  const abort = new AbortController();
  const cancelled = await executeExperiment({ apiKey: secret, signal: abort.signal, fetchImpl: fakeFetch,
    onProgress: () => abort.abort() });
  assert.equal(cancelled.runs.length, 1); assert.equal(cancelled.status, 'cancelled');
  let count = 0;
  await assert.rejects(executeExperiment({ apiKey: secret, fetchImpl: async (...args) => { count++; return fakeFetch(...args); },
    onProgress: () => { throw new Error('Consumer disconnected'); } }));
  assert.equal(count, 1);
});

test('reference and evaluator distinguish optimality, feasibility, arithmetic, and ordering', () => {
  assert.equal(REFERENCE.examined, 256); assert.equal(REFERENCE.feasible, 62);
  assert.deepEqual(REFERENCE.winners, [{ selected: ['C', 'E', 'F', 'G'], hours: 8, points: 29 }]);
  assert.equal(evaluatePlan(['A', 'B', 'C', 'G']).feasible, true);
  assert.equal(evaluatePlan(['A', 'B', 'C', 'G']).optimal, false);
  assert.equal(evaluatePlan(['C', 'D', 'G']).feasible, false);
  assert.equal(evaluatePlan(['B', 'C', 'G']).feasible, false);
  assert.equal(evaluatePlan(['C', 'E', 'F', 'G', 'H']).feasible, false);
  assert.equal(evaluatePlan(['C', 'C']).feasible, false);
  const badOrder = evaluatePlan(['C', 'E', 'F', 'G'], ['F', 'E', 'C', 'G'], 9, 28);
  assert.equal(badOrder.optimal, true); assert.equal(badOrder.orderValid, false);
  assert.equal(badOrder.hoursCorrect, false); assert.equal(badOrder.pointsCorrect, false);
  assert.equal(assessText('29 баллов. Можно попробовать C, E, F, G.').optimal, null);
  assert.equal(assessText('Выбранные задачи: C, E, F, G\nПорядок: E, F, C, G\nВремя: 8\nБаллы: 29').optimal, true);
  assert.deepEqual(assessText('Выбранные задачи: A, B, C, G\nЭтот набор не оптимален. Исправленный ответ: E, F, C, G.').selected, ['E', 'F', 'C', 'G']);
});

function webRequest(body = { confirmPaidRun: true }, origin = 'http://localhost:3005') {
  return new Request('http://localhost:3005/api/compare', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
test('web origin, fixed parameters, key and paid consent are checked before dispatch', async () => {
  const handle = createWebHandler({ getApiKey: () => null, execute: () => assert.fail('must not dispatch') });
  assert.equal((await handle(webRequest({}, 'https://example.com'))).status, 403);
  assert.equal((await handle(webRequest({}))).status, 400);
  assert.equal((await handle(webRequest({ confirmPaidRun: true, model: 'other' }))).status, 400);
  assert.equal((await handle(webRequest())).status, 503);
});
test('web allows one active series and streams partial results without the key', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const handle = createWebHandler({ getApiKey: () => secret, execute: async options => {
    await gate; return executeExperiment({ ...options, fetchImpl: fakeFetch });
  } });
  const first = await handle(webRequest());
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal((await handle(webRequest())).status, 409);
  release();
  const body = await first.text();
  const snapshots = body.trim().split('\n').map(JSON.parse);
  assert.equal(snapshots[0].runs.length, 0); assert.equal(snapshots.at(-1).runs.length, 9);
  assert.equal(snapshots.at(-1).status, 'completed'); assert.equal(body.includes(secret), false);
});

test('simultaneously parsed request bodies cannot start two paid series', async () => {
  let releaseBodies; let releaseExecution; let calls = 0;
  const bodiesReady = new Promise(resolve => { releaseBodies = resolve; });
  const executionReady = new Promise(resolve => { releaseExecution = resolve; });
  const handle = createWebHandler({ getApiKey: () => secret, execute: async options => {
    calls++; await executionReady; return executeExperiment({ ...options, fetchImpl: fakeFetch });
  } });
  const requests = [webRequest(), webRequest()];
  for (const request of requests) request.json = async () => { await bodiesReady; return { confirmPaidRun: true }; };
  const pending = requests.map(request => handle(request));
  releaseBodies();
  const responses = await Promise.all(pending);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(calls, 1);
  releaseExecution(); await responses.find(r => r.status === 200).text();
});
