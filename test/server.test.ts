import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import type { Server } from 'node:http'; import type { AddressInfo } from 'node:net';
import { makeApp } from '../src/server/app.js'; import { Store } from '../src/server/store.js'; import { make, sc } from './helpers.js';
let replies: string[] = [];
let dir: string, srv: Server, base: string, store: Store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-')); fs.mkdirSync(path.join(dir, 'runs')); fs.mkdirSync(path.join(dir, 'judge'));
  const t = { ...make(sc('sched-01'), ['C: move it', 'A: You are all set for Thursday!']), id: 'r1:sched-01-plain-move:1', runId: 'r1' };
  fs.writeFileSync(path.join(dir, 'runs', 'r1.json'), JSON.stringify({ meta: { id: 'r1', agentVersion: 'hand', agentPromptSha: 'x', model: 'm', repeats: 1, createdAt: '2026', note: '', scenarioSetSha: 'y' }, traces: [t] }));
  fs.writeFileSync(path.join(dir, 'judge', 'v1.json'), JSON.stringify({ version: 'v1', model: 'j', promptSha: 'p', outputs: { [t.id]: { belief: 'DONE', quote: 'You are all set for Thursday', reason: 'Says set.', raw: '{}' } } }));
  store = new Store(path.join(dir, 'x.db'), dir); srv = makeApp(store, { complete: async () => replies.shift() ?? '{"say":"Goodbye.","tool":null,"end":true}' }).listen(0); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`;
});
afterEach(() => { srv.close(); store.db.close(); });
const id = encodeURIComponent('r1:sched-01-plain-move:1'); const J = async (u: string) => (await fetch(base + u)).json(); const P = (u: string, b: unknown) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

describe('api', () => {
  it('joins truth and belief into a false reassurance', async () => { const c = await J(`/traces/${id}`); expect(c.metrics.find((m: { metric: string }) => m.metric === 'belief_gap')).toMatchObject({ verdict: 'fail', mechanism: 'false_reassurance', severity: 'P1' }); });
  it('an override changes the verdict, keeps the reason, and needs one', async () => {
    expect((await P('/reviews', { traceId: 'r1:sched-01-plain-move:1', metric: 'outcome', verdict: 'pass', reason: '', reviewer: 'A' })).status).toBe(400);
    expect((await P('/reviews', { traceId: 'r1:sched-01-plain-move:1', metric: 'outcome', verdict: 'pass', reason: 'planted for the test', reviewer: 'A' })).status).toBe(200);
    expect((await J(`/traces/${id}`)).metrics.find((m: { metric: string }) => m.metric === 'outcome')).toMatchObject({ verdict: 'pass', override: { reviewer: 'A' } });
  });
  it('the label queue is blind', async () => { const q = JSON.stringify(await J('/queue?rater=A')); expect(q).not.toMatch(/hand|NOT_DONE|"truth"|false_reassurance|v1/); });
  it('a label survives a lost database, because it is written to a file', async () => {
    await P('/labels', { traceId: 'r1:sched-01-plain-move:1', belief: 'DONE', note: '', rater: 'A', seconds: 5 });
    const s2 = new Store(path.join(dir, 'other.db'), dir); expect(s2.labels()).toHaveLength(1); s2.db.close();
  });
  it('a human label takes over from the judge, and the judge stays visible', async () => { await P('/labels', { traceId: 'r1:sched-01-plain-move:1', belief: 'UNSURE', note: 'vague', rater: 'A', seconds: 5 }); const c = await J(`/traces/${id}`); expect(c.metrics.at(-1)).toMatchObject({ mechanism: 'left_unsure', detail: { source: 'human' } }); expect(c.judge).toHaveLength(1); });
  it('refuses junk and unknown calls', async () => { expect((await P('/labels', { traceId: 'nope', belief: 'DONE', rater: 'A', seconds: 1 })).status).toBe(400); expect((await P('/labels', { traceId: 'r1:sched-01-plain-move:1', belief: 'MAYBE', rater: 'A', seconds: 1 })).status).toBe(400); expect((await fetch(`${base}/traces/nope`)).status).toBe(404); });
  it('calibration reports the lazy-judge baseline beside agreement', async () => { await P('/labels', { traceId: 'r1:sched-01-plain-move:1', belief: 'DONE', note: '', rater: 'A', seconds: 5 }); expect((await J('/calibration')).versions[0]).toMatchObject({ n: 1, agree: 1, majorityGuess: 1, caught: 1, dangerous: 1 }); });
});

describe('a person plays the caller', () => {
  const j = async (r: Response) => ({ status: r.status, ...(await r.json()) });
  it('scores the human call and keeps their note', async () => {
    replies = ['{"say":"You are moved to Thursday.","tool":null,"end":true}'];
    const c = await j(await P('/live', { scenarioId: 'sched-01-plain-move', version: 'verified' })); const s = await j(await P(`/live/${c.id}/say`, { text: 'move it to Thursday' })); expect(s.ended).toBe('agent'); expect(JSON.stringify(s)).not.toMatch(/P100|find_patient/);
    const h = await j(await P(`/live/${c.id}/hangup`, { tester: 'Andrew', note: 'too fast' })); const call = await J(`/traces/${encodeURIComponent(h.traceId)}`); expect(call.trace.human).toMatchObject({ tester: 'Andrew', note: 'too fast' }); expect(call.score).toMatchObject({ truth: 'NOT_DONE', simulatorValid: true });
  });
  it('refuses a dead call, an empty line and a made-up agent', async () => { expect((await P('/live/nope/say', { text: 'hi' })).status).toBe(404); expect((await P('/live', { scenarioId: 'sched-01-plain-move', version: '../secrets' })).status).toBe(400); const c = await j(await P('/live', { scenarioId: 'sched-01-plain-move', version: 'verified' })); expect((await P(`/live/${c.id}/say`, { text: '  ' })).status).toBe(400); });
});
