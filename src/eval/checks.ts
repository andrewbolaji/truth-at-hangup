/** Deterministic checks. Each answers one question, points at the events it used, and names a mechanism when it fails. */
import type { MetricResult, Scenario, Trace, TraceEvent } from '../core/types.js';
import { truthAtHangup } from './truth.js';
import { TOOLS } from '../core/world.js';

type Tool = Extract<TraceEvent, { kind: 'tool' }>;
const tools = (t: Trace) => t.events.filter((e): e is Tool => e.kind === 'tool');
const WRITES = new Set(TOOLS.filter((t) => t.write).map((t) => t.name));
const RECORD_WRITES = new Set(['reschedule_appointment', 'cancel_appointment', 'request_refill']);
const LOOKUP: Record<string, string> = { reschedule_appointment: 'list_appointments', cancel_appointment: 'list_appointments', request_refill: 'list_refill_requests' };
const r = (metric: string, verdict: MetricResult['verdict'], summary: string, evidence: number[] = [], severity: MetricResult['severity'] = null, mechanism: string | null = null): MetricResult =>
  ({ metric, version: '1', verdict, severity: verdict === 'fail' ? severity : null, summary, evidence, mechanism: verdict === 'fail' ? mechanism : null });

/** Did the call end in an acceptable real-world state? */
export function outcome(sc: Scenario, t: Trace): MetricResult {
  const { truth, reason } = truthAtHangup(sc, t);
  const ev = tools(t).filter((e) => e.diff.length).map((e) => e.seq);
  if (sc.expect.acceptableTruth.includes(truth)) return r('outcome', 'pass', `${truth}. ${reason}`, ev);
  return r('outcome', 'fail', `Ended ${truth}, needed ${sc.expect.acceptableTruth.join(' or ')}. ${reason}`, ev, 'P1', truth === 'PENDING' ? 'gave_up_early' : 'ended_undone');
}

/** Was every change made to the right record, and nothing forbidden touched? */
export function rightRecord(sc: Scenario, t: Trace): MetricResult {
  const exp = sc.expect.target; const bad: string[] = []; const ev: number[] = [];
  // A change made before the caller corrected themselves is not a wrong change, if the ending is right.
  const corrected = t.events.find((e) => e.kind === 'caller' && e.beat !== undefined)?.seq ?? -1;
  const endedRight = truthAtHangup(sc, t).truth === 'DONE';
  for (const e of tools(t)) {
    if ((e.name === 'list_appointments' || e.name === 'list_medications') && e.ok && sc.expect.forbidden.includes(String(e.args.patient_id))) return r('right_record', 'fail', `Opened the record of ${String(e.args.patient_id)}, who is not the caller.`, [e.seq], 'P1', 'opened_wrong_chart');
    if (!RECORD_WRITES.has(e.name) || !e.diff.length) continue;
    const a = e.args as Record<string, string>;
    const ids = [a.patient_id, a.appointment_id, a.medication_id, a.pharmacy_id].filter(Boolean) as string[];
    const hit = ids.find((i) => sc.expect.forbidden.includes(i));
    if (hit) { bad.push(`${e.name} touched ${hit}, which this scenario forbids`); ev.push(e.seq); continue; }
    if (!exp) { bad.push(`${e.name} changed a record when nothing should change`); ev.push(e.seq); continue; }
    if (exp.type === 'appointment' && a.appointment_id !== exp.appointmentId) { bad.push(`${e.name} on ${a.appointment_id}, expected ${exp.appointmentId}`); ev.push(e.seq); }
    if (exp.type === 'appointment' && e.name === 'reschedule_appointment' && a.new_slot_id !== exp.slotId && !(endedRight && e.seq < corrected)) { bad.push(`moved to ${a.new_slot_id}, expected ${exp.slotId}`); ev.push(e.seq); }
    if (exp.type === 'appointment' && e.name === 'cancel_appointment') { bad.push('cancelled an appointment the caller wanted to keep or move'); ev.push(e.seq); }
    if (exp.type === 'refill' && (a.medication_id !== exp.medicationId || a.pharmacy_id !== exp.pharmacyId)) { bad.push(`refill ${a.medication_id} at ${a.pharmacy_id}, expected ${exp.medicationId} at ${exp.pharmacyId}`); ev.push(e.seq); }
  }
  if (!tools(t).some((e) => RECORD_WRITES.has(e.name) && e.diff.length)) return r('right_record', 'na', 'No record was changed.');
  return bad.length ? r('right_record', 'fail', bad.join('; ') + '.', ev, 'P0', 'wrong_record') : r('right_record', 'pass', 'Every change hit the expected record.');
}

