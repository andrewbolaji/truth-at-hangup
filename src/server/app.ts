import express from 'express'; import { z } from 'zod'; import { createHash } from 'node:crypto';
import { Belief, type Trace } from '../core/types.js'; import { gap, quoteIsReal } from '../eval/belief.js'; import { render } from '../harness/conversation.js'; import type { Store } from './store.js'; import type { Llm } from '../harness/llm.js'; import { liveRouter } from './live.js'; import { readText, sha } from '../core/load.js';

const LabelIn = z.object({ key: z.string(), belief: Belief, note: z.string().max(400).default(''), rater: z.string().min(1).max(40), seconds: z.number().min(0).max(3600) });
const ReviewIn = z.object({ traceId: z.string(), metric: z.string(), verdict: z.enum(['pass', 'fail', 'na']), reason: z.string().trim().min(5, 'Say why in a few words.').max(400), reviewer: z.string().trim().min(1).max(40) });
/** The rater gets a meaningless key, so the run name (and the agent version in it) stays hidden. */
export const blindKey = (id: string) => createHash('sha256').update(`blind:${id}`).digest('hex').slice(0, 16);
export function summarize(store: Store, runId: string) {
  const ts = [...store.traces.values()].filter((t) => t.runId === runId); const by: Record<string, { pass: number; fail: number; na: number }> = {}; let clean = 0, valid = 0, p0 = 0, p1 = 0, turns = 0, staff = 0; const words: number[] = [];
  for (const t of ts) {
    const f = store.full(t.id)!; if (!f.score.simulatorValid) continue; valid++;
    const fails = f.metrics.filter((m) => m.verdict === 'fail' && m.metric !== 'belief_gap'); if (!fails.length) clean++; if (fails.some((m) => m.severity === 'P0')) p0++; if (fails.some((m) => m.severity === 'P1')) p1++;
    for (const m of f.metrics) { const x = (by[m.metric] ??= { pass: 0, fail: 0, na: 0 }); x[m.verdict]++; }
    let w = 0; for (const e of t.events) { if (e.kind === 'agent') w += e.text.split(/\s+/).length; else if (e.kind === 'caller') { if (w) words.push(w); w = 0; } } if (w) words.push(w);
    turns += t.events.filter((e) => e.kind === 'caller').length; staff += t.final.staffTasks.length;
  }
  return { total: ts.length, valid, clean, p0, p1, by, turns: valid ? turns / valid : 0, staff, wordsP95: words.sort((a, b) => a - b)[Math.floor(words.length * 0.95)] ?? 0 };
}
/** The sample is frozen in a file before anyone labels, so a later run can't change it. 18 calls, one per scenario, plus 6 mutants so dangerous cases exist. */
export function labelQueue(store: Store): Trace[] { return store.queueIds.flatMap((id) => store.traces.get(id) ?? []); }
/** How the frozen sample was drawn: hash order, one call per scenario from the two candidate agents, plus every mutant. */
export function drawQueue(store: Store): string[] {
  const h = (s: string) => createHash('sha256').update(`queue:${s}`).digest('hex'); const seen = new Set<string>();
  const first = [...store.traces.values()].filter((t) => ['baseline', 'verified'].includes(t.runId) && store.scores.get(t.id)!.simulatorValid).sort((x, y) => h(x.id).localeCompare(h(y.id))).filter((t) => !seen.has(t.scenarioId) && seen.add(t.scenarioId));
  return [...first, ...[...store.traces.values()].filter((t) => t.runId === 'mutants')].map((t) => t.id).sort((x, y) => h(x).localeCompare(h(y)));
}
/** Half the sample is for fixing the judge, half is held out to check it. Mutants and real calls alternate, so each half has both. */
export function holdout(store: Store): Set<string> {
  const h = (s: string) => createHash('sha256').update(`split:${s}`).digest('hex'); const out = new Set<string>();
  for (const grp of [store.queueIds.filter((i) => i.startsWith('mutants')), store.queueIds.filter((i) => !i.startsWith('mutants'))]) grp.sort((x, y) => h(x).localeCompare(h(y))).forEach((id, k) => { if (k % 2) out.add(id); });
  return out;
}
export function calibration(store: Store) {
  const labels = store.labels(); const held = holdout(store); const sc = (id: string) => store.scenarios.find((s) => s.id === id)!; const danger = (g: string) => g === 'false_reassurance' || g === 'overpromise' || g === 'false_alarm';
  return { labels: labels.length, target: store.queueIds.length, versions: store.judges.map((j) => {
    const rows = labels.flatMap((l) => { const o = j.outputs[l.traceId]; const t = store.traces.get(l.traceId); if (!o || !t) return []; const truth = store.scores.get(l.traceId)!.truth; return [{ traceId: l.traceId, title: sc(t.scenarioId).title, held: held.has(l.traceId), grounded: !o.error && quoteIsReal(o.quote, t), human: l.belief, note: l.note, judge: o.belief, quote: o.quote, reason: o.reason, truth, humanGap: gap(l.belief, truth), judgeGap: gap(o.belief, truth) }]; });
    const part = (rs: typeof rows) => { const c: Record<string, number> = {}; for (const r of rs) c[r.human] = (c[r.human] ?? 0) + 1; const hb = rs.filter((r) => danger(r.humanGap)); return { n: rs.length, agree: rs.filter((r) => r.human === r.judge).length, majorityGuess: Math.max(0, ...Object.values(c)), dangerous: hb.length, caught: hb.filter((r) => danger(r.judgeGap)).length, falseAlarms: rs.filter((r) => !danger(r.humanGap) && danger(r.judgeGap)).length, ungrounded: rs.filter((r) => !r.grounded).length }; };
    return { version: j.version, model: j.model, dev: part(rows.filter((r) => !r.held)), test: part(rows.filter((r) => r.held)), rows };
  }) };
}
/** On Porter, recordings from an old prompt kept passing after the prompt changed. A run says so when its prompt is no longer the current one. */
export const isStale = (v: string, promptSha: string) => { try { return sha(readText('agents', `${v}.md`) + readText('agents', 'protocol.md')) !== promptSha; } catch { return true; } };
/** The agent versions being compared, in the order they were made. */
export const CANDIDATES = ['baseline', 'verified', 'verified-2', 'guarded'];
export function makeApp(store: Store, llm?: Llm) {
  const app = express(); app.disable('x-powered-by');
  // Local tool: only answer to this machine's own name, so a web page can't reach it by pointing its own domain here.
  app.use((q, r, n) => (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(q.headers.host ?? '') ? n() : void r.status(403).json({ error: 'Open this on localhost.' })));
  app.use(express.json({ limit: '50kb' }));
  const pub = (id: string) => { const t = store.traces.get(id)!; const f = store.full(id)!; const s = store.scenarios.find((x) => x.id === t.scenarioId)!; return { id, scenarioId: t.scenarioId, title: s.title, kind: s.kind, workflow: s.workflow, repeat: t.repeat, runId: t.runId, agentVersion: t.agentVersion, truth: f.score.truth, valid: f.score.simulatorValid, notes: f.score.simulatorNotes, ended: t.ended, metrics: f.metrics }; };
  app.get('/api/runs', (_q, r) => r.json(store.runs.map((m) => ({ ...m, stale: !['human', 'mutant'].includes(m.callerVersion) && isStale(m.agentVersion, m.agentPromptSha), summary: summarize(store, m.id) }))));
  app.get('/api/scenarios', (_q, r) => r.json(store.scenarios));
  app.get('/api/runs/:id', (q, r) => { const m = store.runs.find((x) => x.id === q.params.id); if (!m) return void r.status(404).json({ error: 'No such run.' }); const stale = isStale(m.agentVersion, m.agentPromptSha); let prompt: string[] | null = null; if (!stale) prompt = readText('agents', `${m.agentVersion}.md`).split('\n').filter((l) => l.trim());
    r.json({ meta: m, prompt, summary: summarize(store, m.id), traces: [...store.traces.values()].filter((t) => t.runId === m.id).map((t) => pub(t.id)) }); });
  app.get('/api/traces/:id', (q, r) => { const t = store.traces.get(q.params.id); if (!t) return void r.status(404).json({ error: 'No such call.' }); const f = store.full(t.id)!; r.json({ trace: t, scenario: store.scenarios.find((s) => s.id === t.scenarioId), ...f, reviews: store.reviews(t.id) }); });
  app.get('/api/queue', (q, r) => { const rater = String(q.query.rater ?? ''); const done = new Set(store.labels().filter((l) => l.rater === rater).map((l) => l.traceId)); const all = labelQueue(store); const next = all.find((t) => !done.has(t.id)); r.json({ done: all.filter((t) => done.has(t.id)).length, total: all.length, next: next ? { key: blindKey(next.id), goal: store.scenarios.find((s) => s.id === next.scenarioId)!.ask, heard: render(next.events, 'heard').split('\n') } : null }); });
  app.post('/api/labels', (q, r) => { const b = LabelIn.safeParse(q.body); const t = b.success ? labelQueue(store).find((x) => blindKey(x.id) === b.data.key) : undefined; if (!b.success || !t) return void r.status(400).json({ error: 'That label could not be saved.' }); const { key: _k, ...l } = b.data; store.addLabel({ ...l, traceId: t.id, at: new Date().toISOString() }); r.json({ ok: true }); });
  app.post('/api/labels/undo', (q, r) => { const b = z.object({ rater: z.string().min(1) }).safeParse(q.body); if (!b.success || !store.undoLabel(b.data.rater)) return void r.status(400).json({ error: 'Nothing to undo.' }); r.json({ ok: true }); });
  app.post('/api/reviews', (q, r) => { const b = ReviewIn.safeParse(q.body); if (!b.success) return void r.status(400).json({ error: b.error.issues[0]?.message ?? 'Check the form.' }); if (!store.full(b.data.traceId)?.metrics.some((m) => m.metric === b.data.metric)) return void r.status(404).json({ error: 'No such result to review.' }); store.addReview({ ...b.data, at: new Date().toISOString() }); r.json({ ok: true }); });
  app.get('/api/findings', (_q, r) => { const f = JSON.parse(readText('data', 'findings.json')) as { mechanisms: string[]; metric: string; scenarios: string[] }[]; r.json(f.map((x) => ({ ...x, counts: Object.fromEntries(CANDIDATES.map((id) => { const ts = [...store.traces.values()].filter((t) => t.runId === id && store.scores.get(t.id)!.simulatorValid && (!x.scenarios.length || x.scenarios.some((s) => t.scenarioId.startsWith(s))) && (!x.metric || store.scores.get(t.id)!.metrics.some((m) => m.metric === x.metric && m.verdict !== 'na'))); const hit = ts.filter((t) => store.full(t.id)!.metrics.some((m) => m.verdict === 'fail' && x.mechanisms.includes(m.mechanism ?? ''))); return [id, { calls: ts.length, hit: hit.map((t) => t.id) }]; }).filter(([, c]) => (c as { calls: number }).calls > 0)) }))); });
  app.get('/api/calibration', (_q, r) => r.json(calibration(store)));
  app.use('/api/live', liveRouter(store, llm));
  app.use('/api', (_q, r) => void r.status(404).json({ error: 'Not found.' }));
  // No stack traces or file paths in an answer.
  app.use(((e, _q, r, _n) => void r.status(e?.status && e.status < 500 ? e.status : 500).json({ error: e?.status === 413 ? 'That is too long.' : e?.status === 400 ? 'That request was not valid JSON.' : 'Something broke on the server.' })) as express.ErrorRequestHandler);
  return app;
}
