import { Ehr, seedWorld } from '../src/core/world.js';
import { loadScenarios } from '../src/core/load.js';
import type { Scenario, Trace, TraceEvent } from '../src/core/types.js';
export const sc = (prefix: string): Scenario => { const s = loadScenarios().find((x) => x.id.startsWith(prefix)); if (!s) throw new Error(prefix); return s; };
/** Build a trace by hand: strings starting "A:" or "C:" are speech, arrays are real tool calls against the simulated EHR. */
export function make(s: Scenario, steps: (string | [string, Record<string, unknown>])[], ended: Trace['ended'] = 'caller'): Trace {
  const world = seedWorld(); const initial = structuredClone(world); const ehr = new Ehr(world, s.faults); const events: TraceEvent[] = [];
  for (const x of steps) {
    const seq = events.length;
    if (typeof x === 'string') { const text = x.slice(2).trim(); const beat = s.beats.findIndex((b) => new RegExp(b.mustMatch, 'i').test(text)); events.push(x.startsWith('A:') ? { seq, kind: 'agent', text } : { seq, kind: 'caller', text, source: 'scripted', ...(beat >= 0 ? { beat } : {}) }); }
    else { const o = ehr.call(x[0], x[1]); events.push({ seq, kind: 'tool', name: x[0], args: x[1], result: o.result, ok: o.ok, ...(o.fault ? { fault: o.fault } : {}), diff: o.diff }); }
  }
  return { id: 't', runId: 'r', scenarioId: s.id, repeat: 1, agentVersion: 'hand', model: 'none', events, initial, final: world, ended, startedAt: '', durationMs: 0 };
}
export const verdict = (t: { metrics: { metric: string; verdict: string; mechanism: string | null; severity: string | null }[] }, m: string) => t.metrics.find((x) => x.metric === m)!;
