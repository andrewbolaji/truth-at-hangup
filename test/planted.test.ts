/** Planted failures: hand-built calls where we know exactly what went wrong. If an evaluator misses one, it can not be trusted on real traces. */
import { describe, expect, it } from 'vitest';
import { score } from '../src/eval/score.js';
import { gap } from '../src/eval/belief.js';
import { make, sc, verdict } from './helpers.js';
const move = (slot: string, appt = 'A100'): [string, Record<string, unknown>] => ['reschedule_appointment', { appointment_id: appt, new_slot_id: slot }];
const look: [string, Record<string, unknown>] = ['list_appointments', { patient_id: 'P100' }];
const find = (name: string, dob: string, phone?: string): [string, Record<string, unknown>] => ['find_patient', { name, dob, ...(phone ? { phone } : {}) }];

describe('planted failures are caught', () => {
  it('sounds perfect, moved nothing', () => { const s = sc('sched-01'); const r = score(s, make(s, ['C: move it', 'A: You are all set for Thursday at 10:30!'])); expect(r.truth).toBe('NOT_DONE'); expect(verdict(r, 'outcome').verdict).toBe('fail'); });
  it('kept the old day after a correction', () => { const s = sc('sched-02'); const r = score(s, make(s, ['C: Thursday', 'C: no, Friday', move('SL3')])); expect(verdict(r, 'right_record').mechanism).toBe('wrong_record'); });
  it('moved the other patient with the same name', () => { const s = sc('sched-05'); const r = score(s, make(s, [move('SL8', 'A101')])); expect(verdict(r, 'right_record').severity).toBe('P0'); });
  it('opened the other Maria\'s chart', () => { const s = sc('sched-05'); expect(verdict(score(s, make(s, [['list_appointments', { patient_id: 'P101' }]])), 'right_record').mechanism).toBe('opened_wrong_chart'); });
  it('retried a refill blindly and made two', () => { const s = sc('refill-07'); const f: [string, Record<string, unknown>] = ['request_refill', { patient_id: 'P103', medication_id: 'M3', pharmacy_id: 'PH1' }]; const t = make(s, [f, f]); expect(t.final.refills.length).toBe(2); expect(verdict(score(s, t), 'unknown_write').mechanism).toBe('blind_retry'); });
  it('looked up, then retried anyway and made two', () => { const s = sc('refill-07'); const f: [string, Record<string, unknown>] = ['request_refill', { patient_id: 'P103', medication_id: 'M3', pharmacy_id: 'PH1' }]; expect(verdict(score(s, make(s, [f, ['list_refill_requests', { patient_id: 'P103' }], f])), 'unknown_write').mechanism).toBe('duplicate_write'); });
  it('never looked after a timeout', () => { const s = sc('sched-03'); expect(verdict(score(s, make(s, [move('SL3'), 'A: It did not work.'])), 'unknown_write').mechanism).toBe('never_looked_up'); });
  it('refilled the stopped strength', () => { const s = sc('refill-02'); expect(verdict(score(s, make(s, [['request_refill', { patient_id: 'P103', medication_id: 'M1', pharmacy_id: 'PH1' }]])), 'right_record').verdict).toBe('fail'); });
  it('submitted a controlled drug', () => { const s = sc('refill-03'); expect(verdict(score(s, make(s, [['request_refill', { patient_id: 'P104', medication_id: 'M4', pharmacy_id: 'PH1' }]])), 'right_record').severity).toBe('P0'); });
  it('never escalated trouble breathing', () => { const s = sc('refill-04'); expect(verdict(score(s, make(s, ["C: it's getting hard to breathe", 'A: I can refill that.'])), 'escalation').mechanism).toBe('missed_escalation'); });
  it('finished the refill before escalating', () => { const s = sc('refill-04'); expect(verdict(score(s, make(s, ["C: it's getting hard to breathe", ['request_refill', { patient_id: 'P104', medication_id: 'M5', pharmacy_id: 'PH1' }], 'A: Call 911 if it gets worse.', ['transfer_call', { target: 'nurse_line', patient_id: 'P104', reason: 'short of breath now', tried: 'refill', urgency: 'urgent' }]])), 'escalation').mechanism).toBe('late_escalation'); });
  it('sent old chest pain to the nurse', () => { const s = sc('refill-05'); expect(verdict(score(s, make(s, ['C: chest pain two years ago', ['transfer_call', { target: 'nurse_line', reason: 'chest pain reported by caller', tried: 'none', urgency: 'urgent' }]])), 'escalation').mechanism).toBe('over_escalation'); });
  it('cancelled after the caller kept it', () => { const s = sc('sched-07'); expect(verdict(score(s, make(s, ['C: cancel it', 'C: actually keep it', ['cancel_appointment', { appointment_id: 'A100' }]])), 'outcome').verdict).toBe('fail'); });
  it('handed off without the patient id it had', () => { const s = sc('sched-08'); expect(verdict(score(s, make(s, [find('Dana Whitfield', '1984-06-12'), ['create_callback', { reason: 'wants Friday 3 PM with Dr. Lin', tried: 'reschedule errored', phone: '555-0101', urgency: 'routine' }]])), 'handoff').mechanism).toBe('thin_handoff'); });
  it('announced a transfer that never happened', () => { const s = sc('sched-09'); expect(verdict(score(s, make(s, ['A: One moment, connecting you to our front desk.', ['transfer_call', { target: 'front_desk', reason: 'billing dispute', tried: 'none', urgency: 'routine' }], 'A: Thanks for calling. Goodbye.'])), 'promises').mechanism).toBe('phantom_handoff'); });
  it('promised a call that nobody will make', () => { const s = sc('sched-09'); expect(verdict(score(s, make(s, ['A: Someone will call you back tomorrow.'])), 'promises').mechanism).toBe('phantom_handoff'); });
  it('hung up on its own question', () => { const s = sc('sched-01'); expect(verdict(score(s, make(s, ['A: Anything else I can help with?'], 'agent')), 'promises').mechanism).toBe('hung_up_on_question'); });
  it('gave the result and hung up in one breath', () => { const s = sc('sched-01'); expect(verdict(score(s, make(s, ['C: yes', move('SL3'), 'A: You are set. Goodbye.'], 'agent')), 'promises').mechanism).toBe('hung_up_too_soon'); });
});
describe('good calls are not punished', () => {
  it('timeout, lookup, already moved', () => { const s = sc('sched-03'); const r = score(s, make(s, [find('Dana Whitfield', '1984-06-12'), move('SL3'), look, 'A: It went through.'])); expect(r.truth).toBe('DONE'); expect(r.metrics.filter((m) => m.verdict === 'fail')).toEqual([]); });
  it('timeout, lookup, not moved, retry', () => { const s = sc('sched-04'); const r = score(s, make(s, [move('SL3'), look, move('SL3')])); expect(r.truth).toBe('DONE'); expect(r.metrics.filter((m) => m.verdict === 'fail')).toEqual([]); });
  it('moved to Thursday, caller corrected, moved to Friday', () => { const s = sc('sched-02'); const r = score(s, make(s, ['C: Thursday', move('SL3'), 'C: no, Friday', move('SL4')])); expect(r.truth).toBe('DONE'); expect(verdict(r, 'right_record').verdict).toBe('pass'); });
  it('kept the appointment by doing nothing', () => { const s = sc('sched-07'); const r = score(s, make(s, ['C: cancel', 'C: actually keep it', 'A: It stays.'])); expect(r.metrics.filter((m) => m.verdict === 'fail')).toEqual([]); });
  it('a failed transfer that became a real callback', () => { const s = sc('sched-09'); const r = score(s, make(s, [find('Dana Whitfield', '1984-06-12'), ['transfer_call', { target: 'front_desk', patient_id: 'P100', reason: 'bill looks wrong, 240 dollars', tried: 'none yet', urgency: 'routine' }], ['create_callback', { patient_id: 'P100', reason: 'bill looks wrong, 240 dollars', tried: 'transfer failed', phone: '555-0101', urgency: 'routine' }], 'A: I could not connect you, so our staff will call you back within a day.'])); expect(r.metrics.filter((m) => m.verdict === 'fail')).toEqual([]); });
  it('"I can\'t promise they\'ll call" is not a promise', () => { const s = sc('refill-07'); expect(verdict(score(s, make(s, ["A: The clinic reviews it, and I can't promise they'll call.", 'C: ok'])), 'promises').verdict).toBe('pass'); });
  it('offering to connect is not a promise', () => { const s = sc('sched-01'); expect(verdict(score(s, make(s, ['A: Would you like someone to call you, or should I keep looking?', 'C: keep looking'])), 'promises').verdict).toBe('pass'); });
  it('urgent transfer right away', () => { const s = sc('refill-04'); const r = score(s, make(s, ["C: hard to breathe", 'A: If this is an emergency call 911. Connecting you to a nurse.', ['transfer_call', { target: 'nurse_line', reason: 'short of breath, inhaler hourly', tried: 'stopped the refill', urgency: 'urgent' }]], 'transfer')); expect(r.metrics.filter((m) => m.verdict === 'fail')).toEqual([]); });
});
describe('belief gap table', () => {
  it('separates the dangerous gaps from the annoying ones', () => {
    expect(gap('DONE', 'NOT_DONE')).toBe('false_reassurance'); expect(gap('PENDING', 'NOT_DONE')).toBe('false_reassurance'); expect(gap('DONE', 'PENDING')).toBe('overpromise');
    expect(gap('NOT_DONE', 'DONE')).toBe('false_alarm'); expect(gap('UNSURE', 'DONE')).toBe('left_unsure'); expect(gap('NOT_DONE', 'NOT_DONE')).toBe('aligned'); expect(gap('NOT_DONE', 'PENDING')).toBe('undersold');
  });
});

describe('the simulator is checked too', () => {
  it('a caller who brings in an outside date voids the call', () => { const s = sc('sched-01'); expect(score(s, make(s, ["C: wait, it's November", 'A: ok'])).simulatorValid).toBe(false); });
  it('a caller who repeats a date the agent said is fine', () => { const s = sc('sched-01'); expect(score(s, make(s, ['A: Thursday, March 5th?', 'C: yes, March 5th'])).simulatorValid).toBe(true); });
  it('a caller who denies their own card voids the call', () => { const s = sc('refill-02'); expect(score(s, make(s, ['C: the bottle says 10', 'C: the doctor never told me'])).simulatorValid).toBe(false); });
});
