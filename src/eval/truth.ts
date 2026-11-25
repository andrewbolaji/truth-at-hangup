/** What is true at hang-up. Read only from the system of record, never from anything the agent said. */
import type { Scenario, Trace, Truth } from '../core/types.js';

export function truthAtHangup(sc: Scenario, tr: Trace): { truth: Truth; reason: string } {
  const t = sc.expect.target; const w = tr.final;
  if (t?.type === 'appointment') {
    const a = w.appointments.find((x) => x.id === t.appointmentId);
    if (a?.status === 'booked' && a.slotId === t.slotId && a.patientId === t.patientId) return { truth: 'DONE', reason: `${a.id} is booked for ${a.provider} ${a.when}, which is what the caller wanted.` };
  }
  if (t?.type === 'refill') {
    const r = w.refills.find((x) => x.patientId === t.patientId && x.medicationId === t.medicationId && x.pharmacyId === t.pharmacyId);
    if (r) return { truth: 'IN', reason: `${r.id} is filed and waiting for a clinician. Nothing is at the pharmacy yet.` };
  }
  // A callback for someone else is not this caller's request. A transfer moves this caller, whoever it names.
  const me = callerPatient(sc, t0(tr)); const k = w.staffTasks.find((x) => x.type === 'transfer' || !x.patientId || !me || x.patientId === me);
  if (k) return { truth: 'HANDED_OFF', reason: `Not filed. ${k.id}: ${k.type} to ${k.target}, so a person has the job.` };
  return { truth: 'NOT_DONE', reason: 'Nothing in the system matches the request and no person was asked to finish it.' };
}

const t0 = (tr: Trace) => tr.initial.patients;
/** The caller's own record, found from the phone number on their fact card. */
export const callerPatient = (sc: Scenario, patients: Trace['initial']['patients']) => patients.find((p) => sc.callerFacts.some((f) => f.includes(p.phone)))?.id ?? null;
