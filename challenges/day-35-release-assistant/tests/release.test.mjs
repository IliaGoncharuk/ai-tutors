import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectRepository, prepareRelease, validateConfig, initConfiguration, readiness, publicText, saveReport } from '../server/release.mjs';
import { Provider } from '../server/provider.mjs';
function git(root, args) { return execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim(); }
async function fixture(root) {
  git(root, ['init', '-q']); await writeFile(join(root, 'README.md'), '# Pet project\n'); await writeFile(join(root, 'app.js'), 'export const version = 1;\n');
  await writeFile(join(root, '.env'), 'TEST_ONLY_SECRET=do-not-send\n'); await writeFile(join(root, '.gitignore'), '.env\nrelease-drafts/\n');
  git(root, ['add', 'README.md', 'app.js', '.gitignore']); git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Initial version']);
  const base = git(root, ['rev-parse', 'HEAD']); await writeFile(join(root, 'app.js'), 'export const version = 2;\n'); git(root, ['add', 'app.js']); git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Support version two']); return base;
}
test('portable Git inspection compares real commits and excludes secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-release-inspect-'));
  try { const base = await fixture(root); const evidence = await inspectRepository({ repo: root, base }); assert.deepEqual(evidence.changedFiles, ['app.js']); assert.equal(evidence.repository.dirty, false); assert(!JSON.stringify(evidence.files).includes('do-not-send')); assert(evidence.diff.includes('version = 2')); await initConfiguration(root); await assert.rejects(initConfiguration(root), /EEXIST/); } finally { await rm(root, { recursive: true, force: true }); }
});
test('failed check blocks readiness even if model writes positive notes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-release-check-'));
  try { const base = await fixture(root); const config = { name: 'Fixture', contextPaths: ['README.md'], requiredFiles: ['README.md'], checks: [{ name: 'intentional failure', command: ['node', '-e', 'process.exit(3)'], cwd: '.', timeoutMs: 1000 }] }; await writeFile(join(root, 'ai-release.config.json'), JSON.stringify(config));
    const provider = { generate: async () => ({ value: { title: 'Draft', overview: 'Looks good', changes: [{ text: 'Version two', files: ['app.js'] }], risks: [] }, model: 'test-double', usage: {} }) };
    const report = await prepareRelease(provider, { repo: root, base, runChecks: true }); assert.equal(report.readiness, 'blocked'); assert.equal(report.checks[0].exitCode, 3); assert(report.releaseNotes.includes('failed')); const output = await saveReport(report, join(root, 'release-drafts')); assert((await readFile(join(output, 'report.json'), 'utf8')).includes('blocked'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('no-AI and skipped checks remain explicit; invalid config paths are rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-release-offline-'));
  try { const base = await fixture(root); const report = await prepareRelease(null, { repo: root, base, noAi: true }); assert.equal(report.model, null); assert.equal(report.readiness, 'needs-review'); assert(report.releaseNotes.includes('без AI')); assert.equal(publicText('.env'), false); assert.equal(publicText('src/credentials.json'), false); assert.throws(() => validateConfig({ name: 'x', contextPaths: ['../outside'], requiredFiles: [], checks: [] })); } finally { await rm(root, { recursive: true, force: true }); }
});
test('budget cannot exceed shared dollar limit across providers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-release-budget-'));
  try { const a = new Provider({ directory: root }), b = new Provider({ directory: root }); try { a.reserve('test', .7); assert.throws(() => b.reserve('test', .4)); assert.equal(b.budget().reserved, .7); } finally { a.close(); b.close(); } } finally { await rm(root, { recursive: true, force: true }); }
});
test('readiness is computed from evidence, not a model claim', () => {
  assert.equal(readiness({ required: [{ exists: true }], repository: { dirty: false }, warnings: [] }, [{ status: 'passed' }]), 'ready-for-human-review');
  assert.equal(readiness({ required: [{ exists: false }], repository: { dirty: false }, warnings: [] }, [{ status: 'passed' }]), 'blocked');
});
