import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { Agent, SUMMARY_INSTRUCTIONS } from '../agent.mjs';
import { contextPath, emptyContext, JsonContextStore, validateContext } from '../context-store.mjs';
import { runChat, parseOptions } from '../cli.mjs';
import { runScenario, main } from '../compare.mjs';
import { evaluate } from '../scenario.mjs';
import { netSavings, renderComparison, renderStats } from '../report.mjs';
import { createOfflineClient } from '../scripts/offline-client.mjs';

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-tutors-day09-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('ai-tutors-day09-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test('installed SDK uses the intended count/create payloads, parses usage and never makes a real request', async () => {
  const requests = [];
  const stub = createOfflineClient();
  const client = new OpenAI({ apiKey: 'offline-test', maxRetries: 0, fetch: async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    requests.push({ path, body });
    if (path === '/v1/responses/input_tokens') return Response.json(await stub.responses.inputTokens.count(body));
    assert.equal(path, '/v1/responses');
    const response = await stub.responses.create(body);
    const { output_text: text, ...rest } = response;
    return Response.json({ ...rest, id: 'resp_offline', object: 'response', output: [
      { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] },
    ] });
  } });
  const agent = new Agent({ client });
  for (let i = 0; i < 6; i++) await agent.ask(`Проект: Маяк. Запись ${i}.`);
  const generations = requests.filter((r) => r.path === '/v1/responses');
  assert.equal(generations.length, 7);
  assert.equal(generations.filter((r) => r.body.instructions === SUMMARY_INSTRUCTIONS).length, 1);
  for (const generation of generations) {
    const count = requests.slice(0, requests.indexOf(generation)).findLast((r) => r.path === '/v1/responses/input_tokens');
    assert.deepEqual(count.body.input, generation.body.input);
    assert.equal(count.body.instructions, generation.body.instructions);
    assert.equal(generation.body.store, false);
    assert.equal(generation.body.truncation, 'disabled');
  }
  assert.equal(agent.getTotals().unknown, 0);
  assert.ok(agent.getContext().summary.includes('Маяк'));
});

test('matched scenario measures net spending including summary and detects deliberately lost facts', async () => {
  const full = await runScenario({ client: createOfflineClient(), compression: false });
  const compressed = await runScenario({ client: createOfflineClient(), compression: true });
  assert.ok(full.completed && compressed.completed);
  assert.ok([...full.probes, ...compressed.probes].every((p) => p.grade.score === 8));
  assert.equal(compressed.agent.getTotals('summary').calls, 3);
  assert.equal(compressed.agent.getContext().summarizedMessages, 24);
  assert.equal(compressed.agent.getContext().recentMessages.length, 16);
  assert.ok(compressed.agent.getContext().summary.includes('9000')); // Supersedes old budget.
  const savings = netSavings(full, compressed);
  assert.ok(savings.percent > 0 && savings.percent < 100);
  assert.equal(savings.tokens, full.agent.getTotals().total - compressed.agent.getTotals('answer').total - compressed.agent.getTotals('summary').total);
  const lossy = await runScenario({ client: createOfflineClient({ omitSummaryKeys: ['code'] }), compression: true });
  assert.ok(lossy.probes.every((p) => p.grade.score === 7 && p.grade.failed.includes('code')));
  assert.equal(netSavings(full, { ...compressed, completed: false }), null);
  assert.ok(renderComparison(full, compressed, true).includes('СИМУЛЯЦИЯ'));
  const text = [];
  assert.equal(await main(['--offline'], (line) => text.push(line)), 0);
  assert.ok(text.join('\n').includes('списаний нет'));
  assert.ok(!evaluate('не JSON', { code: 'МАЯК-42' }).validJson);
  assert.equal(evaluate('{"code":"МАЯК-41"}', { code: 'МАЯК-42' }).score, 0);
});

