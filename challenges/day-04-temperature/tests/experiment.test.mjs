import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPlan, extractText, runExperiment, summarize } from '../experiment.mjs';
import { SCENARIOS, executeExperiment } from '../core.mjs';
import { assessText, lexicalDifference } from '../assessment.mjs';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'day04-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function responseFor(temperature, overrides = {}) {
  return {
    model: 'gpt-5.6-luna', temperature, status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [
      { type: 'output_text', text: '12 + 8 − 5 = 15.' },
    ] }],
    usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
    ...overrides,
  };
}

test('paid run sends exactly 9 isolated requests differing only in temperature and saves all texts', async (t) => {
  const outputDir = await temporaryDirectory(t);
  const requests = [];
  const result = await runExperiment({ apiKey: 'test-only-secret', outputDir,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.Authorization, 'Bearer test-only-secret');
      const request = JSON.parse(options.body);
      requests.push(request);
      return Response.json(responseFor(request.temperature));
    },
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(requests.map((request) => request.temperature), [0, 0.7, 1.2, 0, 0.7, 1.2, 0, 0.7, 1.2]);
  const { temperature, ...expected } = createPlan()[0].request;
  for (const { temperature: value, ...request } of requests) assert.deepEqual(request, expected);
  assert.equal('previous_response_id' in expected, false);
  assert.equal('top_p' in expected, false);
  const saved = await readFile(join(outputDir, 'results.json'), 'utf8');
  assert.equal(saved.includes('test-only-secret'), false);
  assert.equal(JSON.parse(saved).runs.length, 9);
  const report = await readFile(join(outputDir, 'report.md'), 'utf8');
  assert.equal((report.match(/> 12 \+ 8 − 5 = 15\./g) ?? []).length, 9);
  assert.deepEqual(summarize(result.runs).map((row) => [row.completed, row.uniqueTexts]), [[3, 1], [3, 1], [3, 1]]);
  await assert.rejects(runExperiment({ apiKey: 'test-only-secret', outputDir,
    fetchImpl: () => assert.fail('Existing results must prevent another paid call'),
  }), /уже существует/);
});

test('no key prevents all calls', async () => {
  await assert.rejects(runExperiment({ apiKey: '', outputDir: '.',
    fetchImpl: () => assert.fail('No network without a key'),
  }), /OPENAI_API_KEY/);
});

test('429 preserves earlier response, stops without retries and does not leak error body', async (t) => {
  const outputDir = await temporaryDirectory(t);
  let calls = 0;
  await assert.rejects(runExperiment({ apiKey: 'test-only-secret', outputDir,
    fetchImpl: async () => ++calls === 1 ? Response.json(responseFor(0)) :
      new Response('sensitive-provider-error', { status: 429 }),
  }), /HTTP 429/);
  assert.equal(calls, 2);
  const saved = await readFile(join(outputDir, 'results.json'), 'utf8');
  assert.equal(saved.includes('sensitive-provider-error'), false);
  assert.equal(saved.includes('test-only-secret'), false);
  const data = JSON.parse(saved);
  assert.equal(data.status, 'failed');
  assert.equal(data.runs[0].text, '12 + 8 − 5 = 15.');
  assert.equal(data.runs[1].status, 'failed');
});

for (const [label, overrides] of [
  ['incomplete response', { status: 'incomplete' }],
  ['empty response', { output: [] }],
  ['temperature mismatch', { temperature: 1 }],
]) {
  test(`${label} cannot be counted as a successful experiment`, async (t) => {
    const outputDir = await temporaryDirectory(t);
    let calls = 0;
    await assert.rejects(runExperiment({ apiKey: 'test-only-secret', outputDir,
      fetchImpl: async () => { calls++; return Response.json(responseFor(0, overrides)); },
    }));
    assert.equal(calls, 1);
    const data = JSON.parse(await readFile(join(outputDir, 'results.json'), 'utf8'));
    assert.equal(data.status, 'failed');
    assert.equal(summarize(data.runs)[0].completed, 0);
  });
}

test('extracts all assistant text parts, skips non-text and non-assistant messages', () => {
  assert.equal(extractText({ output: [
    { type: 'reasoning', content: [{ type: 'output_text', text: 'ignore' }] },
    { type: 'message', role: 'user', content: [{ type: 'output_text', text: 'ignore' }] },
    { type: 'message', role: 'assistant', content: [
      { type: 'output_text', text: 'first' }, { type: 'refusal', refusal: 'ignore' },
      { type: 'output_text', text: 'second' },
    ] },
  ] }), 'first\nsecond');
});

test('dream scenario is used in every paid request and in its saved report', async (t) => {
  const outputDir = await temporaryDirectory(t);
  let calls = 0;
  await runExperiment({ apiKey: 'test-only-secret', outputDir, scenarioId: 'dreams',
    fetchImpl: async (_, options) => {
      const request = JSON.parse(options.body);
      assert.equal(request.input, SCENARIOS.dreams.prompt);
      assert.equal(request.max_output_tokens, 600);
      calls++;
      return Response.json(responseFor(request.temperature));
    },
  });
  assert.equal(calls, 9);
  const report = await readFile(join(outputDir, 'report.md'), 'utf8');
  assert.ok(report.includes(SCENARIOS.dreams.prompt));
  assert.equal(report.includes(SCENARIOS.robots.prompt), false);
  assert.throws(() => createPlan('invalid'), /Неизвестный/);
});

test('shared engine stops before any call when cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await executeExperiment({ apiKey: 'test-only-secret', signal: controller.signal,
    fetchImpl: () => assert.fail('Cancelled experiment must not call API'),
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.runs.length, 0);
});

test('redirect response stops the series without forwarding credentials or following Location', async () => {
  let calls = 0;
  const result = await executeExperiment({ apiKey: 'test-only-secret',
    fetchImpl: async (_, options) => {
      calls++;
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 302, headers: { Location: 'https://example.com/' } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'failed');
  assert.match(result.runs[0].error, /HTTP 302/);
});

test('word count boundaries and lexical distance distinguish length from novelty', () => {
  for (const count of [79, 80, 120, 121]) {
    const result = assessText(Array(count).fill('сон').join(' '), 'dreams');
    assert.equal(result.wordCount, count);
    assert.equal(result.checks[3].ok, count >= 80 && count <= 120);
    assert.equal(result.checks[0].ok, false);
  }
  assert.equal(lexicalDifference(['сон сон', 'сон']), 0);
  assert.equal(lexicalDifference(['сон', 'робот']), 100);
  assert.equal(lexicalDifference(['один']), null);
});
