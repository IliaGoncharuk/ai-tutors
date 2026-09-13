import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL, normalizeUsage, estimateCost, estimateMaximumCost } from '../accounting.mjs';

const raw = (input, output, cached = 0, written = 0, reasoning = 0) => ({
  input_tokens: input, output_tokens: output, total_tokens: input + output,
  input_tokens_details: { cached_tokens: cached, cache_write_tokens: written },
  output_tokens_details: { reasoning_tokens: reasoning },
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('cost partitions ordinary input, cache reads, cache writes and output without double counting reasoning', () => {
  const usage = normalizeUsage(raw(1000, 200, 600, 100, 80));
  close(estimateCost(usage), 0.000337); // (300*.2 + 600*.02 + 100*.25 + 200*1.2)/1M
  assert.equal(usage.total, 1200);
  assert.equal(usage.output, 200);
  assert.equal(usage.reasoning, 80);
});

test('long-context price starts strictly above 272000 and applies to the whole request', () => {
  close(estimateCost(normalizeUsage(raw(272000, 100))), 0.05452);
  close(estimateCost(normalizeUsage(raw(272001, 100))), 0.1089804);
  close(estimateCost(normalizeUsage(raw(300000, 1000, 100000, 50000))), 0.0908);
  close(estimateMaximumCost(300000, 1000), 0.1518);
  assert.equal(MODEL.contextWindow, 1050000);
});

test('missing, negative and inconsistent usage stay unknown; absent cache details do not invent a price', () => {
  for (const usage of [undefined, {}, raw(-1, 10), { ...raw(10, 20), total_tokens: 99 }, raw(1.5, 10)]) {
    assert.equal(normalizeUsage(usage), null);
  }
  const usage = normalizeUsage({ input_tokens: 10, output_tokens: 20, total_tokens: 30 });
  assert.equal(usage.total, 30);
  assert.equal(usage.cached, null);
  assert.equal(usage.reasoning, null);
  assert.equal(estimateCost(usage), null);
  assert.equal(estimateCost(normalizeUsage(raw(10, 20, 10, 1))), null);
  assert.equal(estimateCost(normalizeUsage(raw(10, 20)), 'different-model'), null);
  assert.equal(estimateCost(null), null);
});
