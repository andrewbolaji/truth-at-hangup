import express from 'express'; import { z } from 'zod'; import { createHash } from 'node:crypto';
import { Belief } from '../core/types.js'; import { gap } from '../eval/belief.js'; import { render } from '../harness/conversation.js'; import type { Store } from './store.js';

const LabelIn = z.object({ traceId: z.string(), belief: Belief, note: z.string().max(400).default(''), rater: z.string().min(1).max(40), seconds: z.number().min(0).max(3600) });
const ReviewIn = z.object({ traceId: z.string(), metric: z.string(), verdict: z.enum(['pass', 'fail', 'na']), reason: z.string().trim().min(5, 'Say why in a few words.').max(400), reviewer: z.string().trim().min(1).max(40) });
export const LABEL_TARGET = 20;

export function summarize(store: Store, runId: string) {
  const ts = [...store.traces.values()].filter((t) => t.runId === runId); const by: Record<string, { pass: number; fail: number; na: number }> = {}; let clean = 0, valid = 0, p0 = 0, p1 = 0, turns = 0, staff = 0;
  for (const t of ts) {
    const f = store.full(t.id)!; if (!f.score.simulatorValid) continue; valid++;
    const fails = f.metrics.filter((m) => m.verdict === 'fail'); if (!fails.length) clean++; if (fails.some((m) => m.severity === 'P0')) p0++; if (fails.some((m) => m.severity === 'P1')) p1++;
    for (const m of f.metrics) { const x = (by[m.metric] ??= { pass: 0, fail: 0, na: 0 }); x[m.verdict]++; }
    turns += t.events.filter((e) => e.kind === 'caller').length; staff += t.final.staffTasks.length;
  }
  return { total: ts.length, valid, clean, p0, p1, by, turns: valid ? turns / valid : 0, staff };
}
/** Fixed, blind queue: every scenario once, alternating versions by hash, then filled up. The rater sees no version, tool or score. */
export function labelQueue(store: Store) {
  const h = (s: string) => createHash('sha256').update(`queue:${s}`).digest('hex'); const all = [...store.traces.values()].filter((t) => store.scores.get(t.id)!.simulatorValid).sort((a, b) => h(a.id).localeCompare(h(b.id)));
  const seen = new Set<string>(); const first = all.filter((t) => !seen.has(t.scenarioId) && seen.add(t.scenarioId)); const rest = all.filter((t) => !first.includes(t));
  return [...first, ...rest].slice(0, LABEL_TARGET).sort((a, b) => h(a.id).localeCompare(h(b.id)));
}
export function calibration(store: Store) {
  const labels = store.labels(); const sc = (id: string) => store.scenarios.find((s) => s.id === id)!;
  return { labels: labels.length, target: LABEL_TARGET, versions: store.judges.map((j) => {
    const rows = labels.flatMap((l) => { const o = j.outputs[l.traceId]; const t = store.traces.get(l.traceId); if (!o || !t) return []; const truth = store.scores.get(l.traceId)!.truth; return [{ traceId: l.traceId, title: sc(t.scenarioId).title, human: l.belief, note: l.note, judge: o.belief, quote: o.quote, reason: o.reason, truth, humanGap: gap(l.belief, truth), judgeGap: gap(o.belief, truth) }]; });
    const agree = rows.filter((r) => r.human === r.judge).length; const counts: Record<string, number> = {}; for (const r of rows) counts[r.human] = (counts[r.human] ?? 0) + 1;
    const top = Math.max(0, ...Object.values(counts)); const bad = (g: string) => g === 'false_reassurance' || g === 'overpromise';
    const hb = rows.filter((r) => bad(r.humanGap)); return { version: j.version, model: j.model, n: rows.length, agree, majorityGuess: top, caught: hb.filter((r) => bad(r.judgeGap)).length, dangerous: hb.length, falseAlarms: rows.filter((r) => !bad(r.humanGap) && bad(r.judgeGap)).length, rows };
  }) };
}
export function makeApp(store: Store) {
  const app = express(); app.use(express.json({ limit: '50kb' }));
  const pub = (id: string) => { const t = store.traces.get(id)!; const f = store.full(id)!; const s = store.scenarios.find((x) => x.id === t.scenarioId)!; return { id, scenarioId: t.scenarioId, title: s.title, kind: s.kind, workflow: s.workflow, repeat: t.repeat, runId: t.runId, agentVersion: t.agentVersion, truth: f.score.truth, valid: f.score.simulatorValid, notes: f.score.simulatorNotes, ended: t.ended, metrics: f.metrics }; };
  app.get('/api/runs', (_q, r) => r.json(store.runs.map((m) => ({ ...m, summary: summarize(store, m.id) }))));
  app.get('/api/scenarios', (_q, r) => r.json(store.scenarios));
  app.get('/api/runs/:id', (q, r) => { const m = store.runs.find((x) => x.id === q.params.id); if (!m) return void r.status(404).json({ error: 'No such run.' }); r.json({ meta: m, summary: summarize(store, m.id), traces: [...store.traces.values()].filter((t) => t.runId === m.id).map((t) => pub(t.id)) }); });
  app.get('/api/traces/:id', (q, r) => { const t = store.traces.get(q.params.id); if (!t) return void r.status(404).json({ error: 'No such call.' }); const f = store.full(t.id)!; r.json({ trace: t, scenario: store.scenarios.find((s) => s.id === t.scenarioId), ...f, reviews: store.reviews(t.id) }); });
  app.get('/api/queue', (q, r) => { const rater = String(q.query.rater ?? ''); const done = new Set(store.labels().filter((l) => l.rater === rater).map((l) => l.traceId)); const all = labelQueue(store); const next = all.find((t) => !done.has(t.id)); r.json({ done: all.filter((t) => done.has(t.id)).length, total: all.length, next: next ? { traceId: next.id, goal: store.scenarios.find((s) => s.id === next.scenarioId)!.ask, heard: render(next.events, 'heard').split('\n') } : null }); });
  app.post('/api/labels', (q, r) => { const b = LabelIn.safeParse(q.body); if (!b.success || !store.traces.has(b.data.traceId)) return void r.status(400).json({ error: 'That label could not be saved.' }); store.addLabel({ ...b.data, at: new Date().toISOString() }); r.json({ ok: true }); });
  app.post('/api/reviews', (q, r) => { const b = ReviewIn.safeParse(q.body); if (!b.success) return void r.status(400).json({ error: b.error.issues[0]?.message ?? 'Check the form.' }); if (!store.full(b.data.traceId)?.metrics.some((m) => m.metric === b.data.metric)) return void r.status(404).json({ error: 'No such result to review.' }); store.addReview({ ...b.data, at: new Date().toISOString() }); r.json({ ok: true }); });
  app.get('/api/calibration', (_q, r) => r.json(calibration(store)));
  app.use('/api', (_q, r) => void r.status(404).json({ error: 'Not found.' }));
  return app;
}
