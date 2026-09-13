import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import OpenAI from 'openai';
import { Agent, Gateway, FACT_INSTRUCTIONS, FACT_FORMAT, FACT_PREFIX, INSTRUCTIONS, applyFactUpdates, totals } from '../agent.mjs';
import { JsonStore, MemoryStore, emptyState, contextPath } from '../store.mjs';
import { createOfflineClient } from '../scripts/offline-client.mjs';
import { runChat, parseOptions } from '../cli.mjs';
import { runComparison } from '../compare.mjs';
import { metric, renderReport, renderConclusion } from '../report.mjs';
import { COMMON, ENDINGS, evaluate } from '../scenario.mjs';

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-tutors-day10-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('ai-tutors-day10-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
test('installed SDK sends counted context and schema verbatim, parses usage, with no hidden conversation or summary', async () => {
  const requests = []; const fake = createOfflineClient();
  const client = new OpenAI({ apiKey: 'offline-test', maxRetries: 0, fetch: async (url, init) => {
    const path = new URL(url).pathname; const body = JSON.parse(init.body); requests.push({ path, body });
    if (path === '/v1/responses/input_tokens') return Response.json(await fake.responses.inputTokens.count(body));
    assert.equal(path, '/v1/responses');
    const { output_text: text, ...rest } = await fake.responses.create(body);
    return Response.json({ ...rest, id: 'resp_offline', object: 'response', output: [
      { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] },
    ] });
  } });
  const gateway = new Gateway({ client }); const agent = new Agent({ gateway, store: new MemoryStore(emptyState(6, 'facts')) });
  await agent.ask('Бюджет: 90000.');
  assert.equal(requests.length, 4);
  for (let i = 0; i < requests.length; i += 2) {
    const count = requests[i].body, create = requests[i + 1].body;
    for (const key of ['model', 'instructions', 'input', 'reasoning', 'text']) assert.deepEqual(count[key], create[key]);
    assert.equal(create.store, false); assert.equal(create.truncation, 'disabled');
    for (const key of ['previous_response_id', 'conversation', 'context_management']) assert.equal(Object.hasOwn(create, key), false);
  }
  assert.equal(requests[1].body.instructions, FACT_INSTRUCTIONS);
  assert.equal(requests[1].body.text.format.type, 'json_schema');
  assert.ok(gateway.records().every((r) => r.usage?.total > 0));
});
test('matched fixture uses 63 calls, separately accounts bot continuation, and detects evicted facts', async () => {
  const result = await runComparison({ client: createOfflineClient(), offline: true });
  assert.equal(result.complete, true); assert.equal(result.calls.length, 63);
  assert.equal(metric(result, 'facts').calls, 30); assert.equal(metric(result, 'branching').calls, 15);
  assert.equal(metric(result, 'branching', true).calls, 3);
  assert.equal(metric(result, 'facts').score, 39); assert.equal(metric(result, 'branching').score, 39);
  assert.ok(metric(result, 'window').score < 39);
  assert.equal(metric(result, 'branching', true).score, 15);
  assert.equal(result.branchActions.at(-1).webUnchanged, true); assert.equal(result.branchActions.at(-1).checkpointUnchanged, true);
  for (const name of ['window', 'facts', 'branching']) assert.deepEqual(result.runs[name].steps.map((step) => step.prompt), result.runs.window.steps.map((step) => step.prompt));
  assert.ok(renderReport(result).includes('СИМУЛЯЦИЯ'));
  assert.ok(renderConclusion(result).includes('ПРОЙДЕНО'));
  assert.equal(evaluate('{"budget":60000}', { budget: 90000 }).score, 0);
  assert.equal(evaluate('not json', { budget: 90000 }).validJson, false);
});
test('an API failure saves partial results and stops subsequent unmatched runs', async () => {
  const client = createOfflineClient(); const create = client.responses.create; let count = 0; let saves = 0;
  client.responses.create = async (payload) => { if (++count === 3) throw new Error('provider data must not leak'); return create(payload); };
  const result = await runComparison({ client, persist: () => { saves++; } });
  assert.equal(result.complete, false); assert.equal(result.runs.window.steps.length, 2);
  assert.equal(result.runs.facts.steps.length, 0); assert.ok(saves > 2);
  assert.equal(JSON.stringify(result).includes('provider data must not leak'), false);
  const conclusion = renderConclusion(result);
  assert.ok(conclusion.includes('не завершены полностью'));
  assert.ok(conclusion.includes('неизвестный расход'));
  assert.ok(!conclusion.includes('Минимальный расход'));
});
test('facts, checkpoints, selected mode and branch survive two separate CLI processes', (t) => {
  const file = join(temporary(t), 'context.json');
  const script = `import {runChat} from './cli.mjs'; import {createOfflineClient} from './scripts/offline-client.mjs'; await runChat({client:createOfflineClient(),file:process.argv[1]});`;
  const run = (input) => spawnSync(process.execPath, ['--input-type=module', '-e', script, file], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), input, encoding: 'utf8',
  });
  const first = run('/strategy facts\nБюджет: 90000.\n/strategy branching\nПроект: Репетитор рядом.\n/checkpoint base\n/branch web base\n/branch bot base\n/switch web\nПлатформа: адаптивный сайт.\n/exit\n');
  assert.equal(first.status, 0, first.stderr);
  const state = new JsonStore(file).load(); assert.equal(state.branching.active, 'web');
  const second = run('/facts\n/switch bot\nПлатформа: Telegram-бот.\n/exit\n');
  assert.equal(second.status, 0, second.stderr); assert.ok(second.stdout.includes('90000'));
  const restored = new JsonStore(file).load();
  assert.deepEqual(restored.branching.branches.web, state.branching.branches.web);
  assert.deepEqual(restored.branching.checkpoints, state.branching.checkpoints);
  assert.equal(restored.branching.active, 'bot'); assert.equal(restored.facts.values.budget, '90000');
});
test('invalid disk state is never overwritten, options validated, read-only commands do not call API', async (t) => {
  const file = join(temporary(t), 'context.json'); writeFileSync(file, '{broken');
  assert.throws(() => new JsonStore(file).load()); assert.equal(readFileSync(file, 'utf8'), '{broken');
  assert.throws(() => contextPath({ STRATEGIES_AGENT_FILE: 'relative.json' }));
  for (const args of [['--keep=3'], ['--strategy=summary'], ['--keep=6', '--keep=8'], ['--keep=2e1']]) assert.throws(() => parseOptions(args));
  assert.deepEqual(parseOptions(['--strategy=facts', '--keep=8']), { strategy: 'facts', keep: 8 });
  new JsonStore(file).save(emptyState());
  let output = ''; const writable = new Writable({ write(chunk, _, done) { output += chunk; done(); } });
  const result = await runChat({ client: createOfflineClient(), file,
    input: Readable.from(['/strategy facts\n/facts\n/history\n/stats\n/branches\n/reset\n/exit\n']), output: writable });
  assert.equal(result.gateway.records().length, 0); assert.ok(output.includes('facts'));
});

