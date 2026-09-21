import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialState, applyAction } from '../server/core.mjs';
import { Repository } from '../server/store.mjs';
import { advance } from './helpers.mjs';

test('загрузчик отвергает повреждённые версии и не перезаписывает данные', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'day15-versions-'));
  try {
    const repo = new Repository(directory);
    const valid = await advance(createInitialState(), 'done');
    repo.write(valid);
    assert.deepEqual(repo.read(), valid);
    for (const field of ['requirementsVersion', 'planVersion', 'artifactVersion', 'planRequirementsVersion', 'approvedPlanVersion', 'approvedRequirementsVersion', 'artifactPlanVersion', 'artifactRequirementsVersion', 'artifactInvariantVersion']) {
      for (const value of [-2, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
        const damaged = structuredClone(valid);
        damaged.workflows[damaged.activeTask][field] = value;
        repo.write(damaged);
        const pointer = readFileSync(join(directory, 'CURRENT.json'), 'utf8');
        assert.throws(() => repo.read(), /версии задачи/, `${field}: ${value}`);
        assert.equal(readFileSync(join(directory, 'CURRENT.json'), 'utf8'), pointer);
      }
    }
    for (const field of ['requirementsVersion', 'planVersion', 'artifactVersion', 'invariantVersion']) {
      const damaged = structuredClone(valid);
      damaged.workflows[damaged.activeTask].validation[field] = -1;
      repo.write(damaged);
      assert.throws(() => repo.read(), /версии задачи/);
    }
    const inactive = applyAction(valid, { type: 'new-task', title: 'Другая задача' });
    inactive.workflows[valid.activeTask].planVersion = -2;
    repo.write(inactive);
    assert.throws(() => repo.read(), /версии задачи/, 'проверяются и неактивные задачи');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
