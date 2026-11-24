/** A person plays the caller. Simulated callers are too polite to find everything: on Porter, 20 hand-placed calls found what replay missed. */
import { randomUUID } from 'node:crypto'; import { Router } from 'express'; import { z } from 'zod';
import { loadScenarios, p, readText, sha } from '../core/load.js'; import { CallSession } from '../harness/conversation.js'; import { ClaudeCli, RecordedLlm, type Llm } from '../harness/llm.js'; import type { Store } from './store.js';
interface Live { s: CallSession; t0: number; busy: boolean; ended: string | null; version: string; repeat: number; used: number }
const MAX_LIVE = 5;
export function liveRouter(store: Store, llm: Llm = new RecordedLlm(p('data', 'llm-cache'), new ClaudeCli()), model = 'claude-haiku-5-5') {
  const r = Router(); const calls = new Map<string, Live>();
  const view = (id: string, c: Live) => ({ id, ended: c.ended, lines: c.s.events.flatMap((e) => (e.kind === 'caller' || e.kind === 'agent' ? [{ who: e.kind, text: e.text }] : [])) });
  r.get('/scenarios', (_q, res) => res.json(loadScenarios().map((s) => ({ id: s.id, title: s.title, ask: s.ask, facts: s.callerFacts, opening: s.opening }))));
  r.post('/', (q, res) => {
    const b = z.object({ scenarioId: z.string(), version: z.string().regex(/^[a-z0-9-]+$/) }).safeParse(q.body); const s = b.success ? store.scenarios.find((x) => x.id === b.data.scenarioId) : undefined;
    if (!b.success || !s) return void res.status(400).json({ error: 'Pick a scenario and an agent.' });
    for (const [k, v] of calls) if (Date.now() - v.used > 30 * 60_000) calls.delete(k);
    if (calls.size >= MAX_LIVE) return void res.status(429).json({ error: 'Too many open calls. Hang up one first.' });
    let prompt: string; try { prompt = readText('agents', `${b.data.version}.md`); } catch { return void res.status(400).json({ error: 'No such agent version.' }); }
    const id = randomUUID(); const runId = `human-${b.data.version}`; const repeat = [...store.traces.values()].filter((t) => t.runId === runId && t.scenarioId === s.id).length + 1;
    calls.set(id, { s: new CallSession(s, { llm, model, agentPrompt: prompt, protocol: readText('agents', 'protocol.md'), callerPrompt: '', callerVersion: 'human', agentVersion: b.data.version, runId, repeat }, id), t0: Date.now(), busy: false, ended: null, version: b.data.version, repeat, used: Date.now() });
    res.json({ id, ended: null, lines: [] });
  });
  r.post('/:id/say', async (q, res) => {
    const c = calls.get(q.params.id); const b = z.object({ text: z.string().trim().min(1).max(500) }).safeParse(q.body);
    if (!c) return void res.status(404).json({ error: 'That call is over. Start a new one.' });
    if (!b.success) return void res.status(400).json({ error: 'Say something first.' });
    if (c.busy || c.ended) return void res.status(409).json({ error: c.ended ? 'The call has ended.' : 'The agent is still talking.' });
    c.busy = true; c.used = Date.now(); const mark = c.s.events.length;
    try { c.s.push({ kind: 'caller', text: b.data.text, source: 'human' }); c.ended = await c.s.agentTurn(); res.json(view(q.params.id, c)); }
    catch { c.s.events.length = Math.max(mark, c.s.events.findLastIndex((e) => e.kind === 'tool') + 1); res.status(502).json({ error: 'The agent model did not answer. Live calls need the claude CLI signed in.' }); }
    finally { c.busy = false; }
  });
  r.post('/:id/hangup', (q, res) => {
    const c = calls.get(q.params.id); const b = z.object({ tester: z.string().trim().min(1).max(40), note: z.string().max(600).default(''), voice: z.boolean().default(false) }).safeParse(q.body);
    if (!c || !b.success) return void res.status(400).json({ error: c ? 'Add your name.' : 'That call is already saved.' });
    if (c.busy) return void res.status(409).json({ error: 'Wait for the agent to finish.' });
    calls.delete(q.params.id); if (!c.s.events.some((e) => e.kind === 'agent')) return void res.json({ traceId: null });
    const t = { ...c.s.trace((c.ended as 'agent' | null) ?? 'caller', c.t0, Date.now(), q.params.id.slice(0, 8)), human: b.data };
    store.addHumanCall(t, { id: t.runId, agentVersion: c.version, agentPromptSha: sha(readText('agents', `${c.version}.md`) + readText('agents', 'protocol.md')), model, repeats: 1, createdAt: new Date().toISOString(), note: 'Played by a person', scenarioSetSha: sha(JSON.stringify(store.scenarios)), callerVersion: 'human', callerPromptSha: '' });
    res.json({ traceId: t.id });
  });
  return r;
}