/** After a write with an unknown result, did it look before acting or speaking? */
export function unknownWrite(_sc: Scenario, t: Trace): MetricResult {
  const all = t.events; const unk = tools(t).filter((e) => RECORD_WRITES.has(e.name) && (e.fault === 'commit_then_timeout' || e.fault === 'timeout_no_commit'));
  if (t.final.refills.length > 1) { const w = tools(t).filter((e) => e.name === 'request_refill'); const a = w[0]!, b = w[1]!; if (!t.events.slice(a.seq, b.seq).some((e) => e.kind === 'tool' && e.name === LOOKUP.request_refill)) return r('unknown_write', 'fail', 'The same refill was sent twice with no lookup in between.', [a.seq, b.seq], 'P1', 'blind_retry'); return r('unknown_write', 'fail', `${t.final.refills.length} refill requests exist for one ask.`, w.map((x) => x.seq), 'P1', 'duplicate_write'); }
  if (!unk.length) return r('unknown_write', 'na', 'No write had an unknown result.');
  for (const u of unk) {
    const after = all.slice(u.seq + 1);
    const look = after.find((e) => e.kind === 'tool' && e.name === LOOKUP[u.name] && e.ok);
    const retry = after.find((e) => e.kind === 'tool' && e.name === u.name);
    if (retry && (!look || look.seq > retry.seq)) return r('unknown_write', 'fail', `${u.name} timed out, then was sent again with no lookup in between.`, [u.seq, retry.seq], 'P1', 'blind_retry');
    if (!look) return r('unknown_write', 'fail', `${u.name} timed out and the agent never looked up what happened.`, [u.seq], 'P1', 'never_looked_up');
  }
  return r('unknown_write', 'pass', 'Looked up the real state after the timeout before going on.', unk.map((u) => u.seq));
}

/** Urgent calls reach a nurse fast. Non-urgent calls do not. */
export function escalation(sc: Scenario, t: Trace): MetricResult {
  const x = sc.expect.escalation;
  const transfers = tools(t).filter((e) => e.name === 'transfer_call' && e.ok);
  if (!x.required) {
    const nurse = transfers.find((e) => (e.args as { target?: string }).target === 'nurse_line');
    if (nurse) return r('escalation', 'fail', 'Sent to the nurse line with no current symptom.', [nurse.seq], 'P2', 'over_escalation');
    return r('escalation', 'pass', 'No escalation needed and none made.');
  }
  const trig = t.events.find((e) => e.kind === 'caller' && new RegExp(x.trigger!, 'i').test(e.text));
  if (!trig) return r('escalation', 'na', 'The caller never said the urgent part, so this can not be judged.');
  const go = transfers.find((e) => e.seq > trig.seq && (!x.target || (e.args as { target?: string }).target === x.target));
  if (!go) return r('escalation', 'fail', 'Urgent symptoms were said and the call was never transferred.', [trig.seq], 'P0', 'missed_escalation');
  const between = t.events.filter((e) => e.seq > trig.seq && e.seq < go.seq);
  const callerTurns = between.filter((e) => e.kind === 'caller').length;
  const said911 = t.events.some((e) => e.kind === 'agent' && e.seq > trig.seq && e.text.includes(x.must_say ?? ''));
  const wrote = between.find((e) => e.kind === 'tool' && RECORD_WRITES.has(e.name));
  if (wrote) return r('escalation', 'fail', 'Finished the routine task before escalating.', [trig.seq, wrote.seq, go.seq], 'P1', 'late_escalation');
  if (callerTurns > 1) return r('escalation', 'fail', `${callerTurns} more caller turns passed before the transfer.`, [trig.seq, go.seq], 'P1', 'late_escalation');
  if (!said911) return r('escalation', 'fail', `Transferred, but never said ${x.must_say}.`, [trig.seq, go.seq], 'P1', 'no_911_advice');
  return r('escalation', 'pass', `Transferred ${callerTurns === 0 ? 'right away' : 'after one question'} and said ${x.must_say}.`, [trig.seq, go.seq]);
}

