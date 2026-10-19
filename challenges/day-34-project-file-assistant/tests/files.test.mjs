import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize, verify, writeWorkspace, readWorkspace, snapshot, makeDiff } from '../server/workspace.mjs';
import { execFileSync } from 'node:child_process';
import { withMcp } from '../server/mcp-client.mjs';
import { functionTools } from '../server/feature.mjs';
test('MCP schemas are closed and all fields are required for strict function calling', () => {
  const tools = functionTools([{ name: 'read', description: 'read', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, $schema: 'draft-07' } }]);
  assert.equal(tools[0].parameters.additionalProperties, false); assert.deepEqual(tools[0].parameters.required, ['path']); assert(!('$schema' in tools[0].parameters));
});
test('workspace rejects escape/source writes; repeated document write is a no-op', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-tutors-files-'));
  try { await initialize(root); assert.equal((await verify(root)).ok, false); await assert.rejects(readWorkspace(root, '../.env')); await assert.rejects(writeWorkspace(root, 'src/client.mjs', 'bad'));
    const text = '# API v2\n\nGET /api/v2/users/{id}\nGET /api/v2/lessons\n'; assert.equal((await writeWorkspace(root, 'docs/api.md', text)).changed, true); assert.equal((await verify(root)).ok, true); assert.equal((await writeWorkspace(root, 'docs/api.md', text)).changed, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('MCP has no write tool in analysis mode and searches several files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-tutors-mcp-files-'));
  try { await initialize(root); await withMcp(async ({ call, tools }) => { assert(!tools.some(t => t.name === 'write_file')); const result = await call('search_text', { query: 'API' }); assert(new Set(result.matches.map(m => m.path)).size >= 2); await assert.rejects(call('write_file', { path: 'docs/api.md', content: 'bad' })); }, { env: { MCP_WORKSPACE: root, MCP_CAN_WRITE: '0' } }); } finally { await rm(root, { recursive: true, force: true }); }
});
test('exported diff is applicable to the initial files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-tutors-diff-'));
  try { await initialize(root); const before = await snapshot(root); const after = { ...before, 'docs/api.md': '# API v2\n\nGET /api/v2/users/{id}\nGET /api/v2/lessons\n' }; const diff = makeDiff(before, after); execFileSync('git', ['apply', '--check', '-'], { cwd: root, input: diff, windowsHide: true }); } finally { await rm(root, { recursive: true, force: true }); }
});