test('saved real run reconstructs the exact allowed context and all grades, without an API call', () => {
  const result = JSON.parse(readFileSync(new URL('../results/2026-09-13-live/results.json', import.meta.url), 'utf8'));
  assert.equal(result.mode, 'live'); assert.equal(result.complete, true);
  assert.equal(result.calls.length, 63); assert.equal(totals(result.calls).total, 46920);
  assert.ok(result.calls.every((call) => call.sent && call.status === 'completed' && call.usage && call.countedInput + call.payload.max_output_tokens <= 100000));
  const used = new Set();
  const replay = (steps, specs, strategy, initial = []) => {
    let history = structuredClone(initial); let facts = {};
    steps.forEach((step, index) => {
      const spec = specs[index]; assert.equal(step.prompt, spec.prompt);
      const calls = step.callIndices.map((i) => { assert.equal(used.has(i), false); used.add(i); return result.calls[i]; });
      assert.equal(calls.length, strategy === 'facts' ? 2 : 1);
      if (strategy === 'facts') {
        assert.equal(calls[0].payload.instructions, FACT_INSTRUCTIONS);
        assert.deepEqual(calls[0].payload.text.format, FACT_FORMAT);
        assert.deepEqual(JSON.parse(calls[0].payload.input[0].content), { previousFacts: facts, recentMessages: history, userMessage: spec.prompt });
        facts = applyFactUpdates(facts, calls[0].responseText);
        assert.deepEqual(step.memory.facts, facts);
      }
      const answer = calls.at(-1);
      assert.equal(answer.payload.instructions, INSTRUCTIONS); assert.equal(answer.responseText, step.text);
      assert.deepEqual(answer.payload.input, [...(strategy === 'facts' ? [{ role: 'user', content: FACT_PREFIX + JSON.stringify(facts) }] : []), ...history, { role: 'user', content: spec.prompt }]);
      assert.deepEqual(step.grade, spec.expected ? evaluate(step.text, spec.expected, spec.final) : null);
      history.push({ role: 'user', content: spec.prompt }, { role: 'assistant', content: step.text });
      if (strategy !== 'branching') history = history.slice(-6);
      assert.equal(step.memory.messagesCount, history.length);
    });
    return history;
  };
  replay(result.runs.window.steps, [...COMMON, ...ENDINGS.web], 'window');
  replay(result.runs.facts.steps, [...COMMON, ...ENDINGS.web], 'facts');
  const prefix = replay(result.runs.branching.steps.slice(0, 12), COMMON, 'branching');
  const web = replay(result.runs.branching.steps.slice(12), ENDINGS.web, 'branching', prefix);
  const bot = replay(result.runs.branching.alternateSteps, ENDINGS.bot, 'branching', prefix);
  const b = result.branchActions.at(-1).finalState;
  assert.deepEqual(b.branches.web.messages, web); assert.deepEqual(b.branches.bot.messages, bot);
  assert.deepEqual(b.checkpoints.platform.messages, prefix); assert.equal(b.active, 'web');
  assert.equal(used.size, 63);
  const conclusion = renderConclusion(result);
  assert.ok(conclusion.includes('Всего генераций: 63'));
  assert.ok(conclusion.includes('facts: итоговое ТЗ — 13/15'));
  assert.ok(conclusion.includes('57.7%'));
  const damaged = structuredClone(result);
  damaged.branchActions.at(-1).webUnchanged = false;
  assert.ok(renderConclusion(damaged).includes('ОШИБКА'));
  assert.ok(!renderConclusion(damaged).includes('Минимальный расход'));
});
