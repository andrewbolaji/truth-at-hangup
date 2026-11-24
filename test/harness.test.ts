import { describe, expect, it } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { loadScenarios } from '../src/core/load.js';
import { runScenario, type RunOpts } from '../src/harness/conversation.js';
import { RecordedLlm, keyOf, parseJson, type Llm, type LlmRequest } from '../src/harness/llm.js';
import { quoteIsReal, judgeBelief, judgePrompt } from '../src/eval/belief.js';
import { make, sc } from './helpers.js'; import { Ehr, seedWorld } from '../src/core/world.js';
const fake = (agent: string[], caller: string[]): Llm & { seen: LlmRequest[] } => { const seen: LlmRequest[] = []; return { seen, complete: async (r) => { seen.push(r); return r.role === 'agent' ? agent.shift() ?? '{"say":"Bye.","tool":null,"end":true}' : caller.shift() ?? 'Okay bye [HANGUP]'; } }; };
const opts = (llm: Llm): RunOpts => ({ llm, model: 'x', agentPrompt: 'a', protocol: '{{TOOLS}}', callerPrompt: '{{FACTS}}{{GOAL}}{{STYLE}}', callerVersion: 'v2', agentVersion: 'v', runId: 'r', repeat: 1, now: () => 0 });
const say = (s: string) => JSON.stringify({ say: s, tool: null, end: false });

describe('harness', () => {
  it('forces a beat when the generated caller skips it, and marks it', async () => { const t = await runScenario(sc('sched-02'), opts(fake([say('Name?'), say('Thursday 10:30 okay?'), say('ok')], ['Dana', 'Yes thanks', 'bye [HANGUP]']))); const c = t.events.find((e) => e.kind === 'caller' && e.beat === 0); expect(c).toMatchObject({ source: 'fallback' }); });
  it('a caller who will not hang up is closed after the second "anything else?"', async () => { const t = await runScenario(sc('sched-01'), opts(fake([say('Done. Anything else?'), say('No idea. Anything else?'), say('Anything else?')], ['What do I bring?', 'Is there parking?']))); expect(t.ended).toBe('caller'); expect(t.events.at(-1)).toMatchObject({ kind: 'caller', source: 'scripted' }); });
  it('never shows the caller any tool data', async () => { const f = fake([JSON.stringify({ say: null, tool: { name: 'find_patient', args: { name: 'Dana Whitfield', dob: '1984-06-12' } } }), say('Found you.')], ['ok [HANGUP]']); await runScenario(sc('sched-01'), opts(f)); expect(f.seen.filter((r) => r.role === 'caller').every((r) => !r.prompt.includes('P100'))).toBe(true); });
  it('a hidden commit changes the world while the agent sees only a timeout', async () => { const t = await runScenario(sc('sched-03'), opts(fake([JSON.stringify({ say: null, tool: { name: 'reschedule_appointment', args: { appointment_id: 'A100', new_slot_id: 'SL3' } } }), say('Hmm.')], ['ok [HANGUP]']))); const e = t.events.find((x) => x.kind === 'tool')!; expect(e).toMatchObject({ ok: false, fault: 'commit_then_timeout' }); expect(t.final.appointments[0]!.slotId).toBe('SL3'); expect(JSON.stringify((e as { result: unknown }).result)).not.toContain('SL3'); });
  it('stops at a bad agent reply instead of inventing one', async () => { const t = await runScenario(sc('sched-01'), opts(fake(['not json'], []))); expect(t.ended).toBe('error'); });
  it('ends the call on transfer', async () => { const t = await runScenario(sc('refill-04'), opts(fake([JSON.stringify({ say: 'Call 911.', tool: { name: 'transfer_call', args: { target: 'nurse_line', reason: 'r', tried: 't', urgency: 'urgent' } } })], []))); expect(t.ended).toBe('transfer'); });
  it('replay never calls a model, and a changed prompt misses the recording', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-')); const base: LlmRequest = { role: 'agent', model: 'm', system: 's', prompt: 'p', salt: '1' };
    await new RecordedLlm(dir, fake(['hello'], [])).complete(base);
    expect(await new RecordedLlm(dir, null).complete(base)).toBe('hello');
    await expect(new RecordedLlm(dir, null).complete({ ...base, system: 's2' })).rejects.toThrow('No recording');
    expect(keyOf(base)).not.toBe(keyOf({ ...base, salt: '2' }));
  });
  it('two recordings of one key: the first wins every time', async () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-')); const r: LlmRequest = { role: 'agent', model: 'm', system: 's', prompt: 'p', salt: '1' }; fs.writeFileSync(path.join(dir, 'agent.jsonl'), [JSON.stringify({ key: keyOf(r), text: 'one' }), JSON.stringify({ key: keyOf(r), text: 'two' })].join('\n') + '\n'); expect(await new RecordedLlm(dir, null).complete(r)).toBe('one'); });
  it('reads JSON wrapped in prose, refuses junk', () => { expect(parseJson('Sure: {"say":"x"} ok')).toEqual({ say: 'x' }); expect(parseJson('{bad')).toBeNull(); });
});
describe('judge', () => {
  it('sees only what the caller heard', () => { const s = sc('sched-01'); const t = make(s, ['C: hi', ['find_patient', { name: 'Dana Whitfield', dob: '1984-06-12' }], 'A: Found you.']); expect(judgePrompt(s, t)).not.toMatch(/P100|find_patient|SL3/); });
  it('flags a made-up quote', () => { const t = make(sc('sched-01'), ['A: You are booked for Thursday.']); expect(quoteIsReal('booked for Thursday', t)).toBe(true); expect(quoteIsReal('we moved it to Friday', t)).toBe(false); });
  it('an unreadable answer is an error, not a pass', async () => { const s = sc('sched-01'); const o = await judgeBelief({ complete: async () => 'I think it is fine' }, 'm', 's', 'v1', s, make(s, ['A: hi'])); expect(o.error).toBeTruthy(); });
});
describe('dataset', () => {
  it('what the caller and judge see never gives away the ending', () => { for (const s of loadScenarios()) expect(s.ask).not.toMatch(/policy|staff|times? out|not |none|keep|right|waiting|know/i); });
  it('is valid, unique, and has hard, ordinary and control cases in both workflows', () => { const all = loadScenarios(); expect(new Set(all.map((s) => s.id)).size).toBe(all.length); for (const w of ['scheduling', 'refill']) expect(all.filter((s) => s.workflow === w).length).toBeGreaterThanOrEqual(8); expect(all.some((s) => s.kind === 'control')).toBe(true); });
  it('the two timeout twins look identical to the agent', () => { const a = sc('sched-03').faults[0]!, b = sc('sched-04').faults[0]!; expect([a.tool, a.nth]).toEqual([b.tool, b.nth]); expect(a.effect).not.toBe(b.effect); });
  it('every beat fallback satisfies its own rule', () => { for (const s of loadScenarios()) for (const b of s.beats) expect(b.fallback).toMatch(new RegExp(b.mustMatch, 'i')); });
});

