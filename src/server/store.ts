/** SQLite holds what people add (reviews, labels) and an index of runs. Trace files stay the immutable evidence. */
import Database from 'better-sqlite3'; import fs from 'node:fs'; import path from 'node:path';
import { loadScenarios, p } from '../core/load.js';
import type { Belief, MetricResult, RunMeta, Scenario, Score, Trace } from '../core/types.js';
import { beliefMetric, type JudgeOutput } from '../eval/belief.js'; import { score } from '../eval/score.js';

export interface Label { traceId: string; belief: Belief; note: string; rater: string; at: string; seconds: number }
export interface Review { id: number; traceId: string; metric: string; verdict: 'pass' | 'fail' | 'na'; reason: string; reviewer: string; at: string }
export interface JudgeFile { version: string; model: string; promptSha: string; outputs: Record<string, JudgeOutput> }

export class Store {
  db: Database.Database; scenarios: Scenario[]; runs: RunMeta[] = []; traces = new Map<string, Trace>(); scores = new Map<string, Score>(); judges: JudgeFile[] = [];
  private labelFile: string; private reviewFile: string;
  constructor(dbPath: string, private dataDir = p('data')) {
    this.labelFile = path.join(dataDir, 'labels', 'labels.json'); this.reviewFile = path.join(dataDir, 'labels', 'reviews.json');
    this.scenarios = loadScenarios(); this.db = new Database(dbPath); this.db.pragma('journal_mode = WAL');
    this.db.exec(`create table if not exists labels(trace_id text, rater text, belief text not null, note text not null, at text not null, seconds real not null, primary key(trace_id, rater));
      create table if not exists reviews(id integer primary key autoincrement, trace_id text not null, metric text not null, verdict text not null, reason text not null, reviewer text not null, at text not null);`);
    this.restore(); this.load();
  }
  private restore() {
    const read = <T>(f: string): T[] => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
    const li = this.db.prepare('insert or ignore into labels values(?,?,?,?,?,?)'); for (const l of read<Label>(this.labelFile)) li.run(l.traceId, l.rater, l.belief, l.note, l.at, l.seconds);
    if ((this.db.prepare('select count(*) n from reviews').get() as { n: number }).n === 0) { const ri = this.db.prepare('insert into reviews(trace_id,metric,verdict,reason,reviewer,at) values(?,?,?,?,?,?)'); for (const r of read<Review>(this.reviewFile)) ri.run(r.traceId, r.metric, r.verdict, r.reason, r.reviewer, r.at); }
  }
  load() {
    const dir = path.join(this.dataDir, 'runs'); this.runs = []; this.traces.clear(); this.scores.clear();
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort() : []) {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { meta: RunMeta; traces: Trace[] };
      this.runs.push(r.meta); for (const t of r.traces) { const s = this.scenarios.find((x) => x.id === t.scenarioId); if (!s) continue; this.traces.set(t.id, t); this.scores.set(t.id, score(s, t)); }
    }
    this.runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const jd = path.join(this.dataDir, 'judge'); this.judges = fs.existsSync(jd) ? fs.readdirSync(jd).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(jd, f), 'utf8'))) : [];
  }
  labels = (): Label[] => (this.db.prepare('select trace_id traceId, rater, belief, note, at, seconds from labels order by at').all() as Label[]);
  reviews = (traceId?: string): Review[] => (this.db.prepare(`select id, trace_id traceId, metric, verdict, reason, reviewer, at from reviews ${traceId ? 'where trace_id=?' : ''} order by id`).all(...(traceId ? [traceId] : [])) as Review[]);
  addLabel(l: Label) { this.db.prepare('insert or replace into labels values(?,?,?,?,?,?)').run(l.traceId, l.rater, l.belief, l.note, l.at, l.seconds); this.save(this.labelFile, this.labels()); }
  addReview(r: Omit<Review, 'id'>) { this.db.prepare('insert into reviews(trace_id,metric,verdict,reason,reviewer,at) values(?,?,?,?,?,?)').run(r.traceId, r.metric, r.verdict, r.reason, r.reviewer, r.at); this.save(this.reviewFile, this.reviews()); }
  private save(f: string, x: unknown) { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(x, null, 1)); fs.renameSync(tmp, f); }

  /** All metrics for a trace: fixed checks, then belief from a person if there is one, else the newest judge. Overrides sit on top; the original stays visible. */
  full(traceId: string): { score: Score; metrics: (MetricResult & { override?: Review })[]; judge: { version: string; out: JudgeOutput }[]; label?: Label } | null {
    const t = this.traces.get(traceId); const s = this.scores.get(traceId); if (!t || !s) return null;
    const label = this.labels().find((l) => l.traceId === traceId); const judge = this.judges.flatMap((j) => (j.outputs[traceId] ? [{ version: j.version, out: j.outputs[traceId]! }] : []));
    const last = judge[judge.length - 1];
    const b = label ? beliefMetric(s.truth, { belief: label.belief, quote: '', reason: label.note }, 'human', t, 'human') : last ? beliefMetric(s.truth, last.out, last.version, t, 'judge') : null;
    const revs = this.reviews(traceId);
    const metrics = [...s.metrics, ...(b ? [b] : [])].map((m) => { const o = revs.filter((r) => r.metric === m.metric).pop(); return o ? { ...m, override: o, verdict: o.verdict } : m; });
    return { score: s, metrics, judge, ...(label ? { label } : {}) };
  }
}
