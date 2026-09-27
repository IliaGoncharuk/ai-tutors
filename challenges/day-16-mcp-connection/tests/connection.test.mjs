import test from 'node:test';
import assert from 'node:assert/strict';
import { McpConnection } from '../server/mcp-client.mjs';
import { createApp } from '../server/index.mjs';

test('real stdio: initialize, tools/list, schema, tool call, reconnect, child shutdown', async () => {
  const c = new McpConnection();
  try {
    const state = await c.connect();
    assert.equal(state.connected, true); assert.equal(state.info.name, 'tracker-connection');
    assert.deepEqual(state.tools.map(t => t.name), ['connection_info']);
    assert.deepEqual(state.tools[0].inputSchema.properties.detail.enum, ['short', 'full']);
    assert.equal((await c.call('connection_info', { detail: 'full' })).transport, 'stdio');
    await assert.rejects(c.call('connection_info', { detail: 'invalid' }));
    const pid = c.transport.pid;
    await c.close(); assert.equal(c.view().connected, false);
    assert.throws(() => process.kill(pid, 0));
    assert.equal((await c.connect()).tools.length, 1);
  } finally { await c.close(); }
});
test('unavailable server fails without pretending to connect', async () => {
  const c = new McpConnection({ serverFile: 'non-existent-test-server.mjs' });
  await assert.rejects(c.connect(), /Не удалось/); assert.equal(c.view().connected, false);
});
test('unexpected child exit updates connection state and allows reconnect', async () => {
  const c = new McpConnection();
  try {
    await c.connect();
    const closed = new Promise(resolve => { const previous = c.client.onclose; c.client.onclose = () => { previous(); resolve(); }; });
    process.kill(c.transport.pid);
    await closed;
    assert.equal(c.view().connected, false);
    await assert.rejects(c.call('connection_info', { detail: 'short' }), /Сначала/);
    assert.equal((await c.connect()).connected, true);
  } finally { await c.close(); }
});
test('HTTP discovery and local origin restriction', async () => {
  const app = await createApp({ port: 0, production: true });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    assert.equal((await fetch(base + '/api/state')).status, 200);
    const call = (path, origin) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: '{}' });
    assert.equal((await call('/api/connect', 'https://example.com')).status, 403);
    assert.equal((await (await call('/api/connect')).json()).connected, true);
    assert.equal((await (await call('/api/tools')).json()).tools.length, 1);
    assert.equal((await (await call('/api/disconnect')).json()).connected, false);
  } finally { await app.close(); }
});