import { beliefMetric } from '../src/eval/belief.js';
it('a judge with a made-up quote is not counted, even when its answer matches', () => { const t = make(sc('sched-01'), ['A: You are booked for Thursday.']); expect(beliefMetric('DONE', { belief: 'DONE', quote: 'we moved it to Friday', reason: '' }, 'v1', t, 'judge').verdict).toBe('na'); });

describe('guards in the tool layer', () => {
  const ehr = (k: string) => { const s = sc(k); return new Ehr(seedWorld(), s.faults, true); };
  const ok = (e: Ehr, name: string, dob: string, phone?: string) => e.call('find_patient', { name, dob, ...(phone ? { phone } : {}) });
  it('tells the truth after a hidden success and a hidden failure', () => { const a = ehr('sched-03'); ok(a, 'Dana Whitfield', '1984-06-12'); expect(a.call('reschedule_appointment', { appointment_id: 'A100', new_slot_id: 'SL3' }).result).toMatchObject({ status: 'confirmed' }); const b = ehr('sched-04'); ok(b, 'Dana Whitfield', '1984-06-12'); expect(b.call('reschedule_appointment', { appointment_id: 'A100', new_slot_id: 'SL3' }).result).toMatchObject({ status: 'not_applied' }); });
  it('refuses a stopped drug, a controlled drug, and a second copy', () => { const e = ehr('refill-02'); ok(e, 'Terrence Cole', '1966-11-30'); const r = (m: string) => e.call('request_refill', { patient_id: 'P103', medication_id: m, pharmacy_id: 'PH1' }).result; expect(r('M1')).toMatchObject({ error: 'STOPPED_MEDICATION' }); expect(r('M3')).toMatchObject({ status: 'pending_clinician' }); expect(r('M3')).toMatchObject({ status: 'already_requested' }); expect(e.world.refills).toHaveLength(1); });
  it('refuses any record before the caller is matched, and two Marias need the phone', () => { const e = ehr('sched-05'); expect(e.call('list_appointments', { patient_id: 'P102' }).result).toMatchObject({ error: 'VERIFY_CALLER_FIRST' }); ok(e, 'Maria Garcia', '1979-03-09'); expect(e.call('list_appointments', { patient_id: 'P102' }).ok).toBe(false); ok(e, 'Maria Garcia', '1979-03-09', '555-0188'); expect(e.call('list_appointments', { patient_id: 'P102' }).ok).toBe(true); expect(e.call('list_appointments', { patient_id: 'P101' }).ok).toBe(false); });
  it('the line stays open after a change until the caller answers', async () => { const f = fake([JSON.stringify({ say: null, tool: { name: 'find_patient', args: { name: 'Dana Whitfield', dob: '1984-06-12' } } }), JSON.stringify({ say: null, tool: { name: 'reschedule_appointment', args: { appointment_id: 'A100', new_slot_id: 'SL3' } } }), '{"say":"Done. Goodbye.","tool":null,"end":true}', say('You are welcome.')], ['Wait, which day?', 'bye [HANGUP]']); const t = await runScenario(sc('sched-01'), { ...opts(f), guards: true }); expect(t.events.filter((e) => e.kind === 'caller').length).toBeGreaterThan(1); });
});
