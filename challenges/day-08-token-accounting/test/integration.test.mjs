import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import OpenAI from 'openai';
import { Agent } from '../agent.mjs';
import { historyPath } from '../history.mjs';
import { runChat } from '../cli.mjs';
import { createOfflineClient } from '../scripts/offline-client.mjs';
import { runDialogue, runOverflow, syntheticHistory, prepareLiveOverflow, main } from '../experiment.mjs';
import { renderReport } from '../report.mjs';

test('installed SDK sends the correct token-count and generation HTTP payloads and classifies a 400 response', async () => {
  const requests = [];
  const client = new OpenAI({ apiKey: 'offline-test', maxRetries: 0, fetch: async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    requests.push({ path, body });
    if (path === '/v1/responses/input_tokens') {
      return Response.json({ object: 'response.input_tokens', input_tokens: body.instructions ? 100 : 11 });
    }
    assert.equal(path, '/v1/responses');
    return Response.json({ error: { type: 'invalid_request_error', code: 'context_length_exceeded',
      param: 'input', message: 'private text echoed by provider' } }, { status: 400 });
  } });
  const agent = new Agent({ client, contextLimit: 132, maxOutputTokens: 32 });
  await assert.rejects(agent.ask('Привет'), { code: 'context_length_exceeded' });
  assert.deepEqual(requests.map((request) => request.path), [
    '/v1/responses/input_tokens', '/v1/responses/input_tokens', '/v1/responses',
  ]);
  assert.deepEqual(requests[1].body.input, requests[2].body.input);
  assert.equal(requests[1].body.instructions, requests[2].body.instructions);
  assert.equal(requests[2].body.truncation, 'disabled');
  assert.equal(requests[2].body.max_output_tokens, 32);
  assert.ok(!renderReport(agent.getRecords(), 'Test').includes('private text'));
  assert.deepEqual(agent.getHistory(), []);
});

test('three offline scenarios demonstrate growing input, repeated-history spending and preserved overflow history', async () => {
  const client = createOfflineClient();
  const short = await runDialogue({ client, turns: 3, contextLimit: 8192 });
  const long = await runDialogue({ client, turns: 20, contextLimit: 8192 });
  assert.equal(short.getHistory().at(-1).content, 'Кедр');
  assert.equal(long.getHistory().at(-1).content, 'Кедр');
  assert.equal(short.getTotals().apiCalls, 3);
  assert.equal(long.getTotals().apiCalls, 20);
  assert.ok(long.getTotals().knownCostUsd > short.getTotals().knownCostUsd);
  const records = long.getRecords();
  assert.ok(records.every((record, index) => index === 0 || record.counts.full > records[index - 1].counts.full));
  assert.ok(long.getTotals().input > records.at(-1).counts.full * 10);
  const { agent, preserved } = await runOverflow({ client, history: syntheticHistory(20), contextLimit: 8192 });
  assert.deepEqual(agent.getRecords().map((record) => record.status), ['local_context_limit', 'context_length_exceeded']);
  assert.ok(preserved);
  assert.equal(agent.getTotals().apiCalls, 1);
  assert.equal(agent.getRecords()[1].stage, 'генерация');
  const output = [];
  assert.equal(await main(['--offline'], (line) => output.push(line)), 0);
  assert.ok(output.join('\n').includes('СИМУЛЯЦИЯ'));
  assert.ok(output.join('\n').includes('списаний нет'));
  assert.ok(output.join('\n').includes('Длинный диалог'));
});

test('real-overflow preparation measures the entire payload and reports count rejection separately from generation', async () => {
  let counts = 0;
  const prepared = await prepareLiveOverflow({ responses: { inputTokens: { count: async (body) => {
    assert.equal(body.model, 'gpt-5.6-luna');
    assert.equal(body.input.at(-1).role, 'user');
    assert.ok(body.instructions);
    return { input_tokens: ++counts === 1 ? 900000 : 1070000 };
  } } } });
  assert.equal(counts, 2);
  assert.ok(prepared.length > 1602);
  await assert.rejects(prepareLiveOverflow({ responses: { inputTokens: { count: async () => {
    throw Object.assign(new Error('private'), { code: 'context_length_exceeded' });
  } } } }), { code: 'count_context_limit' });
});

test('CLI persists and restores UTF-8 history; stats are local and a reset does not erase spending', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-tutors-day08-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('ai-tutors-day08-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const file = join(directory, 'messages.json');
  let countCalls = 0;
  const client = createOfflineClient();
  const count = client.responses.inputTokens.count;
  client.responses.inputTokens.count = (body) => { countCalls++; return count(body); };
  async function chat(lines) {
    let text = '';
    let errors = '';
    await runChat({ client, file, input: Readable.from([lines]),
      output: new Writable({ write(chunk, encoding, next) { text += chunk; next(); } }),
      errorOutput: new Writable({ write(chunk, encoding, next) { errors += chunk; next(); } }),
    });
    assert.equal(errors, '');
    return text;
  }
  const first = await chat('Контрольное слово: Кедр\n/stats\n/exit\n');
  assert.ok(first.includes('полный вход'));
  assert.ok(first.includes('Usage: вход'));
  assert.equal(countCalls, 2); // /stats does not call the API.
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).messages.length, 2);
  const second = await chat('Какое контрольное слово было в начале?\n/reset\n/stats\n/exit\n');
  assert.ok(second.includes('Восстановлено сообщений: 2'));
  assert.ok(second.includes('Агент: Кедр'));
  assert.ok(second.includes('генераций 1'));
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).messages, []);
  assert.equal(countCalls, 5);
  assert.ok(historyPath({}).endsWith(join('day-08', 'messages.json')));
  assert.throws(() => historyPath({ TOKEN_AGENT_HISTORY_FILE: 'relative.json' }));
});
