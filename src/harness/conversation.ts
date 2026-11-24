/** Runs one scenario: scripted opening, generated caller with forced beats, agent loop, simulated EHR. */
import { Ehr, TOOLS, seedWorld } from '../core/world.js';
import type { Scenario, Trace, TraceEvent } from '../core/types.js';
import { parseJson, type Llm } from './llm.js';

export const MAX_CALLER_TURNS = 12;
const MAX_TOOL_STEPS = 6;
type Act = { say?: string | null; tool?: { name: string; args?: Record<string, unknown> } | null; end?: boolean };
type NewEvent = TraceEvent extends infer E ? (E extends TraceEvent ? Omit<E, 'seq'> : never) : never;

export interface RunOpts { llm: Llm; model: string; agentPrompt: string; protocol: string; callerPrompt: string; agentVersion: string; runId: string; repeat: number; now?: () => number }

export async function runScenario(sc: Scenario, o: RunOpts): Promise<Trace> {
  const now = o.now ?? Date.now; const t0 = now();
  const world = seedWorld(); const initial = structuredClone(world);
  const ehr = new Ehr(world, sc.faults);
  const events: TraceEvent[] = [];
  const push = (e: NewEvent) => events.push({ ...e, seq: events.length } as TraceEvent);
  const salt = `${sc.id}#${o.repeat}`;
  const system = o.agentPrompt + o.protocol.replace('{{TOOLS}}', TOOLS.map((t) => `${t.name}(${t.args}): ${t.doc}`).join('\n'));
  const callerSystem = o.callerPrompt.replace('{{FACTS}}', sc.callerFacts.map((f) => `- ${f}`).join('\n')).replace('{{GOAL}}', sc.ask).replace('{{STYLE}}', sc.callerStyle);
  const fired = new Set<number>();
  let ended: Trace['ended'] = 'turn_limit';

  push({ kind: 'caller', text: sc.opening, source: 'scripted' });
  outer: for (let turn = 0; turn < MAX_CALLER_TURNS; turn++) {
    // agent
    let spoke = false;
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const raw = await o.llm.complete({ role: 'agent', model: o.model, system, prompt: render(events, 'agent') + '\n\nYour next JSON action:', salt: `${salt}|${o.agentVersion}` });
      const act = parseJson<Act>(raw);
      if (!act) { push({ kind: 'system', text: `Agent reply was not valid JSON: ${raw.slice(0, 160)}` }); ended = 'error'; break outer; }
      if (act.say?.trim()) { push({ kind: 'agent', text: act.say.trim() }); spoke = true; }
      if (act.tool?.name) {
        const args = act.tool.args ?? {};
        const r = ehr.call(act.tool.name, args);
        push({ kind: 'tool', name: act.tool.name, args, result: r.result, ok: r.ok, ...(r.fault ? { fault: r.fault } : {}), diff: r.diff });
        if (act.tool.name === 'transfer_call' && r.ok) { ended = 'transfer'; break outer; }
        continue;
      }
      if (act.end) { ended = 'agent'; break outer; }
      break;
    }
    if (!spoke) { push({ kind: 'system', text: 'Agent said nothing this turn (dead air).' }); ended = 'error'; break; }
    // caller
    const n = turn + 1;
    const lastAgent = lastAgentText(events);
    const due = sc.beats.findIndex((b, i) => !fired.has(i) && n >= b.turn && (!b.after || new RegExp(b.after, 'i').test(lastAgent)));
    const beat = due >= 0 ? sc.beats[due] : undefined;
    const ask = beat ? `\n\nThis turn you must: ${beat.instruction} Also answer what was just asked.` : '';
    const raw = await o.llm.complete({ role: 'caller', model: o.model, system: callerSystem, prompt: render(events, 'caller') + ask + '\n\nYour next line:', salt: `${salt}|caller|${o.agentVersion}` });
    let text = raw.trim().replace(/^["']|["']$/g, ''); let source: 'generated' | 'fallback' = 'generated';
    if (beat) {
      fired.add(due);
      if (!new RegExp(beat.mustMatch, 'i').test(text)) { text = beat.fallback; source = 'fallback'; }
    }
    const hang = /\[HANGUP\]/i.test(text);
    text = text.replace(/\s*\[HANGUP\]\s*/gi, '').trim();
    if (text) push({ kind: 'caller', text, source, ...(beat ? { beat: due } : {}) });
    if (hang) { ended = 'caller'; break; }
  }
  return { id: `${o.runId}:${sc.id}:${o.repeat}`, runId: o.runId, scenarioId: sc.id, repeat: o.repeat, agentVersion: o.agentVersion, model: o.model, events, initial, final: world, ended, startedAt: new Date(t0).toISOString(), durationMs: now() - t0 };
}

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
