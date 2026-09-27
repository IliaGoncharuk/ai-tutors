import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, demoIssues, localDate } from '../server/domain.mjs';
import { searchIssues } from '../server/tracker.mjs';

test('deadline boundaries, closed issues and date-only timezone', () => {
  assert.equal(localDate(new Date('2026-09-27T20:01:00Z')), '2026-09-28');
  assert.deepEqual(analyze(demoIssues('2026-09-28'), '2026-09-28').metrics, { total:6, overdue:2, today:2, upcoming:1, noDeadline:1, invalidDeadline:0, maxOverdueDays:3 });
  assert.equal(analyze([{key:'X',dueDate:'2026-02-30'}], '2026-09-28').metrics.invalidDeadline, 1);
});
test('Tracker uses me(), follows every page, discards unneeded private fields', async () => {
  const calls = [];
  const result = await searchIssues({ source:'live', date:'2026-09-28', config:{token:'test-token',org:'test-org'}, fetcher:async (url, init) => {
    calls.push({url,init}); const index = calls.length;
    return new Response(JSON.stringify([{key:`DEMO-${index}`,summary:'Synthetic task',dueDate:'2026-09-28',description:'PRIVATE_DESCRIPTION'}]), {headers:{'X-Total-Pages':'2','X-Total-Count':'2'}});
  }});
  assert.equal(calls.length,2); assert.equal(result.metrics.today,2);
  assert.match(calls[0].init.body,/Assignee: me\(\)/); assert.equal(calls[0].init.redirect,'error');
  assert.equal(JSON.stringify(result).includes('PRIVATE_DESCRIPTION'),false);
});
test('incomplete pages, authorization and rate limit are explicit failures', async () => {
  const base = {source:'live',config:{token:'x',org:'x'}};
  for (const status of [401,403,429]) await assert.rejects(searchIssues({...base,fetcher:async()=>new Response('',{status})}), new RegExp(String(status)));
  await assert.rejects(searchIssues({...base,fetcher:async()=>new Response('[]',{headers:{'X-Total-Count':'5','X-Total-Pages':'1'}})}), /не полностью/);
  await assert.rejects(searchIssues({...base,fetcher:async()=>new Response('not json')}), /JSON/);
});
