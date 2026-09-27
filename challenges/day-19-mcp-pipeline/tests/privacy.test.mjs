import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DAY } from '../server/config.mjs';
import { analyze, anonymizeResult, demoIssues } from '../server/domain.mjs';
import { createApp } from '../server/index.mjs';

const date = '2026-09-28';
const original = demoIssues(date);

test('legacy snapshots and reports are anonymized through MCP and HTTP without rewriting old files', async t => {
  const dir = directory(t);
  const { Store } = await import('../server/store.mjs');
  const store = new Store(dir);
  const snapshotId = '00000000-0000-4000-8000-000000000001';
  const summaryId = '00000000-0000-4000-8000-000000000002';
  const reportId = '00000000-0000-4000-8000-000000000003';
  const raw = { source: 'demo', snapshotId, summaryId, collectedAt: '2026-09-28T04:00:00Z', ...analyze(original, date) };
  store.write('snapshot-' + snapshotId + '.json', raw);
  store.write('summary-' + summaryId + '.json', raw);
  store.write('report-' + reportId + '.json', raw);
  store.text('report-' + reportId + '.md', original[0].key + ' ' + original[0].summary);
  store.write('latest-report-demo.json', { reportId, source: 'demo', date, metrics: raw.metrics, markdownFile: 'report-' + reportId + '.md', jsonFile: 'report-' + reportId + '.json' });
  const before = readFileSync(store.file('report-' + reportId + '.json'), 'utf8');
  const beforeMarkdown = readFileSync(store.file('report-' + reportId + '.md'), 'utf8');
  const app = await createApp({ port: 0, production: true, directory: dir });
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const response = await fetch(base + '/api/report/' + reportId);
    assert.equal(response.status, 200);
    const viewed = await response.json();
    assertAnonymous(viewed);
    assert.match(viewed.markdown, /Задача 1/);
    assert.deepEqual(viewed.report.metrics, raw.metrics);
    if (DAY === 20) {
      const response = await fetch(base + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: 'last', mode: 'demo' }) });
      const state = await response.json();
      assert.equal(state.last.status, 'completed');
      assertAnonymous(state);
      assert.deepEqual(state.last.result.metrics, raw.metrics);
    }
  } finally { await app.close(); }

  let connection;
  if (DAY === 20) {
    const { Connections } = await import('../server/connections.mjs');
    const connections = new Connections('demo', dir);
    connection = { connect: () => connections.connect(), close: () => connections.close(), call: (name, args) => connections.analytics.call(name, args) };
  } else {
    const { McpConnection } = await import('../server/mcp-client.mjs');
    connection = new McpConnection({ env: { TRACKER_SOURCE: 'demo', TRACKER_LAB_DATA_DIR: dir } });
  }
  try {
    await connection.connect();
    const summary = await connection.call('summarize_issues', { snapshotId });
    assertAnonymous(summary);
    assert.deepEqual(summary.metrics, raw.metrics);
    const saved = await connection.call('save_report', { summaryId });
    assertAnonymous(readFileSync(store.file(saved.jsonFile), 'utf8'));
    assertAnonymous(readFileSync(store.file(saved.markdownFile), 'utf8'));
  } finally { await connection.close(); }
  assert.equal(readFileSync(store.file('report-' + reportId + '.json'), 'utf8'), before);
  assert.equal(readFileSync(store.file('report-' + reportId + '.md'), 'utf8'), beforeMarkdown);
});
function assertAnonymous(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const issue of original) {
    assert.equal(text.includes(issue.key), false);
    assert.equal(text.includes(issue.summary), false);
  }
  assert.equal(text.includes('tracker.yandex.ru/'), false);
}
function directory(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-privacy-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('task projection removes identifying and unknown fields, preserves dates and metrics', () => {
  const raw = analyze(original.map(issue => ({ ...issue, url: 'https://tracker.yandex.ru/' + issue.key, description: 'PRIVATE_DESCRIPTION', extra: { secret: 'PRIVATE_EXTRA' } })), date);
  const safe = anonymizeResult(raw);
  assertAnonymous(safe);
  assert.deepEqual(safe.metrics, raw.metrics);
  assert.deepEqual(safe.issues.map(issue => issue.dueDate), raw.issues.map(issue => issue.dueDate));
  assert.deepEqual(safe.issues.map(issue => issue.status), raw.issues.map(issue => issue.status));
  assert.deepEqual(safe.issues.map(issue => issue.label), raw.issues.map((_, i) => `Задача ${i + 1}`));
  for (const issue of safe.issues) for (const key of ['key', 'summary', 'url', 'description', 'extra']) assert.equal(Object.hasOwn(issue, key), false);
  assert.deepEqual(anonymizeResult(safe), safe);
  assert.deepEqual(analyze(safe.issues, date).metrics, raw.metrics);
  assert.ok(raw.issues[0].key); // No mutation of legacy data.
});

test('HTTP and actual MCP flow, expanded step data and new report files are anonymous', async t => {
  const dir = directory(t);
  const app = await createApp({ port: 0, production: true, directory: dir });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const body = DAY === 17 ? { request: 'all', mode: 'demo' } : DAY === 20 ? { request: 'report', mode: 'demo' } : {};
    const response = await fetch(base + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    const state = await response.json();
    assertAnonymous(state);
    assert.ok(JSON.stringify(state).includes('Задача 1'));
    const rows = DAY === 18 ? state.digest.latest.issues : state.last.result.issues;
    assert.equal(rows.length, 6);
    for (const row of rows) for (const field of ['key', 'summary', 'url']) assert.equal(Object.hasOwn(row, field), false);
    assertAnonymous(await (await fetch(base + '/api/state')).json());
    if (state.last?.report) {
      const report = await (await fetch(base + '/api/report/' + state.last.report.reportId)).json();
      assertAnonymous(report);
      assert.match(report.markdown, /Задача 1/);
    }
    for (const name of readdirSync(dir).filter(name => /\.(json|md)$/.test(name))) assertAnonymous(readFileSync(join(dir, name), 'utf8'));
  } finally { await app.close(); }
});
