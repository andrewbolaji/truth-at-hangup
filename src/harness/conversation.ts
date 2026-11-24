/** Runs one scenario: scripted opening, generated caller with forced beats, agent loop, simulated EHR. */
import { Ehr, TOOLS, seedWorld } from '../core/world.js';
import type { Scenario, Trace, TraceEvent } from '../core/types.js';
import { parseJson, type Llm } from './llm.js';

export const MAX_CALLER_TURNS = 12;
const MAX_TOOL_STEPS = 6;
type Act = { say?: string | null; tool?: { name: string; args?: Record<string, unknown> } | null; end?: boolean };
type NewEvent = TraceEvent extends infer E ? (E extends TraceEvent ? Omit<E, 'seq'> : never) : never;

export interface RunOpts { llm: Llm; model: string; agentPrompt: string; protocol: string; callerPrompt: string; agentVersion: string; runId: string; repeat: number; callerVersion: string; now?: () => number }

/** One live call: the clinic, the transcript and the agent loop. Simulated and human-played calls share it, so they are scored the same way. */
export class CallSession {
  readonly world = seedWorld(); readonly initial = structuredClone(this.world); readonly events: TraceEvent[] = [];
  private ehr: Ehr; private system: string; private salt: string;
  constructor(public sc: Scenario, private o: RunOpts, salt?: string) {
    this.ehr = new Ehr(this.world, sc.faults); this.salt = salt ?? `${sc.id}#${o.repeat}`;
    this.system = o.agentPrompt + o.protocol.replace('{{TOOLS}}', TOOLS.map((t) => `${t.name}(${t.args}): ${t.doc}`).join('\n'));
  }
  push(e: NewEvent) { this.events.push({ ...e, seq: this.events.length } as TraceEvent); }
  /** Lets the agent act until it speaks. Returns why the call ended, or null if it goes on. */
  async agentTurn(): Promise<Trace['ended'] | null> {
    let spoke = false;
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const raw = await this.o.llm.complete({ role: 'agent', model: this.o.model, system: this.system, prompt: render(this.events, 'agent') + '\n\nYour next JSON action:', salt: `${this.salt}|${this.o.agentVersion}` });
      const act = parseJson<Act>(raw);
      if (!act) { this.push({ kind: 'system', text: `Agent reply was not valid JSON: ${raw.slice(0, 160)}` }); return 'error'; }
      if (act.say?.trim()) { this.push({ kind: 'agent', text: act.say.trim() }); spoke = true; }
      if (act.tool?.name) {
        const args = act.tool.args ?? {}; const r = this.ehr.call(act.tool.name, args);
        this.push({ kind: 'tool', name: act.tool.name, args, result: r.result, ok: r.ok, ...(r.fault ? { fault: r.fault } : {}), diff: r.diff });
        if (act.tool.name === 'transfer_call' && r.ok) return 'transfer';
        continue;
      }
      if (act.end) return 'agent';
      break;
    }
    if (!spoke) { this.push({ kind: 'system', text: 'Agent said nothing this turn (dead air).' }); return 'error'; }
    return null;
  }
  trace(ended: Trace['ended'], t0: number, now: number): Trace {
    return { id: `${this.o.runId}:${this.sc.id}:${this.o.repeat}`, runId: this.o.runId, scenarioId: this.sc.id, repeat: this.o.repeat, agentVersion: this.o.agentVersion, model: this.o.model, events: this.events, initial: this.initial, final: this.world, ended, startedAt: new Date(t0).toISOString(), durationMs: now - t0 };
  }
}

export async function runScenario(sc: Scenario, o: RunOpts): Promise<Trace> {
  const now = o.now ?? Date.now; const t0 = now(); const salt = `${sc.id}#${o.repeat}`;
  const call = new CallSession(sc, o); const events = call.events;
  const callerSystem = o.callerPrompt.replace('{{FACTS}}', sc.callerFacts.map((f) => `- ${f}`).join('\n')).replace('{{GOAL}}', sc.ask).replace('{{STYLE}}', sc.callerStyle);
  const fired = new Set<number>(); let anythingElse = 0;
  let ended: Trace['ended'] = 'turn_limit';
  call.push({ kind: 'caller', text: sc.opening, source: 'scripted' });
  for (let turn = 0; turn < MAX_CALLER_TURNS; turn++) {
    const stop = await call.agentTurn(); if (stop) { ended = stop; break; }
    const n = turn + 1;
    const lastAgent = lastAgentText(events);
    const due = sc.beats.findIndex((b, i) => !fired.has(i) && n >= b.turn && (!b.after || new RegExp(b.after, 'i').test(lastAgent)));
    const beat = due >= 0 ? sc.beats[due] : undefined;
    // v1 callers filled silence with new questions, so the agent looked like it created staff work. From v2 the second "anything else?" ends the call.
    if (o.callerVersion !== 'v1') {
      if (/anything else|any other questions/i.test(lastAgentSince(events))) anythingElse++;
      if (!beat && anythingElse >= 2) { call.push({ kind: 'caller', text: "No, that's everything. Thanks, bye.", source: 'scripted' }); ended = 'caller'; break; }
    }
    const ask = beat ? `\n\nThis turn you must: ${beat.instruction} Also answer what was just asked.` : '';
    const raw = await o.llm.complete({ role: 'caller', model: o.model, system: callerSystem, prompt: render(events, 'caller') + ask + '\n\nYour next line:', salt: `${salt}|caller|${o.agentVersion}` });
    let text = raw.trim().replace(/^["']|["']$/g, ''); let source: 'generated' | 'fallback' = 'generated';
    if (beat) {
      fired.add(due);
      if (!new RegExp(beat.mustMatch, 'i').test(text)) { text = beat.fallback; source = 'fallback'; }
    }
    const hang = /\[HANGUP\]/i.test(text);
    text = text.replace(/\s*\[HANGUP\]\s*/gi, '').trim();
    if (text) call.push({ kind: 'caller', text, source, ...(beat ? { beat: due } : {}) });
    if (hang) { ended = 'caller'; break; }
  }
  return call.trace(ended, t0, now());
}

const lastAgentSince = (ev: TraceEvent[]) => { const i = ev.findLastIndex((e) => e.kind === 'caller'); return ev.slice(i + 1).map((e) => (e.kind === 'agent' ? e.text : '')).join(' '); };
const lastAgentText = (ev: TraceEvent[]) => ev.filter((e) => e.kind === 'agent').slice(-2).map((e) => (e as { text: string }).text).join(' ');
export function render(ev: TraceEvent[], who: 'agent' | 'caller' | 'heard'): string {
  return ev.flatMap((e) => {
    if (e.kind === 'caller') return [`Caller: ${e.text}`];
    if (e.kind === 'agent') return [`Agent: ${e.text}`];
    if (e.kind === 'tool' && who === 'agent') return [`[tool ${e.name} ${JSON.stringify(e.args)} -> ${JSON.stringify(e.result)}]`];
    if (e.kind === 'tool' && e.name === 'transfer_call' && e.ok && who !== 'agent') return ['[The call is transferred.]'];
    return [];
  }).join('\n');
}