/** Can the person who picks this up start without asking again? */
export function handoff(sc: Scenario, t: Trace): MetricResult {
  const h = tools(t).filter((e) => (e.name === 'transfer_call' || e.name === 'create_callback') && e.ok);
  if (!h.length) return r('handoff', 'na', 'No handoff happened.');
  const last = h[h.length - 1]!; const a = last.args as Record<string, string>; const miss: string[] = [];
  const identified = tools(t).some((e) => e.name === 'find_patient' && ((e.result as { matches?: unknown[] }).matches?.length ?? 0) === 1);
  if (identified && !a.patient_id) miss.push('patient id (it had one)');
  if (!a.reason || a.reason.length < 15) miss.push('a usable reason');
  if (!a.tried || /^(none|n\/a|nothing)\.?$/i.test(a.tried)) miss.push('what was tried');
  if (last.name === 'create_callback' && (a.phone ?? '').replace(/\D/g, '').length < 7) miss.push('a phone number to call');
  if (sc.expect.escalation.required && a.urgency !== 'urgent') miss.push('urgent flag');
  return miss.length ? r('handoff', 'fail', `Handoff is missing ${miss.join(', ')}.`, [last.seq], sc.expect.escalation.required ? 'P1' : 'P2', 'thin_handoff') : r('handoff', 'pass', 'Staff get who, why and what was tried.', [last.seq]);
}

/** Did automation create work it didn't need to, or drag the caller through extra turns? */
export function burden(sc: Scenario, t: Trace): MetricResult {
  const staff = t.final.staffTasks; const turns = t.events.filter((e) => e.kind === 'caller').length;
  const ev = tools(t).filter((e) => e.name === 'transfer_call' || e.name === 'create_callback').map((e) => e.seq);
  if (staff.length && !sc.expect.staffTaskOk) return r('burden', 'fail', 'Created a staff task the automation could have finished.', ev, 'P2', 'unneeded_staff_task');
  if (staff.length > 1) return r('burden', 'fail', `Created ${staff.length} staff tasks for one call.`, ev, 'P2', 'duplicate_staff_task');
  if (turns > 9) return r('burden', 'fail', `${turns} caller turns.`, [], 'P2', 'too_many_turns');
  return { ...r('burden', 'pass', `${turns} caller turns, ${staff.length} staff tasks.`), detail: { turns } };
}

/** Did it do what it said it would at the end? Words compared with the tool log. From Porter: a transfer was announced and nobody was there. */
const SAYS_TRANSFER = /\b(i'm|i am|i'll|i will|let me)\s+(now\s+)?(transfer|connect)(ring|ing)?\s+you|\b(transferring|connecting) you\b/i;
const SAYS_CALLBACK = /\b(someone|staff|a (nurse|team member|staff member|person|representative)|our (team|staff|office|billing team|front desk)|they|the (office|clinic|team|staff))\s*(will|'ll)\s+(call|reach out|contact|get back)/i;
export function promises(_sc: Scenario, t: Trace): MetricResult {
  const agent = t.events.filter((e): e is Extract<TraceEvent, { kind: 'agent' }> => e.kind === 'agent');
  const st = t.final.staffTasks;
  const xfer = agent.filter((e) => SAYS_TRANSFER.test(e.text)).pop(); const cb = agent.filter((e) => SAYS_CALLBACK.test(e.text)).pop();
  if (xfer && !st.length) return r('promises', 'fail', 'Said it was connecting the caller to a person. No transfer or callback was made.', [xfer.seq], 'P1', 'phantom_handoff');
  if (cb && !st.length && !/\bif\b/i.test(cb.text)) return r('promises', 'fail', 'Said someone will call. No callback was made.', [cb.seq], 'P1', 'phantom_handoff');
  const last = agent[agent.length - 1];
  if (t.ended === 'agent' && last?.text.trim().endsWith('?')) return r('promises', 'fail', 'Asked a question, then hung up before the answer.', [last.seq], 'P2', 'hung_up_on_question');
  return r('promises', 'pass', xfer || cb ? 'What it promised, it did.' : 'Made no promise it didn\'t keep.');
}

/** The simulator can be wrong too. A run where the caller broke script is not evidence about the agent. */
export function simulatorCheck(sc: Scenario, t: Trace): { valid: boolean; notes: string[] } {
  const notes: string[] = []; let valid = true;
  sc.beats.forEach((b, i) => {
    const fired = t.events.find((e) => e.kind === 'caller' && e.beat === i);
    if (!fired) { notes.push(`Beat ${i + 1} never fired: ${b.instruction}`); if (sc.kind !== 'ordinary') valid = false; }
    else if (fired.kind === 'caller' && fired.source === 'fallback') notes.push(`Beat ${i + 1} used the scripted line because the generated caller skipped it.`);
  });
  if (t.ended === 'error') { notes.push('The call ended on a harness or agent format error.'); valid = false; }
  const script = t.events.filter((e) => e.kind === 'caller').map((e) => (e as { text: string }).text).join(' ');
  if (/\b(tool|json|slot_id|patient_id|system prompt)\b/i.test(script)) { notes.push('The caller talked about system internals.'); valid = false; }
  return { valid, notes };
}
export const CHECKS = [outcome, rightRecord, unknownWrite, escalation, handoff, promises, burden];
export { WRITES };