test('summary and counters survive two separate processes and a later summary is scheduled correctly', (t) => {
  const directory = temporaryDirectory(t);
  const file = join(directory, 'context.json');
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  function run(script) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, file], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  const imports = `import { Agent } from './agent.mjs'; import { JsonContextStore } from './context-store.mjs'; import { createOfflineClient } from './scripts/offline-client.mjs'; const agent = new Agent({client:createOfflineClient(),store:new JsonContextStore(process.argv[1])});`;
  const first = run(`${imports} for(let i=0;i<6;i++) await agent.ask(i===0?'Код: МАЯК-42.':'Продолжаем.'); console.log(JSON.stringify(agent.getContext()));`);
  assert.equal(first.summarizedMessages, 4);
  assert.equal(first.messagesSinceSummary, 2);
  const second = run(`${imports} for(let i=0;i<5;i++) await agent.ask('Контрольная проверка. Верни условия.'); console.log(JSON.stringify({context:agent.getContext(),summaryCalls:agent.getTotals('summary').calls}));`);
  assert.equal(second.summaryCalls, 1);
  assert.equal(second.context.summarizedMessages, 14);
  assert.equal(second.context.messagesSinceSummary, 2);
  assert.equal(JSON.parse(second.context.recentMessages.at(-1).content).code, 'МАЯК-42');
  assert.deepEqual(new JsonContextStore(file).load(), second.context);
  assert.deepEqual(readdirSync(directory), ['context.json']);
});

test('corrupt or inconsistent memory is rejected without rewriting; full mode rejects already compressed memory', (t) => {
  const file = join(temporaryDirectory(t), 'context.json');
  writeFileSync(file, '{broken');
  assert.throws(() => new JsonContextStore(file).load());
  assert.equal(readFileSync(file, 'utf8'), '{broken');
  for (const patch of [{ version: 2 }, { summary: 'orphan' }, { summarizedMessages: 2 }, { messagesSinceSummary: 2 }, { unknown: true }]) {
    assert.throws(() => validateContext({ ...emptyContext(), ...patch }));
  }
  const state = { ...emptyContext(), summary: 'valid', summarizedMessages: 2 };
  new JsonContextStore(file).save(state);
  assert.throws(() => new Agent({ client: createOfflineClient(), compression: false, store: new JsonContextStore(file) }));
  assert.deepEqual(new JsonContextStore(file).load(), state);
});

test('CLI commands are local, restore memory and retain spending after reset', async (t) => {
  const file = join(temporaryDirectory(t), 'context.json');
  let requests = 0;
  const client = createOfflineClient();
  const create = client.responses.create;
  client.responses.create = (body) => { requests++; return create(body); };
  async function chat(lines) {
    let text = ''; let errors = '';
    const agent = await runChat({ client, file, input: Readable.from([lines]),
      output: new Writable({ write(chunk, encoding, next) { text += chunk; next(); } }),
      errorOutput: new Writable({ write(chunk, encoding, next) { errors += chunk; next(); } }),
    });
    assert.equal(errors, '');
    return { text, agent };
  }
  const first = await chat('Проект: Маяк.\n/summary\n/history\n/stats\n/exit\n');
  assert.equal(requests, 1);
  assert.ok(first.text.includes('Summary пока нет'));
  const second = await chat('Контрольная проверка.\n/reset\n/stats\n/exit\n');
  assert.equal(requests, 2);
  assert.ok(second.text.includes('Свежих сообщений: 2'));
  assert.ok(second.text.includes('Маяк'));
  assert.equal(second.agent.getTotals().calls, 1);
  assert.deepEqual(new JsonContextStore(file).load(), emptyContext());
  assert.ok(renderStats(second.agent).includes('Summary'));
  assert.throws(() => parseOptions(['--keep=3']));
  assert.throws(() => parseOptions(['--unknown']));
  assert.deepEqual(parseOptions(['--full', '--keep=8', '--every=12']), { compression: false, keepLatest: 8, compressEvery: 12 });
  assert.throws(() => contextPath({ CONTEXT_AGENT_HISTORY_FILE: 'relative.json' }));
  assert.notEqual(contextPath({}, true), contextPath({}, false));
});

test('unknown usage is visible and does not produce an apparent full-series saving', async () => {
  const client = createOfflineClient();
  const create = client.responses.create;
  client.responses.create = async (body) => ({ ...await create(body), usage: undefined });
  const result = await runScenario({ client, compression: false });
  assert.equal(result.completed, false);
  assert.equal(result.agent.getTotals().unknown, 1);
  assert.equal(netSavings(result, result), null);
  assert.ok(renderStats(result.agent).includes('неизвестно'));
});
